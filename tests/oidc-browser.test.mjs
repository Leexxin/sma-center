import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { TotpAuth, totp } from '../deploy/totp-auth.mjs';
async function port() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const number = server.address().port; await new Promise(resolve => server.close(resolve)); return number;
}
test('real browser: business app → TOTP → consent → verified app session; center logout denies app', { timeout: 60000, skip: process.env.SMA_CENTER_BROWSER_TEST !== '1' }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sma-oidc-browser-')), profile = join(directory, 'chrome');
  const centerPort = await port(), appPort = await port(), issuer = `http://127.0.0.1:${centerPort}`, origin = `http://127.0.0.1:${appPort}`;
  const signing = 'isolated-browser-test-signing-key', auth = new TotpAuth(directory, signing, () => Date.now() - 60000);
  const enrollment = auth.authorizeSetup(readFileSync(join(directory, 'setup-code.txt'), 'utf8').trim());
  const seed = auth.pending(enrollment); assert(auth.confirmSetup(enrollment, totp(seed, Math.floor((Date.now() - 60000) / 30000))));
  writeFileSync(join(directory, 'secrets.json'), JSON.stringify({ session: signing, credential: Buffer.alloc(32, 3).toString('base64') }), { mode: 0o600 });
  const clientSecret = 'isolated-browser-test-client-secret';
  writeFileSync(join(directory, 'client.secret'), clientSecret, { mode: 0o600 });
  writeFileSync(join(directory, 'oidc-clients.json'), JSON.stringify([{ client_id: 'demo', name: 'Browser Test', entry_url: origin + '/login', redirect_uris: [origin + '/callback'], secret_sha256: createHash('sha256').update(clientSecret).digest('hex') }]));
  const children = []; let socket; const logs = [];
  const start = (file, env) => {
    const child = spawn(process.execPath, [file], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child);
    child.stdout.on('data', data => logs.push(String(data))); child.stderr.on('data', data => logs.push(String(data))); return child;
  };
  async function ready(url) {
    for (let n = 0; n < 150; n++) { try { if ((await fetch(url, { redirect: 'manual' })).status < 500) return; } catch {} await delay(100); }
    throw new Error('Local test server failed to become ready');
  }
  try {
    start('deploy/server.mjs', { NODE_ENV: 'production', SMA_CENTER_SELF_HOSTED: '1', SMA_CENTER_DATA_DIR: directory, PORT: String(centerPort), SMA_CENTER_SSO_ISSUER: issuer, SMA_CENTER_SECURE_COOKIES: 'false' });
    await ready(issuer + '/healthz');
    start('examples/sso/client.mjs', { OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'demo', OIDC_CLIENT_SECRET_FILE: join(directory, 'client.secret'), OIDC_APP_ORIGIN: origin });
    await ready(origin);
    const chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' }); children.push(chrome);
    const activePort = join(profile, 'DevToolsActivePort');
    for (let n = 0; n < 100 && !existsSync(activePort); n++) await delay(100);
    assert(existsSync(activePort), 'isolated Chrome started');
    const debugPort = readFileSync(activePort, 'utf8').split('\n')[0];
    const tab = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
    socket = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0; const pending = new Map();
    socket.onmessage = event => { const message = JSON.parse(event.data); const callback = pending.get(message.id); if (callback) { pending.delete(message.id); if (message.error) callback.reject(new Error(message.error.message)); else callback.resolve(message.result); } };
    const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    const evaluate = async expression => (await call('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    const until = async expression => { for (let n = 0; n < 150; n++) { if (await evaluate(expression)) return; await delay(100); } throw new Error('Browser did not reach expected SSO state at ' + await evaluate('location.origin + location.pathname'));  };
    await call('Page.enable');
    await call('Page.navigate', { url: origin + '/login' });
    await until(`location.origin === ${JSON.stringify(issuer)} && location.pathname === '/login' && !!document.querySelector('#code')`);
    // Fixture-only TOTP; never read or reset any production authentication files.
    const code = totp(seed, Math.floor(Date.now() / 30000));
    await evaluate(`document.querySelector('#code').value = ${JSON.stringify(code)}; document.querySelector('form').requestSubmit()`);
    await until("location.pathname === '/oidc/authorize' && !!document.querySelector('button[value=allow]')");
    await evaluate("document.querySelector('button[value=allow]').click()");
    await until(`location.origin === ${JSON.stringify(origin)} && location.pathname === '/' && document.body.textContent.includes('统一身份验证成功')`);
    await call('Page.navigate', { url: issuer + '/security' });
    await until("location.pathname === '/security' && !!document.querySelector('form[action=\"/logout\"]')");
    await evaluate("document.querySelector('form[action=\"/logout\"]').requestSubmit()");
    await until("location.pathname === '/login' && !!document.querySelector('#code')");
    await call('Page.navigate', { url: origin });
    await until(`location.origin === ${JSON.stringify(issuer)} && location.pathname === '/login' && !!document.querySelector('#code')`);
    assert(logs.some(line => line.includes('token_issued')), 'center issued a token');
    assert(!logs.join('').includes(clientSecret), 'client secret absent from server logs');
  } finally {
    socket?.close();
    await Promise.all(children.map(child => new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); })));
    rmSync(directory, { recursive: true, force: true });
  }
});
