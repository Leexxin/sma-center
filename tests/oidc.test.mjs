import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { OidcProvider, ssoNext } from '../deploy/oidc.mjs';
const hash = s => createHash('sha256').update(s).digest('hex');
const verifier = 'v'.repeat(43), secret = 'a-strong-fixture-secret', issuer = 'https://center.example.test', callback = 'https://app.example.test/callback';
function fixture(t, addresses = {}) {
  const centerIssuer = addresses.issuer || issuer, appCallback = addresses.callback || callback;
  const directory = mkdtempSync(join(tmpdir(), 'sso-test-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const clientsFile = join(directory, 'clients.json');
  const clients = [{ client_id: 'app', name: 'Test <App>', entry_url: new URL('/login', appCallback).href, redirect_uris: [appCallback], secret_sha256: hash(secret) }, { client_id: 'other', name: 'Other', entry_url: 'https://other.example.test/login', redirect_uris: ['https://other.example.test/callback'], secret_sha256: hash(secret) }];
  const save = () => writeFileSync(clientsFile, JSON.stringify(clients)); save();
  let now = 1800000000000;
  const auth = { state: { generation: 'generation1' } }, events = [];
  const provider = new OidcProvider({ directory, issuer: centerIssuer, clientsFile, auth, now: () => now, audit: event => events.push(event) });
  const session = { expires: now + 3600000, ownerId: 'selfhost:admin' };
  async function call(path, { method = 'GET', values = {}, loggedIn = true, headers = {}, validOrigin = true } = {}) {
    const result = { headers: {} }, request = { method, headers: { cookie: 'sma_center_totp=test-cookie', ...headers } };
    const response = { setHeader: (key, value) => { result.headers[key] = value; } };
    result.handled = await provider.handle(request, response, new URL(path, centerIssuer), loggedIn ? session : null, { form: async () => values instanceof URLSearchParams ? values : new URLSearchParams(values), html: (status, body) => Object.assign(result, { status, body }), redirect: location => Object.assign(result, { status: 303, location }), reply: (status, body) => { Object.assign(result, { status, body }); try { result.json = JSON.parse(body); } catch {} }, validOrigin });
    return result;
  }
  const params = (extra = {}) => new URLSearchParams({ client_id: 'app', redirect_uri: appCallback, response_type: 'code', scope: 'openid profile', state: 'random-state', nonce: 'n'.repeat(32), code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', ...extra });
  const authorize = async (extra = {}, opts) => call('/oidc/authorize?' + params(extra), opts);
  const consent = async (page, opts = {}) => call('/oidc/consent', { method: 'POST', values: { ticket: /name="ticket" value="([^"]+)"/.exec(page.body)?.[1], decision: 'allow' }, ...opts });
  const code = async () => new URL((await consent(await authorize())).location).searchParams.get('code');
  const exchange = (value, extra = {}) => call('/oidc/token', { method: 'POST', values: { grant_type: 'authorization_code', client_id: 'app', client_secret: secret, redirect_uri: appCallback, code_verifier: verifier, code: value, ...extra } });
  return { directory, provider, auth, session, events, call, params, authorize, consent, code, exchange, clients, save, advance: delta => { now += delta; } };
}
test('discovery, stable public JWKS, full authorization/token/userinfo/introspection/revocation', async t => {
  const f = fixture(t);
  const discovery = (await f.call('/.well-known/openid-configuration')).json;
  assert.equal(discovery.issuer, issuer); assert.deepEqual(discovery.code_challenge_methods_supported, ['S256']);
  const jwk = (await f.call('/oidc/jwks')).json.keys[0]; assert.equal(jwk.d, undefined);
  const second = new OidcProvider({ directory: f.directory, issuer, clientsFile: join(f.directory, 'clients.json'), auth: f.auth }); assert.equal(second.kid, jwk.kid);
  const grant = await f.code(), token = await f.exchange(grant);
  assert.equal(token.status, 200); assert.equal((await f.exchange(grant)).json.error, 'invalid_grant');
  const [header, payload, signature] = token.json.id_token.split('.');
  assert(verify('RSA-SHA256', Buffer.from(header + '.' + payload), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(signature, 'base64url')));
  const claims = JSON.parse(Buffer.from(payload, 'base64url')); assert.equal(claims.aud, 'app'); assert.equal(claims.iss, issuer); assert.equal(claims.nonce, 'n'.repeat(32)); assert.equal(claims.sub, 'selfhost:admin'); assert.equal(claims.exp - claims.iat, 300);
  const bearer = { authorization: 'Bearer ' + token.json.access_token };
  assert.equal((await f.call('/oidc/userinfo', { headers: bearer })).json.sub, claims.sub);
  const values = { client_id: 'app', client_secret: secret, token: token.json.access_token };
  assert.equal((await f.call('/oidc/introspect', { method: 'POST', values })).json.active, true);
  assert.equal((await f.call('/oidc/introspect', { method: 'POST', values: { ...values, client_id: 'other' } })).json.active, false);
  await f.call('/oidc/revoke', { method: 'POST', values });
  assert.equal((await f.call('/oidc/userinfo', { headers: bearer })).status, 401);
  assert(!JSON.stringify(f.events).includes(token.json.access_token)); assert(!JSON.stringify(f.events).includes(grant));
});
test('exact callbacks, duplicate parameters, unsupported grants/options, PKCE and scope validation', async t => {
  const f = fixture(t);
  for (const redirect_uri of ['https://evil.example.test/cb', callback + '/suffix', callback + '?x=1']) {
    const result = await f.authorize({ redirect_uri }); assert.equal(result.status, 400); assert.equal(result.location, undefined);
  }
  assert.equal((await f.call('/oidc/authorize?' + f.params() + '&client_id=other')).status, 400);
  for (const params of [{ code_challenge_method: 'plain' }, { code_challenge: 'short' }, { nonce: '' }, { state: '' }, { max_age: '0' }, { response_mode: 'fragment' }, { prompt: 'login' }]) assert.equal(new URL((await f.authorize(params)).location).searchParams.get('error'), 'invalid_request');
  assert.equal(new URL((await f.authorize({ scope: 'openid email' })).location).searchParams.get('error'), 'invalid_scope');
  assert.equal(new URL((await f.authorize({ response_type: 'token' })).location).searchParams.get('error'), 'unsupported_response_type');
  assert.equal((await f.exchange('missing', { grant_type: 'password' })).json.error, 'unsupported_grant_type');
});
test('login continuation is local; consent is session-bound, origin protected, one-time and escaped', async t => {
  const f = fixture(t);
  assert.equal(ssoNext('https://evil.test'), '/'); assert.equal(ssoNext('//evil.test'), '/'); assert.equal(ssoNext('/oidc/authorize?x=1\n'), '/');
  const login = await f.authorize({}, { loggedIn: false }); assert.equal(new URL(login.location, issuer).pathname, '/login'); assert(new URL(login.location, issuer).searchParams.get('next').startsWith('/oidc/authorize?'));
  assert.equal(new URL((await f.authorize({ prompt: 'none' }, { loggedIn: false })).location).searchParams.get('error'), 'login_required');
  assert.equal(new URL((await f.authorize({ prompt: 'none' })).location).searchParams.get('error'), 'consent_required');
  const page = await f.authorize(); assert(page.body.includes('Test &lt;App&gt;')); assert.equal(page.headers['Referrer-Policy'], 'same-origin');
  assert.equal((await f.consent(page, { validOrigin: false })).status, 403);
  assert.equal((await f.consent(page, { headers: { cookie: 'another-session' } })).status, 400);
  const page2 = await f.authorize(); assert.equal((await f.consent(page2)).status, 303); assert.equal((await f.consent(page2)).status, 400);
  const deny = await f.consent(await f.authorize(), { values: { ticket: 'no-ticket', decision: 'deny' } }); assert.equal(deny.status, 400);
});
test('bad client cannot consume codes; verifier mismatch consumes; expiry, logout and rotation revoke', async t => {
  const f = fixture(t);
  let grant = await f.code(); assert.equal((await f.exchange(grant, { client_secret: 'bad' })).status, 401); assert.equal((await f.exchange(grant, { client_id: 'other' })).json.error, 'invalid_grant');
  assert.equal((await f.exchange(grant, { code_verifier: 'w'.repeat(43) })).json.error, 'invalid_grant'); assert.equal((await f.exchange(grant)).json.error, 'invalid_grant');
  grant = await f.code(); f.advance(60001); assert.equal((await f.exchange(grant)).json.error, 'invalid_grant');
  let token = (await f.exchange(await f.code())).json.access_token; const userinfo = () => f.call('/oidc/userinfo', { headers: { authorization: 'Bearer ' + token } });
  f.advance(300001); assert.equal((await userinfo()).status, 401);
  token = (await f.exchange(await f.code())).json.access_token; f.auth.state.generation = 'logged-out'; assert.equal((await userinfo()).status, 401);
  token = (await f.exchange(await f.code())).json.access_token; f.clients[0].secret_sha256 = hash('new-secret'); f.save(); assert.equal((await userinfo()).status, 401);
  grant = await f.code(); f.clients[0].secret_sha256 = hash('third-secret'); f.save(); assert.equal((await f.exchange(grant, { client_secret: 'third-secret' })).json.error, 'invalid_grant');
});
test('basic auth, cancellation, denied methods and disabled clients', async t => {
  const f = fixture(t), page = await f.authorize();
  const ticket = /name="ticket" value="([^"]+)"/.exec(page.body)[1];
  const denied = await f.consent(page, { values: { ticket, decision: 'deny' } }); assert.equal(new URL(denied.location).searchParams.get('error'), 'access_denied');
  const grant = await f.code();
  const token = await f.call('/oidc/token', { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from('app:' + secret).toString('base64') }, values: { grant_type: 'authorization_code', code: grant, redirect_uri: callback, code_verifier: verifier } }); assert.equal(token.status, 200);
  for (const path of ['/oidc/token', '/oidc/introspect', '/oidc/revoke', '/oidc/consent']) assert.equal((await f.call(path)).status, 405);
  f.clients.splice(0, 1); f.save(); assert.equal((await f.call('/oidc/userinfo', { headers: { authorization: 'Bearer ' + token.json.access_token } })).status, 401);
  assert.equal((await f.call('/applications', { loggedIn: false })).location, '/login');
  assert.equal((await f.call('/unrelated')).handled, false);
  assert.equal(readFileSync(join(f.directory, 'oidc-signing-key.pem'), 'utf8').startsWith('-----BEGIN PRIVATE KEY-----'), true);
});
test('client management generates private delivery files, preserves other clients, rotates and removes', async t => {
  const { spawnSync } = await import('node:child_process');
  const directory = mkdtempSync(join(tmpdir(), 'sso-cli-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const run = args => spawnSync(process.execPath, ['deploy/sso-client.mjs', ...args], { env: { ...process.env, SMA_CENTER_DATA_DIR: directory, SMA_CENTER_SSO_CLIENTS_FILE: join(directory, 'clients.json') }, encoding: 'utf8' });
  const add = run(['add', 'orders', 'Orders', 'http://192.168.33.81:8096/login', 'http://192.168.33.81:8096/callback']); assert.equal(add.status, 0);
  const read = () => JSON.parse(readFileSync(join(directory, 'clients.json'), 'utf8'));
  const firstHash = read()[0].secret_sha256;
  const deliveryFile = /saved once to (.+); transfer/.exec(add.stdout)[1];
  const delivery = readFileSync(deliveryFile, 'utf8').trim(); assert.equal(delivery.length, 43); assert.equal(hash(delivery), firstHash); assert(!add.stdout.includes(delivery));
  assert.equal(run(['add', 'orders', 'Orders', 'http://192.168.33.81:8096/login', 'http://192.168.33.81:8096/callback']).status, 1);
  assert.equal(read()[0].secret_sha256, firstHash);
  assert.equal(run(['add', 'bad', 'Bad', 'https://evil.test/login', 'http://192.168.33.81:8096/callback']).status, 1);
  assert.equal(run(['rotate', 'orders']).status, 0); assert.notEqual(read()[0].secret_sha256, firstHash);
  assert.equal(run(['remove', 'orders']).status, 0); assert.deepEqual(read(), []);
});

test('issued tokens never outlive the center session and openid-only omits profile', async t => {
  const f = fixture(t); f.session.expires = 1800000009000;
  const response = await f.consent(await f.authorize({ scope: 'openid' }));
  const grant = new URL(response.location).searchParams.get('code');
  const token = (await f.exchange(grant)).json; assert.equal(token.expires_in, 9);
  const claims = JSON.parse(Buffer.from(token.id_token.split('.')[1], 'base64url')); assert.equal(claims.name, undefined);
  f.advance(9001); assert.equal((await f.call('/oidc/userinfo', { headers: { authorization: 'Bearer ' + token.access_token } })).status, 401);
});

test('LAN HTTP IP issuer and callbacks support the complete flow and exact URL checks', async t => {
  const center = 'http://192.168.33.124:8080', app = 'http://192.168.33.81:8096';
  const f = fixture(t, { issuer: center, callback: app + '/auth/callback' });
  const metadata = (await f.call('/.well-known/openid-configuration')).json;
  assert.equal(metadata.issuer, center); assert.equal(metadata.token_endpoint, center + '/oidc/token');
  assert((await f.call('/applications')).body.includes(app + '/login'));
  const code = await f.code(), token = await f.exchange(code); assert.equal(token.status, 200);
  const claims = JSON.parse(Buffer.from(token.json.id_token.split('.')[1], 'base64url')); assert.equal(claims.iss, center);
  assert.equal((await f.call('/oidc/userinfo', { headers: { authorization: 'Bearer ' + token.json.access_token } })).json.sub, 'selfhost:admin');
  assert.equal((await f.authorize({ redirect_uri: app + '/auth/callback/' })).status, 400);
  for (const invalid of ['javascript:alert(1)', 'ftp://192.168.33.81/callback', 'http://user:pass@192.168.33.81/callback', app + '/auth/callback#fragment']) {
    f.clients[0].redirect_uris = [invalid]; f.save(); assert.throws(() => f.provider.clients());
  }
});
