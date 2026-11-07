import { nativePage } from './console-pages.mjs';
// Restricted OIDC profile: confidential web clients, code + S256, single TOTP owner.
import { createHash, randomBytes, timingSafeEqual, generateKeyPairSync, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const hash = value => createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(32).toString('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ssoNext = value => typeof value === 'string' && value.length <= 4096 && value.startsWith('/oidc/authorize?') && !/[\r\n]/.test(value) ? value : '/';
function webUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('SSO URLs require HTTP or HTTPS, no credentials or fragment');
  return url;
}
export class OidcProvider {
  constructor({ directory, issuer, clientsFile, auth, now = () => Date.now(), audit = event => console.info(JSON.stringify(event)) }) {
    this.issuer = webUrl(issuer).href.replace(/\/$/, '');
    if (new URL(this.issuer).pathname !== '/' || new URL(this.issuer).search) throw new Error('SSO issuer must be an origin without a path or query');
    this.auth = auth; this.now = now; this.audit = audit; this.clientsFile = clientsFile;
    this.codes = new Map(); this.tokens = new Map(); this.pending = new Map();
    this.clients();
    const keyFile = join(directory, 'oidc-signing-key.pem');
    try { this.key = createPrivateKey(readFileSync(keyFile)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
      writeFileSync(keyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' }); this.key = keys.privateKey;
    }
    if (this.key.asymmetricKeyType !== 'rsa' || this.key.asymmetricKeyDetails.modulusLength < 2048) throw new Error('SSO signing key must be RSA');
    this.jwk = createPublicKey(this.key).export({ format: 'jwk' });
    this.kid = hash(JSON.stringify(this.jwk)).slice(0, 24);
    Object.assign(this.jwk, { kid: this.kid, alg: 'RS256', use: 'sig' });
  }
  clients() {
    const config = JSON.parse(readFileSync(this.clientsFile, 'utf8'));
    if (!Array.isArray(config) || config.length > 100) throw new Error('SSO clients must be an array of at most 100 clients');
    const ids = new Set();
    for (const client of config) {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(client.client_id) || ids.has(client.client_id) || typeof client.name !== 'string' || !client.name || !/^[a-f0-9]{64}$/.test(client.secret_sha256) || !Array.isArray(client.redirect_uris) || !client.redirect_uris.length || client.redirect_uris.length > 20) throw new Error('Invalid SSO client configuration');
      ids.add(client.client_id);
      for (const uri of client.redirect_uris) { if (typeof uri !== 'string' || uri.length > 2048) throw new Error('Invalid callback'); webUrl(uri); }
      const entry = webUrl(client.entry_url);
      if (!client.redirect_uris.some(uri => new URL(uri).origin === entry.origin)) throw new Error('Application entry must share a registered callback origin');
    }
    return config;
  }
  sweep() {
    for (const map of [this.codes, this.tokens, this.pending]) for (const [key, value] of map) if (value.expires <= this.now() || value.generation !== this.auth.state.generation) map.delete(key);
  }
  store(map, key, value) {
    if (map.size >= 10000) throw new Error('SSO capacity exceeded');
    map.set(key, value);
  }
  event(event, clientId) { this.audit({ component: 'sso', event, ...(clientId ? { client_id: clientId } : {}) }); }
  metadata() {
    return { issuer: this.issuer, authorization_endpoint: this.issuer + '/oidc/authorize', token_endpoint: this.issuer + '/oidc/token', userinfo_endpoint: this.issuer + '/oidc/userinfo', jwks_uri: this.issuer + '/oidc/jwks', introspection_endpoint: this.issuer + '/oidc/introspect', revocation_endpoint: this.issuer + '/oidc/revoke', response_types_supported: ['code'], response_modes_supported: ['query'], grant_types_supported: ['authorization_code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], scopes_supported: ['openid', 'profile'], claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce', 'name'], token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'], code_challenge_methods_supported: ['S256'] };
  }
  claims(scope) { return { sub: 'selfhost:admin', ...(scope.split(' ').includes('profile') ? { name: '工作台所有者' } : {}) }; }
  jwt(payload) {
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const data = encode({ alg: 'RS256', kid: this.kid, typ: 'JWT' }) + '.' + encode(payload);
    return data + '.' + sign('RSA-SHA256', Buffer.from(data), this.key).toString('base64url');
  }
  async handle(request, response, url, session, { form, html, redirect, reply, validOrigin, presentation = {} }) {
    if (!['/.well-known/openid-configuration', '/applications', '/api/applications'].includes(url.pathname) && !url.pathname.startsWith('/oidc/')) return false;
    this.sweep();
    response.setHeader('Referrer-Policy', 'no-referrer');
    const json = (status, body) => reply(status, JSON.stringify(body), 'application/json; charset=utf-8');
    const error = (status, code) => { this.event(code); json(status, { error: code }); return true; };
    const isGet = request.method === 'GET';
    if (url.pathname === '/.well-known/openid-configuration' || url.pathname === '/oidc/jwks') {
      if (!isGet) return error(405, 'invalid_request');
      json(200, url.pathname.endsWith('jwks') ? { keys: [this.jwk] } : this.metadata()); return true;
    }
    const clients = this.clients();
    if (url.pathname === '/api/applications') {
      if (!isGet) return error(405, 'invalid_request');
      if (!session) return error(401, 'unauthorized');
      json(200, { enabled: true, applications: clients.map(c => ({ id: c.client_id, name: c.name, url: c.entry_url })) }); return true;
    }
    if (url.pathname === '/applications') {
      if (!isGet) return error(405, 'invalid_request');
      if (!session) { redirect('/login'); return true; }
      redirect('/resources?kind=application'); return true;
    }
    if (url.pathname === '/oidc/authorize') {
      if (!isGet) return error(405, 'invalid_request');
      const p = url.searchParams;
      if ([...new Set(p.keys())].some(k => p.getAll(k).length > 1)) return error(400, 'invalid_request');
      const client = clients.find(c => c.client_id === p.get('client_id'));
      if (!client || !client.redirect_uris.includes(p.get('redirect_uri'))) return error(400, 'invalid_request');
      // Never redirect errors until the client and exact redirect URI have been validated.
      const fail = code => {
        const target = new URL(p.get('redirect_uri')); target.searchParams.set('error', code);
        if (p.has('state')) target.searchParams.set('state', p.get('state'));
        target.searchParams.set('iss', this.issuer); redirect(target.href); return true;
      };
      if (p.get('response_type') !== 'code') return fail('unsupported_response_type');
      const scopes = (p.get('scope') || '').split(' ');
      if (!scopes.includes('openid') || scopes.some(s => !['openid', 'profile'].includes(s))) return fail('invalid_scope');
      if (p.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(p.get('code_challenge') || '') || !/^[A-Za-z0-9_-]{16,256}$/.test(p.get('nonce') || '') || !p.get('state') || p.get('state').length > 512) return fail('invalid_request');
      // Reject options we cannot faithfully implement rather than silently weakening them.
      const allowed = new Set(['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'nonce', 'code_challenge', 'code_challenge_method', 'prompt', 'response_mode']);
      if ([...p.keys()].some(k => !allowed.has(k)) || (p.has('prompt') && !['none', 'consent'].includes(p.get('prompt'))) || (p.has('response_mode') && p.get('response_mode') !== 'query')) return fail('invalid_request');
      if (!session) {
        if (p.get('prompt') === 'none') return fail('login_required');
        const next = ssoNext(url.pathname + url.search);
        if (next === '/') return fail('invalid_request');
        redirect('/login?next=' + encodeURIComponent(next)); return true;
      }
      if (p.get('prompt') === 'none') return fail('consent_required');
      const ticket = opaque();
      this.store(this.pending, hash(ticket), { params: p.toString(), clientId: client.client_id, generation: this.auth.state.generation, sessionHash: hash(request.headers.cookie || ''), expires: Math.min(session.expires, this.now() + 300000) });
      response.setHeader('Referrer-Policy', 'same-origin');
      html(200, nativePage(`登录 ${client.name}`,'确认向此应用提供身份信息。',`<p>将提供固定身份标识${scopes.includes('profile') ? '和显示名称' : ''}。</p><p>回调地址</p><div class="ui-consent-target">${escape(p.get('redirect_uri'))}</div><form method="post" action="/oidc/consent"><input type="hidden" name="ticket" value="${ticket}"><div class="ui-consent-actions"><button name="decision" value="allow">确认登录</button><button class="secondary" name="decision" value="deny">取消</button></div></form>`,{...presentation,authenticated:true,current:'applications'}), "'self' " + new URL(p.get('redirect_uri')).origin); return true;
    }
    if (url.pathname === '/oidc/consent') {
      if (request.method !== 'POST') return error(405, 'invalid_request');
      if (!session || !validOrigin) return error(403, 'access_denied');
      const values = await form(), key = hash(values.get('ticket') || ''), pending = this.pending.get(key);
      this.pending.delete(key);
      if (!pending || !same(pending.sessionHash, hash(request.headers.cookie || ''))) return error(400, 'invalid_request');
      const p = new URLSearchParams(pending.params), client = clients.find(c => c.client_id === pending.clientId);
      if (!client?.redirect_uris.includes(p.get('redirect_uri'))) return error(400, 'invalid_request');
      const target = new URL(p.get('redirect_uri')); target.searchParams.set('state', p.get('state')); target.searchParams.set('iss', this.issuer);
      if (values.get('decision') !== 'allow') target.searchParams.set('error', 'access_denied');
      else {
        const code = opaque();
        this.store(this.codes, hash(code), { clientId: client.client_id, clientHash: client.secret_sha256, redirect: p.get('redirect_uri'), challenge: p.get('code_challenge'), nonce: p.get('nonce'), scope: p.get('scope'), generation: pending.generation, expires: Math.min(session.expires, this.now() + 60000), sessionExpires: session.expires });
        target.searchParams.set('code', code); this.event('authorization_issued', client.client_id);
      }
      redirect(target.href); return true;
    }
    if (url.pathname === '/oidc/userinfo') {
      if (!isGet) return error(405, 'invalid_request');
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization || '')?.[1];
      const value = token && this.tokens.get(hash(token));
      if (!value || !clients.some(c => c.client_id === value.clientId && c.secret_sha256 === value.clientHash)) { response.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"'); return error(401, 'invalid_token'); }
      json(200, this.claims(value.scope)); return true;
    }
    if (!['/oidc/token', '/oidc/introspect', '/oidc/revoke'].includes(url.pathname)) return error(404, 'invalid_request');
    if (request.method !== 'POST') return error(405, 'invalid_request');
    const values = await form();
    if ([...new Set(values.keys())].some(k => values.getAll(k).length > 1)) return error(400, 'invalid_request');
    let id = values.get('client_id'), secret = values.get('client_secret');
    if (request.headers.authorization) {
      if (id || secret || !request.headers.authorization.startsWith('Basic ')) return error(400, 'invalid_request');
      try {
        const pair = Buffer.from(request.headers.authorization.slice(6), 'base64').toString('utf8'), at = pair.indexOf(':');
        if (at < 0) return error(401, 'invalid_client');
        const decode = value => decodeURIComponent(value.replace(/\+/g, ' '));
        id = decode(pair.slice(0, at)); secret = decode(pair.slice(at + 1));
      } catch { return error(401, 'invalid_client'); }
    }
    const client = clients.find(c => c.client_id === id);
    if (!client || !secret || !same(client.secret_sha256, hash(secret))) { response.setHeader('WWW-Authenticate', 'Basic realm="sma-center"'); return error(401, 'invalid_client'); }
    if (url.pathname !== '/oidc/token') {
      const key = hash(values.get('token') || ''), token = this.tokens.get(key);
      const active = !!token && token.clientId === id && token.clientHash === client.secret_sha256;
      if (url.pathname === '/oidc/revoke') { if (active) this.tokens.delete(key); this.event('token_revoked', id); json(200, {}); }
      else json(200, active ? { active: true, client_id: id, ...this.claims(token.scope), scope: token.scope, token_type: 'Bearer', exp: Math.floor(token.expires / 1000), iss: this.issuer, aud: id } : { active: false });
      return true;
    }
    if (values.get('grant_type') !== 'authorization_code') return error(400, 'unsupported_grant_type');
    const key = hash(values.get('code') || ''), code = this.codes.get(key);
    if (!code || code.clientId !== id) return error(400, 'invalid_grant');
    this.codes.delete(key); // Consume even when a bound client submits an invalid verifier.
    const verifier = values.get('code_verifier') || '';
    if (code.clientHash !== client.secret_sha256 || code.redirect !== values.get('redirect_uri') || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !same(code.challenge, createHash('sha256').update(verifier).digest('base64url'))) return error(400, 'invalid_grant');
    const access = opaque(), expires = Math.min(this.now() + 300000, code.sessionExpires), iat = Math.floor(this.now() / 1000), exp = Math.floor(expires / 1000);
    this.store(this.tokens, hash(access), { clientId: id, clientHash: client.secret_sha256, scope: code.scope, generation: code.generation, expires });
    const idToken = this.jwt({ iss: this.issuer, ...this.claims(code.scope), aud: id, iat, exp, nonce: code.nonce });
    this.event('token_issued', id);
    json(200, { access_token: access, token_type: 'Bearer', expires_in: exp - iat, scope: code.scope, id_token: idToken }); return true;
  }
}
