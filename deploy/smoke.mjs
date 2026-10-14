import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';
const origin = 'http://127.0.0.1:3000';
process.chdir('/app');
const password = readFileSync('/data/bootstrap-admin.txt', 'utf8').match(/password: (.+)/)[1];
async function login(username, password) {
  const r = await fetch(origin + '/atlas-login', { method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username, password }) });
  assert.equal(r.status, 303, 'login');
  return r.headers.get('set-cookie').split(';')[0];
}
const cookie = await login('admin', password);
const api = (path, method = 'GET', body, auth = cookie) => fetch(origin + path, { method, headers: { Cookie: auth, Origin: origin, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
if (process.argv.includes('--after-restart')) {
  const { id } = JSON.parse(readFileSync('/data/deployment-smoke.json', 'utf8'));
  const resources = await (await api('/api/resources')).json();
  assert.ok(resources.some(r => r.id === id && r.credentialConfigured), 'resource and encrypted credential persist after restart');
  assert.equal((await api('/api/resources/' + id, 'DELETE')).status, 204);
  console.log('PASS restart persistence and cleanup');
  process.exit(0);
}
assert.equal((await fetch(origin + '/api/resources', { headers: { 'oai-authenticated-user-id': 'selfhost:admin', 'oai-authenticated-user-email': 'admin@atlas.local' } })).status, 401, 'forged headers are rejected');
assert.equal((await fetch(origin + '/api/resources', { headers: { Cookie: 'atlas_session=fake.fake' } })).status, 401);
assert.equal((await fetch(origin + '/api/resources', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://evil.invalid' }, body: '{}' })).status, 403, 'cross-origin write rejected');
const page = await api('/');
assert.equal(page.status, 200, 'dashboard');
const html = await page.text();
assert.ok(html.includes('ATLAS'));
const asset = html.match(/src="([^\"]*\/_next\/static\/[^"]+\.js[^\"]*)"/);
assert.ok(asset, 'dashboard has JS');
assert.equal((await api(asset[1].replaceAll('&amp;', '&'))).status, 200, 'JS served');
const token = randomBytes(24).toString('hex');
const createdResponse = await api('/api/resources', 'POST', { kind: 'server', name: 'Deployment smoke test', url: 'https://example.com', agentUrl: 'http://127.0.0.1:9999', agentToken: token, pinned: true, cpuUsage: 42 });
assert.equal(createdResponse.status, 201, await createdResponse.clone().text());
const resource = await createdResponse.json();
assert.equal(resource.credentialConfigured, true);
assert.ok(!JSON.stringify(resource).includes(token));
const prefs = await api('/api/preferences', 'PUT', { pageName: '我的工具站', greeting: '今天想从哪里开始？', accent: 'cyan', density: 'comfortable', theme: 'dark', sidebarCollapsed: false, navOrder: ['tool', 'site', 'server'] });
assert.equal(prefs.status, 200);
const backup = await api('/api/backup');
assert.equal(backup.status, 200);
assert.ok(!(await backup.text()).includes(token));
const accounts = JSON.parse(readFileSync('/data/accounts.json', 'utf8'));
const testPassword = randomBytes(24).toString('hex');
const salt = randomBytes(16).toString('hex');
accounts.push({ username: 'deployment-smoke', email: 'smoke@atlas.local', id: 'selfhost:deployment-smoke', salt, hash: scryptSync(testPassword, salt, 64).toString('hex') });
writeFileSync('/data/accounts.json', JSON.stringify(accounts), { mode: 0o600 });
try {
  const other = await login('deployment-smoke', testPassword);
  assert.equal((await api('/api/resources/' + resource.id, 'DELETE', undefined, other)).status, 404, 'another tenant cannot delete admin resource');
  const resources = await (await api('/api/resources', 'GET', undefined, other)).json();
  assert.ok(!resources.some(r => r.id === resource.id), 'another tenant cannot see admin resource');
  assert.equal((await api('/api/backup', 'GET', undefined, other)).status, 403, 'another tenant cannot access global backup');
} finally {
  writeFileSync('/data/accounts.json', JSON.stringify(accounts.filter(a => a.username !== 'deployment-smoke')), { mode: 0o600 });
  const { env } = await import('./sqlite-env.mjs');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM resources WHERE user_id=?').bind('selfhost:deployment-smoke'),
    env.DB.prepare('DELETE FROM user_preferences WHERE user_id=?').bind('selfhost:deployment-smoke'),
    env.DB.prepare('DELETE FROM users WHERE user_id=?').bind('selfhost:deployment-smoke'),
  ]);
}
writeFileSync('/data/deployment-smoke.json', JSON.stringify({ id: resource.id }), { mode: 0o600 });
console.log('PASS login, dashboard, static assets, forged headers, CSRF, CRUD, encrypted credentials, preferences, backup and tenant isolation');
