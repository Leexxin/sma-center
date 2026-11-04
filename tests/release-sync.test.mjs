import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ReleaseSyncService, parseShare, normalizeRelease, boundedBody, extractCommands, versionPath, MIRROR_LAYOUT, REPOSITORY } from '../lib/release-sync.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const share = 'http://mirror.invalid/web/client/pubshares/private-share/upload';
const base = share.replace('/upload', '');
function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'sma-release-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = new Map([['sma.deb', Buffer.from('package')], ['checksums.txt', Buffer.from('checksum')], ['latest.txt', Buffer.from('1.0.0')]]);
  const mirror = new Map([['unrelated.txt', Buffer.from('keep me')]]);
  const writes = [];
  const folders = new Set();
  const release = { tag_name: 'v1.0.0', name: 'SMA 1.0', body: '', prerelease: false, published_at: new Date().toISOString(), assets: [...source].map(([name, body]) => ({ name, size: body.length, digest: `sha256:${digest(body)}`, browser_download_url: `https://github.com/${REPOSITORY}/releases/download/v1.0.0/${name}` })) };
  const fetcher = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === 'api.github.com') return Response.json(url.pathname.includes('/tags/') ? release : [release]);
    if (url.hostname === 'raw.githubusercontent.com') return new Response(options.markdown || '# Install\n```sh\nsudo sma-ctl status\n```');
    if (url.hostname === 'github.com') {
      assert.equal(init.headers?.['X-CSRF-TOKEN'], undefined);
      await options.onDownload?.(url.pathname.split('/').at(-1));
      return new Response(options.corruptDownload ? 'CORRUPT' : source.get(url.pathname.split('/').at(-1)));
    }
    if (url.href.startsWith(base + '/dirs')) {
      const directory = url.searchParams.get('path');
      const prefix = directory === '/' ? '' : directory.slice(1) + '/';
      const entries = new Map();
      for (const key of [...mirror.keys(), ...[...folders].map(name => name + '/')]) {
        if (!key.startsWith(prefix)) continue;
        const relative = key.slice(prefix.length); if (!relative) continue;
        const name = relative.split('/')[0];
        entries.set(name, relative.includes('/') ? { name, type: '1', size: 0 } : { name, type: '2', size: mirror.get(key).length });
      }
      return Response.json([...entries.values()]);
    }
    if (url.href === share) return options.redirectUpload
      ? new Response(null, { status: 302, headers: { Location: options.badRedirect ? 'http://evil.invalid/login' : base + '/browse', 'Set-Cookie': 'qa-session=value; HttpOnly' } })
      : new Response(`axios.post(url, f, {headers: {'X-CSRF-TOKEN': 'private-csrf'}})`);
    if (options.redirectUpload && url.pathname.endsWith('/browse') && url.searchParams.get('path') === '/') {
      assert.equal(init.headers.Cookie, 'qa-session=value');
      return new Response(`{'X-CSRF-TOKEN': 'private-csrf'}`);
    }
    if (init.method === 'POST') {
      assert.equal(init.headers['X-CSRF-TOKEN'], 'private-csrf');
      const name = decodeURIComponent(url.pathname.slice((new URL(base).pathname + '/%2F').length)).replace(/^\//, '');
      assert.equal(url.searchParams.get('mkdir_parents'), 'true');
      assert.ok(name.startsWith(release.tag_name + '/'), 'uploads must stay inside the selected version');
      const chunks = []; for await (const chunk of init.body) chunks.push(Buffer.from(chunk));
      const uploaded = Buffer.concat(chunks);
      writes.push(name);
      if (options.partialUpload && name.endsWith('/sma.deb')) { folders.add(release.tag_name); mirror.set(name, uploaded.subarray(0, 3)); return new Response('connection interrupted', { status: 500 }); }
      if (options.failPackage && name.endsWith('/sma.deb')) return new Response('fail', { status: 500 });
      folders.add(release.tag_name);
      mirror.set(name, uploaded); return new Response('ok', { status: 201 });
    }
    if (url.pathname.endsWith('/browse')) {
      options.reads?.push(url.searchParams.get('path'));
      const name = url.searchParams.get('path').slice(1);
      return new Response(mirror.get(name));
    }
    throw new Error('Unexpected test request');
  };
  const service = new ReleaseSyncService(directory, { secret: 'test-only-secret', fetcher }); service.configure(share);
  return { service, source, mirror, writes, release, directory, fetcher, folders };
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
  const { service, mirror, writes } = fixture(t); mirror.set('v1.0.0/sma.deb', Buffer.from('packagX'));
  await compare(service); assert.equal(service.status().comparison.assets[0].status, 'conflict'); assert.deepEqual(writes, []);
});
test('sync requires a recent comparison and blocks conflicting files without explicit consent', async t => {
  const { service, mirror, writes } = fixture(t);
  assert.throws(() => service.start('sync', 'v1.0.0'), /先核对/);
  mirror.set('v1.0.0/latest.txt', Buffer.from('0.0.0')); await compare(service);
  service.start('sync', 'v1.0.0'); await service.pending;
  assert.equal(service.status().job.status, 'failed'); assert.deepEqual(writes, []);
  service.state.comparison.checkedAt = '2000-01-01'; assert.throws(() => service.start('sync', 'v1.0.0'), /先核对/);
});
test('sync verifies downloads and uploads, publishes latest last, preserves extras and is idempotent', async t => {
  const { service, mirror, writes } = fixture(t); await compare(service);
  service.start('sync', 'v1.0.0'); assert.throws(() => service.start('compare', 'v1.0.0'), /执行中/);
  await service.pending;
  assert.equal(service.status().job.status, 'completed'); assert.deepEqual(writes, ['v1.0.0/sma.deb', 'v1.0.0/checksums.txt', 'v1.0.0/latest.txt']);
  assert.equal(mirror.get('unrelated.txt').toString(), 'keep me'); assert.ok(service.status().comparison.assets.every(a => a.status === 'aligned'));
  service.start('sync', 'v1.0.0'); await service.pending; assert.equal(writes.length, 3);
});
test('confirmed conflicts are replaced and the final digest is checked', async t => {
  const { service, mirror } = fixture(t); mirror.set('v1.0.0/sma.deb', Buffer.from('packagX')); await compare(service);
  service.start('sync', 'v1.0.0', true); await service.pending;
  assert.equal(service.status().job.status, 'completed'); assert.equal(mirror.get('v1.0.0/sma.deb').toString(), 'package');
});
test('corrupt source downloads never upload or publish the version index', async t => {
  const { service, writes } = fixture(t, { corruptDownload: true }); await compare(service);
  service.start('sync', 'v1.0.0'); await service.pending; assert.equal(service.status().job.status, 'failed'); assert.deepEqual(writes, []);
});
test('upstream upload failure stops before publishing latest', async t => {
  const { service, writes, mirror } = fixture(t, { failPackage: true }); await compare(service);
  service.start('sync', 'v1.0.0'); await service.pending;
  assert.equal(service.status().job.status, 'failed'); assert.deepEqual(writes, ['v1.0.0/sma.deb']); assert.equal(mirror.has('v1.0.0/latest.txt'), false);
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
test('empty target stays untouched during comparison and version directory is created on upload', async t => {
  const { service, mirror, folders } = fixture(t); mirror.clear(); await compare(service);
  assert.equal(service.status().comparison.directory, '/v1.0.0');
  assert.equal(service.status().comparison.folderExists, false); assert.equal(folders.size, 0);
  assert.ok(service.status().comparison.assets.every(asset => asset.status === 'missing'));
  service.start('sync', 'v1.0.0'); await service.pending;
  assert.equal(service.status().job.status, 'completed'); assert.ok(folders.has('v1.0.0'));
  assert.equal(service.status().comparison.folderExists, true);
});
test('root and sibling files cannot satisfy a version comparison or be overwritten', async t => {
  const { service, mirror } = fixture(t);
  mirror.set('sma.deb', Buffer.from('package')); mirror.set('v2.0.0/sma.deb', Buffer.from('package'));
  mirror.set('v2.0.0/checksums.txt', Buffer.from('sibling-checksum'));
  await compare(service); assert.ok(service.status().comparison.assets.every(asset => asset.status === 'missing'));
  service.start('sync', 'v1.0.0'); await service.pending;
  assert.equal(service.status().job.status, 'completed');
  assert.equal(mirror.get('sma.deb').toString(), 'package');
  assert.equal(mirror.get('v2.0.0/checksums.txt').toString(), 'sibling-checksum');
  assert.equal(mirror.has('checksums.txt'), false); assert.equal(mirror.has('latest.txt'), false);
});
test('same-named non-directory blocks syncing instead of overwriting the file', async t => {
  const { service, mirror, writes } = fixture(t); mirror.set('v1.0.0', Buffer.from('not a directory'));
  service.start('compare', 'v1.0.0'); await service.pending;
  assert.equal(service.status().job.status, 'failed'); assert.deepEqual(writes, []);
  assert.equal(mirror.get('v1.0.0').toString(), 'not a directory');
});
test('legacy root comparisons are invalidated on restart and cannot authorize a version sync', async t => {
  const { service, directory, fetcher } = fixture(t); await compare(service);
  service.state.layout = 'flat-v1'; delete service.state.comparison.layout; service.save();
  const upgraded = new ReleaseSyncService(directory, { secret: 'test-only-secret', fetcher });
  assert.equal(upgraded.status().comparison, null); assert.equal(upgraded.status().layout, MIRROR_LAYOUT);
  assert.throws(() => upgraded.start('sync', 'v1.0.0'), /先核对/);
});
test('version path generation rejects traversal and returns the exact GitHub tag', () => {
  assert.equal(versionPath('windows-v0.3.1-rc.1', 'checksums.txt'), '/windows-v0.3.1-rc.1/checksums.txt');
  for (const tag of ['../bad', '/root', 'v1/../../bad']) assert.throws(() => versionPath(tag));
  assert.throws(() => versionPath('v1', '../bad'));
});
test('native install commands use the selected version path and remove incompatible root installers', async t => {
  const { service, release, source } = fixture(t);
  release.assets[0].name = 'sma_linux_amd64.deb';
  release.assets[0].browser_download_url = `https://github.com/${REPOSITORY}/releases/download/v1.0.0/sma_linux_amd64.deb`;
  const commands = await service.commands('v1.0.0', 'linux');
  const generated = commands.documents[0].groups[0].command;
  assert.match(generated, /path=%2Fv1\.0\.0%2Fsma_linux_amd64\.deb/);
  assert.match(generated, /sha256sum -c - &&/); assert.match(generated, /sudo apt install/);
  assert.ok(generated.includes(digest(source.get('sma.deb'))));
});
test('empty-share upload redirect keeps cookies and can create the version directory', async t => {
  const { service, folders } = fixture(t, { redirectUpload: true }); await compare(service);
  service.start('sync', 'v1.0.0'); await service.pending;
  assert.equal(service.status().job.status, 'completed'); assert.ok(folders.has('v1.0.0'));
});
test('upload-session redirects cannot leak cookies or tokens to a different host', async t => {
  const { service, writes } = fixture(t, { redirectUpload: true, badRedirect: true }); await compare(service);
  service.start('sync', 'v1.0.0'); await service.pending;
  assert.equal(service.status().job.status, 'failed'); assert.deepEqual(writes, []);
});
test('root-dependent installer and default upgrade commands are not presented as version-safe', async t => {
  const { service } = fixture(t, { markdown: '# Install\n```sh\nsudo sh install-sma.sh\n```\n## Upgrade\n```sh\nsudo sma-ctl upgrade\n```\n## Status\n```sh\nsudo sma-ctl status\n```' });
  const result = await service.commands('v1.0.0', 'linux');
  assert.ok(result.documents.slice(1).every(document => document.groups.length === 1 && document.groups[0].command === 'sudo sma-ctl status'));
});
test('Windows version downloads terminate on errors and verify the exact published MSI hash', async t => {
  const { service, release } = fixture(t);
  release.assets[0].name = 'sma_windows.msi'; release.assets[0].browser_download_url = `https://github.com/${REPOSITORY}/releases/download/v1.0.0/sma_windows.msi`;
  const result = await service.commands('v1.0.0', 'windows');
  const command = result.documents[0].groups[0].command;
  assert.match(command, /\$ErrorActionPreference = 'Stop'/); assert.match(command, /%2Fv1\.0\.0%2Fsma_windows\.msi/);
  assert.match(command, /Get-FileHash/); assert.match(command, /ExitCode -notin @\(0, 3010\)/);
});
test('an interrupted partial upload becomes a conflict and is only repaired with explicit consent', async t => {
  const options = { partialUpload: true };
  const { service, mirror, writes } = fixture(t, options); await compare(service);
  service.start('sync', 'v1.0.0'); await service.pending; assert.equal(service.status().job.status, 'failed');
  assert.equal(mirror.get('v1.0.0/sma.deb').toString(), 'pac');
  options.partialUpload = false; await compare(service);
  assert.equal(service.status().comparison.assets[0].status, 'conflict');
  service.start('sync', 'v1.0.0'); await service.pending; assert.equal(writes.length, 1);
  service.start('sync', 'v1.0.0', true); await service.pending;
  assert.equal(service.status().job.status, 'completed'); assert.equal(mirror.get('v1.0.0/sma.deb').toString(), 'package');
});

test('byte progress updates within a chunked download and survives restart as interrupted', async t => {
  const { service, release, directory, fetcher } = fixture(t);
  await compare(service);
  const asset = service.state.comparison.assets[0];
  let sent = 0;
  service.fetcher = async (url, init) => {
    if (new URL(url).hostname !== 'github.com') return fetcher(url, init);
    return new Response(new ReadableStream({ pull(controller) {
      if (sent === 7) { controller.close(); return; }
      controller.enqueue(Buffer.from('package').subarray(sent, ++sent));
    } }));
  };
  service.state.job.status = 'running';
  let updates = 0;
  const original = service.transfer.bind(service);
  service.transfer = (...args) => {
    const report = original(...args);
    return (bytes, finished) => { report(bytes, finished); if (args[1] === 'download' && !finished) updates++; };
  };
  await service.download(asset);
  assert.ok(updates > 1);
  const file = service.status().job.files.find(item => item.name === asset.name);
  assert.equal(file.sourceVerified, true);
  assert.equal(file.stages.download.bytes, 7);
  assert.ok(file.stages.download.elapsedMs >= 0);
  const restarted = new ReleaseSyncService(directory, { secret: 'test-only-secret', fetcher });
  assert.equal(restarted.status().job.status, 'interrupted');
  assert.equal(restarted.status().job.files[0].sourceVerified, true);
  assert.equal(release.assets.length, 3);
});

test('stalled transfers show zero speed without changing job completion', t => {
  const { service } = fixture(t);
  service.state.job = { status: 'running', files: [{ name: 'slow', stage: 'download', lastProgressAt: Date.now() - 16000, rate: 100 }] };
  const job = service.status().job;
  assert.equal(job.files[0].stalled, true); assert.equal(job.files[0].rate, 0);
  assert.equal(job.status, 'running');
});

test('one new file is read back once; an aligned file is only read once per subsequent sync', async t => {
  const reads = []; const { service, release } = fixture(t, { reads });
  release.assets = release.assets.slice(0, 1);
  await compare(service);
  service.start('sync', 'v1.0.0'); await service.pending;
  assert.equal(service.status().job.status, 'completed'); assert.equal(reads.length, 1);
  const file = service.status().job.files[0];
  assert.equal(file.sourceVerified, true); assert.equal(file.targetVerified, true);
  assert.equal(file.stages.upload.bytes, release.assets[0].size);
  reads.length = 0;
  service.start('sync', 'v1.0.0'); await service.pending;
  assert.equal(service.status().job.status, 'completed'); assert.equal(reads.length, 1);
});

test('ordinary assets overlap with a maximum of two workers and metadata publishes afterwards', async t => {
  let active = 0, maximum = 0;
  const { service, release, source, writes } = fixture(t, { onDownload: async name => {
    if (!name.endsWith('.deb')) { assert.equal(active, 0); return; }
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, 20)); active--;
  } });
  for (const name of ['other.deb', 'third.deb', 'fourth.deb']) {
    source.set(name, Buffer.from(name));
    release.assets.push({ name, size: name.length, digest: 'sha256:' + digest(Buffer.from(name)), browser_download_url: `https://github.com/${REPOSITORY}/releases/download/v1.0.0/${name}` });
  }
  await compare(service); service.start('sync', 'v1.0.0'); await service.pending;
  assert.equal(service.status().job.status, 'completed'); assert.equal(maximum, 2);
  assert.deepEqual(writes.slice(-2), ['v1.0.0/checksums.txt', 'v1.0.0/latest.txt']);
});

test('a parallel failure drains active workers and cannot publish checksums or latest', async t => {
  const { service, release, source, mirror, folders, writes } = fixture(t, { failPackage: true, onDownload: () => new Promise(resolve => setTimeout(resolve, 10)) });
  folders.add('v1.0.0'); mirror.set('v1.0.0/unrelated', Buffer.from('keep'));
  source.set('second.deb', Buffer.from('second'));
  release.assets.push({ name: 'second.deb', size: 6, digest: 'sha256:' + digest(Buffer.from('second')), browser_download_url: `https://github.com/${REPOSITORY}/releases/download/v1.0.0/second.deb` });
  await compare(service); service.start('sync', 'v1.0.0'); await service.pending;
  assert.equal(service.status().job.status, 'failed'); assert.equal(service.running, false);
  assert.ok(!writes.some(name => /checksums|latest/.test(name)));
  const count = writes.length; await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(writes.length, count);
});

test('native HTTP streaming upload preserves raw body, length and readback verification', async t => {
  const { createServer } = await import('node:http');
  const { service, release, source, mirror, folders, fetcher } = fixture(t);
  const bytes = Buffer.alloc(256 * 1024, 42); source.set('sma.deb', bytes);
  release.assets = [ { ...release.assets[0], size: bytes.length, digest: 'sha256:' + digest(bytes) } ];
  let received = 0;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers['content-length'], String(bytes.length));
    assert.equal(req.headers['content-type'], 'application/octet-stream');
    const chunks = []; for await (const chunk of req) { received += chunk.length; chunks.push(chunk); }
    mirror.set('v1.0.0/sma.deb', Buffer.concat(chunks)); folders.add('v1.0.0');
    res.writeHead(201); res.end('ok');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  service.fetcher = (url, init) => init?.method === 'POST' ? fetch(`http://127.0.0.1:${server.address().port}/`, init) : fetcher(url, init);
  await compare(service); service.start('sync', 'v1.0.0'); await service.pending;
  assert.equal(service.status().job.status, 'completed'); assert.equal(received, bytes.length);
  assert.equal(service.status().job.files[0].targetVerified, true);
});

test('final listing still rejects removed or size-changed verified files', async t => {
  for (const removed of [true, false]) {
    const { service, release, mirror } = fixture(t);
    release.assets = release.assets.slice(0, 1);
    await compare(service);
    const compareImpl = service.compare.bind(service);
    service.compare = (current, verified) => {
      if (verified?.size) {
        if (removed) mirror.delete('v1.0.0/sma.deb'); else mirror.set('v1.0.0/sma.deb', Buffer.from('bad'));
      }
      return compareImpl(current, verified);
    };
    service.start('sync', 'v1.0.0'); await service.pending;
    assert.equal(service.status().job.status, 'failed');
    assert.ok(service.status().comparison.assets.some(a => a.status !== 'aligned'));
  }
});
