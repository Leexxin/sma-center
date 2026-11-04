import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { TotpAuth, totp } from '../deploy/totp-auth.mjs';

test('release UI keeps browsing available during sync, renders live bytes and reports stale polling', { timeout: 60000, skip: process.env.SMA_CENTER_BROWSER_TEST !== '1' }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sma-release-browser-')), profile = join(directory, 'chrome');
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const signing = 'isolated-release-browser-signing';
  const auth = new TotpAuth(directory, signing, () => Date.now() - 60000);
  const enrollment = auth.authorizeSetup(readFileSync(join(directory, 'setup-code.txt'), 'utf8').trim());
  const seed = auth.pending(enrollment); assert(auth.confirmSetup(enrollment, totp(seed, Math.floor((Date.now() - 60000) / 30000))));
  writeFileSync(join(directory, 'secrets.json'), JSON.stringify({ session: signing, credential: Buffer.alloc(32, 5).toString('base64') }), { mode: 0o600 });
  writeFileSync(join(directory, 'oidc-clients.json'), '[]', { mode: 0o600 });
  const children = []; let socket, calls = 0, offline = false;
  const asset = { name: 'demo.msi', size: 1048576, digest: 'a'.repeat(64), url: 'https://example.invalid/demo.msi' };
  const release = tag => ({ tag, name: tag, prerelease: false, publishedAt: new Date().toISOString(), url: 'https://example.invalid/release', body: 'Release fixture', assets: [asset] });
  const fixture = { configured: true, targetOrigin: 'http://mirror.invalid', releases: [release('v1'), release('v2')], comparison: null, history: [], job: { id: 'fixture', tag: 'v1', kind: 'sync', status: 'running', message: '同步 /v1/demo.msi', done: 0, total: 1, startedAt: new Date().toISOString(), files: [{ name: asset.name, stage: 'download', bytes: 262144, total: asset.size, rate: 65536, idleMs: 16000, stalled: true, stages: { download: {} } }] } };
  try {
    children.push(spawn(process.execPath, ['deploy/server.mjs'], { env: { ...process.env, NODE_ENV: 'production', SMA_CENTER_SELF_HOSTED: '1', SMA_CENTER_DATA_DIR: directory, PORT: String(port), SMA_CENTER_SSO_ISSUER: origin, SMA_CENTER_SECURE_COOKIES: 'false' }, stdio: 'pipe' }));
    let startupLog = ''; children[0].stderr.on('data', data => { startupLog += data; });
    let ready = false;
    for (let i = 0; i < 150; i++) { try { if ((await fetch(origin + '/healthz')).ok) { ready = true; break; } } catch {} await delay(100); }
    assert(ready, 'isolated gateway started: ' + startupLog);
    children.push(spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-proxy-server', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' }));
    const activePort = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !existsSync(activePort); i++) await delay(100);
    assert(existsSync(activePort));
    const debugPort = readFileSync(activePort, 'utf8').split('\n')[0];
    const tab = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
    socket = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0; const pending = new Map();
    const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    socket.onmessage = event => {
      const message = JSON.parse(event.data), callback = pending.get(message.id);
      if (callback) { pending.delete(message.id); if (message.error) callback.reject(new Error(message.error.message)); else callback.resolve(message.result); }
      if (message.method === 'Fetch.requestPaused') {
        const { requestId, request } = message.params;
        if (offline && request.method === 'GET') { void call('Fetch.failRequest', { requestId, errorReason: 'ConnectionFailed' }); return; }
        let result = fixture;
        if (request.method === 'POST') { const input = JSON.parse(request.postData); result = { tag: input.tag, platform: input.platform, documents: [{ path: 'Fixture docs', source: 'https://example.invalid', error: null, groups: [{ title: 'Status', command: 'echo fixture', language: 'sh', dangerous: false }] }] }; }
        else { calls++; if (calls > 1) { fixture.job.files[0].bytes = 786432; fixture.job.files[0].idleMs = 0; } }
        void call('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(result)).toString('base64') });
      }
    };
    const evaluate = async expression => (await call('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    const until = async expression => { for (let i = 0; i < 180; i++) { if (await evaluate(expression)) return; await delay(100); } throw new Error('Expected release UI state: ' + expression); };
    await call('Page.enable');
    await call('Page.navigate', { url: origin + '/login' });
    await until("!!document.querySelector('#code')");
    await evaluate(`document.querySelector('#code').value = ${JSON.stringify(totp(seed, Math.floor(Date.now() / 30000)))}; document.querySelector('form').requestSubmit()`);
    await until("location.pathname === '/'");
    await call('Fetch.enable', { patterns: [{ urlPattern: '*api/sma/releases*', requestStage: 'Request' }] });
    await call('Page.navigate', { url: origin + '/sma/releases' });
    await until("document.body.textContent.includes('秒无字节进展')");
    assert.equal(await evaluate("document.querySelector('.release-versions button:nth-of-type(2)').disabled"), false);
    assert.equal(await evaluate("[...document.querySelectorAll('.release-actions button')].every(b => b.disabled)"), true);
    await evaluate("document.querySelector('.release-versions button:nth-of-type(2)').click()");
    await until("document.querySelector('.release-version-heading h2')?.textContent === 'v2'");
    assert.equal(await evaluate("document.querySelector('.release-job strong').textContent"), 'v1 · 同步');
    await evaluate("[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.includes('安装')).click()");
    await until("document.body.textContent.includes('echo fixture')");
    await until("document.querySelector('progress[aria-label*=字节进度]')?.value === 786432");
    offline = true;
    await until("document.body.textContent.includes('超过 10 秒未收到状态更新')");
    assert.equal(await evaluate("document.querySelector('.release-versions button').disabled"), false);
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    if (process.env.SMA_CENTER_RELEASE_SCREENSHOT) {
      const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(process.env.SMA_CENTER_RELEASE_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
    }
  } finally {
    socket?.close();
    await Promise.all(children.map(child => new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 2000); timer.unref(); })));
    rmSync(directory, { recursive: true, force: true });
  }
});
