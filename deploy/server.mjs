import next from 'next';
import QRCode from 'qrcode';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TotpAuth } from './totp-auth.mjs';
import { REFERRER_POLICY, validWriteOrigin } from './request-origin.mjs';
import { setupPage, enrollPage, loginPage, securityPage } from './auth-pages.mjs';
const directory = process.env.SMA_CENTER_DATA_DIR || new URL('../.sma-center-data/', import.meta.url).pathname;
mkdirSync(directory, { recursive: true });
const secretsFile = join(directory, 'secrets.json');
if (!existsSync(secretsFile)) writeFileSync(secretsFile, JSON.stringify({ session: randomBytes(32).toString('hex'), credential: randomBytes(32).toString('base64') }), { mode: 0o600 });
const secrets = JSON.parse(readFileSync(secretsFile, 'utf8'));
process.env.SMA_CREDENTIAL_KEY = secrets.credential;
const auth = new TotpAuth(directory, secrets.session);
if (process.argv[2] === 'reset-2fa') { auth.reset(); console.log('2FA reset. Read /data/setup-code.txt to bind again.'); process.exit(0); }
if (process.argv.length > 2) throw new Error('Only the server-side reset-2fa command is supported.');
const app = next({ dev: process.env.NODE_ENV === 'development', ...(process.env.NODE_ENV === 'development' ? { webpack: true } : {}), hostname: '0.0.0.0', port: Number(process.env.PORT || 3000) });
await app.prepare();
const handle = app.getRequestHandler(), cookieName = 'sma_center_totp', enrollmentCookie = 'sma_center_enrollment';
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('X-Frame-Options', 'DENY');
    // Native same-origin form POSTs need a non-opaque Origin for CSRF validation.
    response.setHeader('Referrer-Policy', REFERRER_POLICY); response.setHeader('Cache-Control', 'no-store');
    for (const name of Object.keys(request.headers)) if (name.startsWith('oai-authenticated-user-') || name.startsWith('sma-center-')) delete request.headers[name];
    const cookies = new Map((request.headers.cookie || '').split(';').map(x => { const at = x.indexOf('='); return [x.slice(0, at).trim(), x.slice(at + 1)]; }));
    const cookie = (name, value, age, path = '/') => `${name}=${value}; Path=${path}; HttpOnly; SameSite=Strict; Max-Age=${age}${process.env.SMA_CENTER_SECURE_COOKIES === 'true' ? '; Secure' : ''}`;
    const reply = (status, body, type = 'text/html; charset=utf-8') => { response.writeHead(status, { 'Content-Type': type }); response.end(body); };
    const html = (status, body) => { response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"); reply(status, body); };
    const redirect = path => { response.writeHead(303, { Location: path }); response.end(); };
    const issue = token => response.setHeader('Set-Cookie', cookie(cookieName, token, auth.state.ttlSeconds));
    const form = async () => {
      if (!request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) throw new Error('INVALID_FORM');
      let length = 0; const chunks = [];
      for await (const chunk of request) { length += chunk.length; if (length > 8192) throw new Error('BODY_TOO_LARGE'); chunks.push(chunk); }
      return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    };
    if (url.pathname === '/healthz' && request.method === 'GET') { reply(200, 'ok', 'text/plain'); return; }
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(request.method)) { reply(405, 'Method not allowed'); return; }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !validWriteOrigin(request.headers, url.origin)) { reply(403, '表单来源验证失败，请重新打开当前页面后再提交。'); return; }
    if (url.pathname === '/atlas-login' || url.pathname === '/signin-with-chatgpt') { redirect('/login'); return; }
    if (url.pathname === '/favicon.svg') { reply(200, readFileSync(join(process.cwd(), 'public/favicon.svg')), 'image/svg+xml'); return; }
    if (url.pathname.startsWith('/setup')) {
      if (auth.state.bound) { redirect('/login'); return; }
      if (!['GET', 'POST'].includes(request.method)) { reply(405, 'Method not allowed'); return; }
      if (auth.limited()) { response.setHeader('Retry-After', '600'); html(429, setupPage('尝试次数过多，请 10 分钟后再试。')); return; }
      if (url.pathname === '/setup' && request.method === 'GET') { html(200, setupPage()); return; }
      if (url.pathname === '/setup/authorize' && request.method === 'POST') {
        const values = await form(), nonce = auth.authorizeSetup(values.get('setupCode'));
        if (!nonce) { html(401, setupPage('授权码无效，请检查部署时提供的一次性绑定码。')); return; }
        response.setHeader('Set-Cookie', cookie(enrollmentCookie, nonce, 600, '/setup')); redirect('/setup/verify'); return;
      }
      if (['/setup/verify', '/setup/confirm'].includes(url.pathname)) {
        const nonce = cookies.get(enrollmentCookie), secret = auth.pending(nonce);
        if (!secret) { redirect('/setup'); return; }
        if (url.pathname === '/setup/confirm' && request.method === 'POST') {
          const values = await form(), token = auth.confirmSetup(nonce, values.get('code'));
          if (token) { response.setHeader('Set-Cookie', [cookie(cookieName, token, auth.state.ttlSeconds), cookie(enrollmentCookie, '', 0, '/setup')]); redirect('/'); return; }
        } else if (!(url.pathname === '/setup/verify' && request.method === 'GET')) { reply(405, 'Method not allowed'); return; }
        const uri = `otpauth://totp/sma-center:owner?secret=${secret}&issuer=sma-center&algorithm=SHA1&digits=6&period=30`;
        const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
        html(request.method === 'POST' ? 401 : 200, enrollPage(secret, qr, request.method === 'POST' ? '动态码无效，请确认手机时间并重试。' : '')); return;
      }
      reply(404, 'Not found'); return;
    }
    if (url.pathname === '/login') {
      if (!auth.state.bound) { redirect('/setup'); return; }
      if (request.method === 'GET') { html(200, loginPage()); return; }
      if (request.method !== 'POST') { reply(405, 'Method not allowed'); return; }
      if (auth.limited()) { response.setHeader('Retry-After', '600'); html(429, loginPage('尝试次数过多，请 10 分钟后再试。')); return; }
      const values = await form(), token = auth.login(values.get('code'));
      if (!token) { html(401, loginPage('动态码无效或已使用，请等待验证器更新后重试。')); return; }
      issue(token); redirect('/'); return;
    }
    const session = auth.session(cookies.get(cookieName));
    if (!session) {
      if (url.pathname.startsWith('/api/')) reply(401, JSON.stringify({ error: auth.state.bound ? '请使用验证器动态码登录。' : '请先绑定验证器。', code: auth.state.bound ? 'UNAUTHORIZED' : 'TOTP_NOT_BOUND' }), 'application/json');
      else redirect(auth.state.bound ? '/login' : '/setup');
      return;
    }
    if (url.pathname === '/logout' || url.pathname === '/signout-with-chatgpt') {
      if (request.method !== 'POST') { reply(405, 'Method not allowed'); return; }
      auth.logout(); response.setHeader('Set-Cookie', [cookie(cookieName, '', 0), cookie('sma_center_session', '', 0), cookie('atlas_session', '', 0)]); redirect('/login'); return;
    }
    if (url.pathname === '/security') {
      if (request.method === 'POST') {
        const values = await form();
        try { auth.setDuration(Number(values.get('ttlMinutes'))); } catch (error) { html(400, securityPage(auth.state.ttlSeconds / 60, session.expires, error.message)); return; }
        issue(auth.issueSession()); redirect('/security?saved=1'); return;
      }
      if (request.method !== 'GET') { reply(405, 'Method not allowed'); return; }
      html(200, securityPage(auth.state.ttlSeconds / 60, session.expires, '', url.searchParams.get('saved') === '1')); return;
    }
    request.headers['sma-center-authenticated'] = 'totp-v1'; request.headers['sma-center-owner-id'] = session.ownerId;
    await handle(request, response);
  } catch (error) {
    console.error('Request failed', error instanceof Error ? error.name : 'unknown');
    if (!response.headersSent) response.writeHead(['INVALID_FORM', 'BODY_TOO_LARGE'].includes(error.message) ? 400 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('请求无法完成，请重试。');
  }
}).listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`sma-center single-user TOTP gateway listening on port ${Number(process.env.PORT || 3000)}`));
