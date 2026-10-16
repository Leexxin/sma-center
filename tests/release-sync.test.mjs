import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ReleaseSyncService, parseShare, normalizeRelease, boundedBody, extractCommands, REPOSITORY } from '../lib/release-sync.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const share = 'http://mirror.invalid/web/client/pubshares/private-share/upload';
const base = share.replace('/upload', '');
function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'sma-release-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = new Map([['sma.deb', Buffer.from('package')], ['checksums.txt', Buffer.from('checksum')], ['latest.txt', Buffer.from('1.0.0')]]);
  const mirror = new Map([['unrelated.txt', Buffer.from('keep me')]]);
  const writes = [];
  const release = { tag_name: 'v1.0.0', name: 'SMA 1.0', body: '', prerelease: false, published_at: new Date().toISOString(), assets: [...source].map(([name, body]) => ({ name, size: body.length, digest: `sha256:${digest(body)}`, browser_download_url: `https://github.com/${REPOSITORY}/releases/download/v1.0.0/${name}` })) };
  const fetcher = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === 'api.github.com') return Response.json(url.pathname.includes('/tags/') ? release : [release]);
    if (url.hostname === 'raw.githubusercontent.com') return new Response('# Install\n```sh\nsudo sma-ctl status\n```');
    if (url.hostname === 'github.com') {
      assert.equal(init.headers?.['X-CSRF-TOKEN'], undefined);
      return new Response(options.corruptDownload ? 'CORRUPT' : source.get(url.pathname.split('/').at(-1)));
    }
    if (url.href.startsWith(base + '/dirs')) return Response.json([...mirror].map(([name, body]) => ({ name, size: body.length, type: '2' })));
    if (url.href === share) return new Response(`axios.post(url, f, {headers: {'X-CSRF-TOKEN': 'private-csrf'}})`);
    if (init.method === 'POST') {
      assert.equal(init.headers['X-CSRF-TOKEN'], 'private-csrf');
      const name = decodeURIComponent(url.pathname.slice((new URL(base).pathname + '/%2F').length)).replace(/^\//, '');
      writes.push(name);
      if (options.failPackage && name === 'sma.deb') return new Response('fail', { status: 500 });
      mirror.set(name, Buffer.from(init.body)); return new Response('ok', { status: 201 });
    }
    if (url.pathname.endsWith('/browse')) {
      const name = url.searchParams.get('path').slice(1);
      return new Response(mirror.get(name));
    }
    throw new Error('Unexpected test request');
  };
  const service = new ReleaseSyncService(directory, { secret: 'test-only-secret', fetcher }); service.configure(share);
  return { service, source, mirror, writes, release, directory, fetcher };
}
async function compare(service) { service.start('compare', 'v1.0.0'); await service.pending; assert.equal(service.status().job.status, 'completed'); }

test('share URLs accept upload/browse, reject credentials, queries and arbitrary endpoints', () => {
  assert.equal(parseShare(share), base); assert.equal(parseShare(base + '/browse'), base);
  for (const value of ['file:///tmp/foo', 'http://name:password@host/web/client/pubshares/id/upload', share + '?token=secret', 'http://host/api', base + '/../admin']) assert.throws(() => parseShare(value));
});
test('release metadata rejects traversal, oversized assets, foreign download hosts and duplicate names', () => {
  const asset = { name: '../bad', size: 10, browser_download_url: 'https://evil.invalid/file' };
  assert.throws(() => normalizeRelease({ tag_name: 'v1', assets: [asset] }));
  assert.throws(() => normalizeRelease({ tag_name: '../../x', assets: [] }));
  asset.name = 'a'; asset.browser_download_url = `https://github.com/${REPOSITORY}/releases/download/v1/a`; asset.size = 128 * 1024 * 1024;
  assert.throws(() => normalizeRelease({ tag_name: 'v1', assets: [asset] }));
  asset.size = 1; assert.throws(() => normalizeRelease({ tag_name: 'v1', assets: [asset, asset] }));
});
test('bounded downloads enforce limits even when Content-Length is omitted', async () => {
  await assert.rejects(() => boundedBody(new Response('12345'), 4), /超过/);
  await assert.rejects(() => boundedBody(new Response('a', { headers: { 'content-length': '100' } }), 4), /超过/);
});
test('configuration is encrypted, preserved over restart, absent from status and invalidates comparisons', async t => {
  const { service, directory, fetcher } = fixture(t); await compare(service);
  const text = readFileSync(join(directory, 'release-sync.json'), 'utf8');
  assert.ok(!text.includes('private-share')); assert.ok(!JSON.stringify(service.status()).includes('private-share'));
  const restarted = new ReleaseSyncService(directory, { secret: 'test-only-secret', fetcher }); assert.equal(restarted.share(), base);
  restarted.configure(share); assert.equal(restarted.status().comparison, null);
});
test('comparison hashes same-size files, reports conflicts and never writes remote files', async t => {
  const { service, mirror, writes } = fixture(t); mirror.set('sma.deb', Buffer.from('packagX'));
  await compare(service); assert.equal(service.status().comparison.assets[0].status, 'conflict'); assert.deepEqual(writes, []);
});
test('sync requires a recent comparison and blocks conflicting files without explicit consent', async t => {
  const { service, mirror, writes } = fixture(t);
  assert.throws(() => service.start('sync', 'v1.0.0'), /先核对/);
  mirror.set('latest.txt', Buffer.from('0.0.0')); await compare(service);
  service.start('sync', 'v1.0.0'); await service.pending;
  assert.equal(service.status().job.status, 'failed'); assert.deepEqual(writes, []);
  service.state.comparison.checkedAt = '2000-01-01'; assert.throws(() => service.start('sync', 'v1.0.0'), /先核对/);
});
test('sync verifies downloads and uploads, publishes latest last, preserves extras and is idempotent', async t => {
  const { service, mirror, writes } = fixture(t); await compare(service);
  service.start('sync', 'v1.0.0'); assert.throws(() => service.start('compare', 'v1.0.0'), /执行中/);
  await service.pending;
  assert.equal(service.status().job.status, 'completed'); assert.deepEqual(writes, ['sma.deb', 'checksums.txt', 'latest.txt']);
  assert.equal(mirror.get('unrelated.txt').toString(), 'keep me'); assert.ok(service.status().comparison.assets.every(a => a.status === 'aligned'));
  service.start('sync', 'v1.0.0'); await service.pending; assert.equal(writes.length, 3);
});
test('confirmed conflicts are replaced and the final digest is checked', async t => {
  const { service, mirror } = fixture(t); mirror.set('sma.deb', Buffer.from('packagX')); await compare(service);
  service.start('sync', 'v1.0.0', true); await service.pending;
  assert.equal(service.status().job.status, 'completed'); assert.equal(mirror.get('sma.deb').toString(), 'package');
});
test('corrupt source downloads never upload or publish the version index', async t => {
  const { service, writes } = fixture(t, { corruptDownload: true }); await compare(service);
  service.start('sync', 'v1.0.0'); await service.pending; assert.equal(service.status().job.status, 'failed'); assert.deepEqual(writes, []);
});
test('upstream upload failure stops before publishing latest', async t => {
  const { service, writes, mirror } = fixture(t, { failPackage: true }); await compare(service);
  service.start('sync', 'v1.0.0'); await service.pending;
  assert.equal(service.status().job.status, 'failed'); assert.deepEqual(writes, ['sma.deb']); assert.equal(mirror.has('latest.txt'), false);
});
test('restart marks unfinished jobs interrupted instead of claiming completion', t => {
  const { service, directory, fetcher } = fixture(t); service.state.job = { status: 'running' }; service.save();
  const restarted = new ReleaseSyncService(directory, { secret: 'test-only-secret', fetcher }); assert.equal(restarted.status().job.status, 'interrupted');
});
test('commands only render shell/powershell blocks and flag dangerous actions, never execute them', () => {
  const groups = extractCommands('# Setup\n```sh\nsudo sma-ctl status\n```\n## Remove\n```powershell\n.\\uninstall-sma.ps1 -Purge\n```\n```html\n<script>bad</script>\n```\n| 日志 | `sudo sma-ctl logs 200` |');
  assert.equal(groups.length, 3); assert.equal(groups[0].title, 'Setup'); assert.equal(groups[1].dangerous, true); assert.equal(groups[2].title, '日志');
});
test('draft releases and missing digests cannot silently publish', async t => {
  assert.throws(() => normalizeRelease({ tag_name: 'v1', draft: true, assets: [] }));
  const { service, release, writes } = fixture(t); release.assets[0].digest = null;
  await compare(service); service.start('sync', 'v1.0.0', true); await service.pending;
  assert.equal(service.status().job.status, 'failed'); assert.deepEqual(writes, []);
});
test('compact service commands from documentation tables expand into complete commands', () => {
  const groups = extractCommands('| 启停 | `sudo sma-ctl start` / `stop` / `restart` |');
  assert.equal(groups[0].command, 'sudo sma-ctl start\nsudo sma-ctl stop\nsudo sma-ctl restart');
});
