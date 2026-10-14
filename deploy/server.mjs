import next from 'next';
import { createServer } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.env.ATLAS_DATA_DIR || '/data';
mkdirSync(directory, { recursive: true });
const secretsFile = join(directory, 'secrets.json');
if (!existsSync(secretsFile)) writeFileSync(secretsFile, JSON.stringify({ session: randomBytes(32).toString('hex'), credential: randomBytes(32).toString('base64') }), { mode: 0o600 });
const secrets = JSON.parse(readFileSync(secretsFile, 'utf8'));
process.env.SMA_CREDENTIAL_KEY = secrets.credential;
const accountsFile = join(directory, 'accounts.json');
function account(username, password, email) {
  const salt = randomBytes(16).toString('hex');
  return { username, email, id: `selfhost:${username}`, salt, hash: scryptSync(password, salt, 64).toString('hex') };
}
if (!existsSync(accountsFile)) {
  const password = randomBytes(24).toString('base64url');
  writeFileSync(accountsFile, JSON.stringify([account('admin', password, 'admin@atlas.local')]), { mode: 0o600 });
  writeFileSync(join(directory, 'bootstrap-admin.txt'), `username: admin\npassword: ${password}\n`, { mode: 0o600 });
  console.log('Initial credentials saved to /data/bootstrap-admin.txt');
}
// Provision another isolated tenant; password supplied on stdin.
if (process.argv[2] === 'add-user') {
  const [username, email] = process.argv.slice(3);
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(username || '') || !email?.includes('@')) throw new Error('Usage: add-user USERNAME EMAIL (password on stdin)');
  const password = readFileSync(0, 'utf8').trim();
  if (password.length < 16) throw new Error('Password must be at least 16 characters');
  const accounts = JSON.parse(readFileSync(accountsFile, 'utf8'));
  if (accounts.some(a => a.username === username)) throw new Error('Username already exists');
  accounts.push(account(username, password, email));
  writeFileSync(accountsFile, JSON.stringify(accounts), { mode: 0o600 });
  console.log('User created'); process.exit(0);
}
const sign = value => createHmac('sha256', secrets.session).update(value).digest('base64url');
function session(cookie) {
  try {
    const token = cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('atlas_session='))?.slice(14);
    if (!token) return null;
    const [payload, signature] = token.split('.');
    const expected = sign(payload);
    if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (value.expires < Date.now()) return null;
    return JSON.parse(readFileSync(accountsFile, 'utf8')).find(a => a.id === value.id) || null;
  } catch { return null; }
}
function loginPage(error = '') {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>登录 Atlas</title><style>body{margin:0;background:#101819;color:#eaf4f2;font:16px system-ui;display:grid;place-items:center;min-height:100vh}form{width:min(320px,80vw);padding:36px;border:1px solid #304542;border-radius:20px;background:#182422}h1{margin-top:0}input,button{box-sizing:border-box;display:block;width:100%;padding:14px;margin:14px 0;border-radius:9px;border:1px solid #46615b;font:inherit}button{background:#5ce5ca;cursor:pointer}p{color:#a3bbb5}.error{color:#ffb6b6}</style><form method="post" action="/atlas-login"><h1>ATLAS</h1><p>登录你的个人工作台</p><label>账号<input name="username" autocomplete="username" required maxlength="40"></label><label>密码<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><button>登录</button><p class="error">${error}</p></form></html>`;
}
const app = next({ dev: false, hostname: '0.0.0.0', port: Number(process.env.PORT || 3000) });
await app.prepare();
const handle = app.getRequestHandler();
const attempts = new Map();
setInterval(() => { for (const [ip, a] of attempts) if (a.until < Date.now()) attempts.delete(ip); }, 60000).unref();
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (status, body) => { response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(body); };
    const redirect = path => { response.writeHead(303, { Location: path, 'Cache-Control': 'no-store' }); response.end(); };
    if (url.pathname === '/healthz') { response.writeHead(200); response.end('ok'); return; }
    // Never trust identity supplied by a browser.
    for (const name of Object.keys(request.headers)) if (name.startsWith('oai-authenticated-user-')) delete request.headers[name];
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (request.headers.origin !== url.origin || request.headers['sec-fetch-site'] === 'cross-site') { reply(403, 'Forbidden'); return; }
    }
    if (url.pathname === '/signout-with-chatgpt') {
      response.setHeader('Set-Cookie', 'atlas_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); redirect('/atlas-login'); return;
    }
    if (url.pathname === '/atlas-login' || url.pathname === '/signin-with-chatgpt') {
      if (request.method === 'POST' && url.pathname === '/atlas-login') {
        const ip = request.socket.remoteAddress;
        const attempt = attempts.get(ip) || { count: 0, until: Date.now() + 15 * 60000 };
        if (attempt.count >= 10) { reply(429, loginPage('尝试次数过多，请稍后再试')); return; }
        let body = '';
        for await (const chunk of request) { body += chunk; if (body.length > 8192) { reply(413, 'Too large'); return; } }
        const form = new URLSearchParams(body);
        const user = JSON.parse(readFileSync(accountsFile, 'utf8')).find(a => a.username === form.get('username'));
        const hash = scryptSync(form.get('password') || '', user?.salt || 'dummy-salt', 64);
        if (!user || !timingSafeEqual(hash, Buffer.from(user.hash, 'hex'))) {
          attempt.count++; attempts.set(ip, attempt); reply(401, loginPage('账号或密码错误')); return;
        }
        attempts.delete(ip);
        const payload = Buffer.from(JSON.stringify({ id: user.id, expires: Date.now() + 12 * 3600000 })).toString('base64url');
        response.setHeader('Set-Cookie', `atlas_session=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`);
        redirect('/'); return;
      }
      reply(200, loginPage()); return;
    }
    const user = session(request.headers.cookie);
    if (!user) {
      if (url.pathname.startsWith('/api/')) { response.writeHead(401, { 'Content-Type': 'application/json' }); response.end('{"error":"请先登录"}'); }
      else redirect('/atlas-login');
      return;
    }
    request.headers['oai-authenticated-user-id'] = user.id;
    request.headers['oai-authenticated-user-email'] = user.email;
    request.headers['oai-authenticated-user-full-name'] = encodeURIComponent(user.username);
    request.headers['oai-authenticated-user-full-name-encoding'] = 'percent-encoded-utf-8';
    await handle(request, response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) response.writeHead(500);
    response.end('Internal server error');
  }
}).listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Atlas listening on port 3000'));
