// Reference BFF: Node >=22.13, no additional dependencies; HTTP IP/localhost demonstration.
// Production: use your framework's OIDC library, shared session store and access control.
import { createServer } from 'node:http';
import { randomBytes, createHash, createPublicKey, verify, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
const issuer = process.env.OIDC_ISSUER || 'http://localhost:3000';
const clientId = process.env.OIDC_CLIENT_ID || 'demo';
const secret = readFileSync(process.env.OIDC_CLIENT_SECRET_FILE, 'utf8').trim();
const origin = process.env.OIDC_APP_ORIGIN || 'http://localhost:4000', callback = origin + '/callback';
const appUrl = new URL(origin);
if (appUrl.protocol !== 'http:' || appUrl.origin !== origin || appUrl.username || appUrl.password) throw new Error('Demo app requires an HTTP origin without a path or credentials');
const random = () => randomBytes(32).toString('base64url');
const hash = s => createHash('sha256').update(s).digest('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const sessions = new Map();
async function fetchJson(url, options) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('OIDC request failed');
  return response.json();
}
const metadata = await fetchJson(issuer + '/.well-known/openid-configuration');
if (metadata.issuer !== issuer) throw new Error('Issuer mismatch');
for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'introspection_endpoint', 'revocation_endpoint']) if (new URL(metadata[key]).origin !== issuer) throw new Error('Unexpected endpoint');
const basic = 'Basic ' + Buffer.from(encodeURIComponent(clientId) + ':' + encodeURIComponent(secret)).toString('base64');
const post = (endpoint, values) => fetchJson(endpoint, { method: 'POST', headers: { authorization: basic, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) });
createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'");
  const redirect = path => { res.writeHead(303, { Location: path }); res.end(); };
  const clear = () => res.setHeader('Set-Cookie', 'sma_sso_demo=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  try {
    const now = Date.now(); for (const [key, value] of sessions) if (value.expires <= now) sessions.delete(key);
    const url = new URL(req.url, origin), cookie = /(?:^|;\s*)sma_sso_demo=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
    const current = cookie && sessions.get(hash(cookie));
    if (url.pathname === '/login' && req.method === 'GET') {
      if (sessions.size >= 10000) { res.writeHead(503); res.end('Try later'); return; }
      const key = random(), state = random(), nonce = random(), verifier = random();
      sessions.set(hash(key), { state, nonce, verifier, expires: now + 300000 });
      res.setHeader('Set-Cookie', `sma_sso_demo=${key}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300`);
      const target = new URL(metadata.authorization_endpoint);
      target.search = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: callback, scope: 'openid profile', state, nonce, code_challenge: hash(verifier), code_challenge_method: 'S256' }).toString();
      redirect(target.href); return;
    }
    if (url.pathname === '/callback' && req.method === 'GET') {
      if (cookie) sessions.delete(hash(cookie)); clear();
      if (!current?.state || !equal(current.state, url.searchParams.get('state')) || url.searchParams.get('iss') !== issuer || url.searchParams.has('error') || !url.searchParams.get('code') || [...new Set(url.searchParams.keys())].some(k => url.searchParams.getAll(k).length !== 1)) throw new Error('Invalid callback');
      const tokens = await post(metadata.token_endpoint, { grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: callback, code_verifier: current.verifier });
      const parts = tokens.id_token.split('.'); if (parts.length !== 3) throw new Error('Invalid JWT');
      const header = JSON.parse(Buffer.from(parts[0], 'base64url')), claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
      const keys = await fetchJson(metadata.jwks_uri), key = keys.keys.find(k => k.kid === header.kid && k.alg === 'RS256' && k.kty === 'RSA' && k.use === 'sig');
      const seconds = Math.floor(Date.now() / 1000);
      if (header.alg !== 'RS256' || !key || !verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url')) || claims.iss !== issuer || claims.aud !== clientId || !equal(claims.nonce, current.nonce) || typeof claims.sub !== 'string' || !claims.sub || !Number.isFinite(claims.exp) || !Number.isFinite(claims.iat) || claims.exp <= seconds || claims.iat > seconds + 30 || claims.exp <= claims.iat || typeof tokens.access_token !== 'string' || tokens.token_type !== 'Bearer') throw new Error('Invalid identity token');
      const sessionId = random(); sessions.set(hash(sessionId), { sub: claims.sub, token: tokens.access_token, expires: claims.exp * 1000 });
      res.setHeader('Set-Cookie', `sma_sso_demo=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${claims.exp - seconds}`);
      redirect('/'); return;
    }
    if (url.pathname === '/logout' && req.method === 'POST') {
      // Native forms need same-origin referrer policy for non-opaque Origin.
      if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') throw new Error('Invalid origin');
      if (cookie) sessions.delete(hash(cookie)); clear();
      if (current?.token) await post(metadata.revocation_endpoint, { token: current.token });
      redirect('/'); return;
    }
    if (url.pathname !== '/' || req.method !== 'GET') { res.writeHead(404); res.end('Not found'); return; }
    if (!current?.sub) { redirect('/login'); return; }
    const active = await post(metadata.introspection_endpoint, { token: current.token });
    if (!active.active || active.sub !== current.sub || active.client_id !== clientId) { sessions.delete(hash(cookie)); clear(); redirect('/login'); return; }
    // This demo has no business privileges. Map verified (issuer, sub) to local permissions here.
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>SSO 示例业务系统</title><h1>统一身份验证成功</h1><p>此页面每次访问都向中心验证令牌是否仍有效。</p><form method="post" action="/logout"><button>退出本应用</button></form><p>退出所有中心会话，请前往 sma-center 的安全设置。</p></html>');
  } catch {
    // Never log callback URLs, codes, tokens, secret or cookie values.
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('认证未完成，请重新访问 /login；中心不可用时拒绝访问。');
  }
}).listen(Number(appUrl.port || 80), appUrl.hostname.replace(/^\[|\]$/g, ''), () => console.log('SSO example: ' + origin));
