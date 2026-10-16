import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const REPOSITORY = 'Leexxin/server-monitor-agent';
export const MIRROR_LAYOUT = 'version-folders-v1';
const API = `https://api.github.com/repos/${REPOSITORY}`;
const MAX_FILE = 64 * 1024 * 1024;
const sha = value => createHash('sha256').update(value).digest('hex');
const safeName = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,179}$/.test(value) && !value.includes('..');
const fail = message => { throw new Error(message); };
const shellQuote = value => "'" + value.replace(/'/g, "'\"'\"'") + "'";
const psQuote = value => "'" + value.replace(/'/g, "''") + "'";
export function versionPath(tag, name) {
  if (!safeName(tag) || (name !== undefined && !safeName(name))) fail('版本目录或附件名无效。');
  return `/${tag}${name === undefined ? '' : '/' + name}`;
}

export function parseShare(value) {
  if (/(?:^|\/)(?:\.|%2e){1,2}(?=\/|$)/i.test(String(value))) fail('分享地址不能包含路径跳转。');
  const url = new URL(String(value));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail('请输入不含密码或查询参数的 SFTPGo 分享地址。');
  const match = url.pathname.match(/^(.*\/web\/client\/pubshares\/[A-Za-z0-9_-]+)(?:\/(?:upload|browse))?\/?$/);
  if (!match) fail('地址须为 SFTPGo 公共分享的 upload 或 browse 页面。');
  return url.origin + match[1];
}

export async function boundedBody(response, limit = MAX_FILE) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); fail('远端文件超过允许大小。'); }
  const chunks = []; let total = 0;
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length;
      if (total > limit) { await reader.cancel(); fail('远端文件超过允许大小。'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export function normalizeRelease(release) {
  if (!release || release.draft || !safeName(release.tag_name) || !Array.isArray(release.assets) || release.assets.length > 100) fail('GitHub Release 格式无效或尚未发布。');
  const names = new Set();
  const assets = release.assets.map(asset => {
    if (!safeName(asset.name) || names.has(asset.name) || !Number.isSafeInteger(asset.size) || asset.size < 0 || asset.size > MAX_FILE) fail('Release 含不支持的附件名称、大小或重复文件。');
    names.add(asset.name);
    const expected = `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(asset.name)}`;
    if (asset.browser_download_url !== expected) fail('附件下载地址不属于指定仓库。');
    return { name: asset.name, size: asset.size, digest: /^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '') ? asset.digest.slice(7) : null, url: expected };
  });
  return { tag: release.tag_name, name: String(release.name || release.tag_name), prerelease: Boolean(release.prerelease), publishedAt: release.published_at, url: `https://github.com/${REPOSITORY}/releases/tag/${encodeURIComponent(release.tag_name)}`, body: String(release.body || '').slice(0, 30000), assets };
}

export function extractCommands(markdown) {
  const groups = []; let title = '操作命令'; let language = null; let code = [];
  for (const line of markdown.split('\n')) {
    if (language !== null) {
      if (/^```\s*$/.test(line)) {
        const command = code.join('\n').trim();
        if (command && ['sh', 'bash', 'shell', 'powershell'].includes(language)) groups.push({ title, language, command, dangerous: /(?:uninstall|--purge|-Purge|token reset)/i.test(command) });
        language = null; code = [];
      } else code.push(line);
    } else if (/^#{1,4}\s/.test(line)) title = line.replace(/^#+\s*/, '');
    else {
      const fence = line.match(/^```([\w-]*)\s*$/); if (fence) language = fence[1];
      if (line.startsWith('|')) {
        const commands = [...line.matchAll(/`((?:sudo |systemctl |rc-service )[^`]+)`/g)].map(match => match[1]);
        if (commands.includes('sudo sma-ctl start')) {
          for (const match of line.matchAll(/`(stop|restart)`/g)) commands.push(`sudo sma-ctl ${match[1]}`);
        }
        if (commands.length) groups.push({ title: line.split('|')[1].trim(), language: 'sh', command: commands.join('\n'), dangerous: commands.some(value => /uninstall|--purge|token reset/i.test(value)) });
      }
    }
  }
  return groups;
}

export class ReleaseSyncService {
  constructor(directory, options = {}) {
    this.directory = directory; this.fetcher = options.fetcher || fetch;
    mkdirSync(directory, { recursive: true });
    this.file = join(directory, 'release-sync.json');
    this.key = createHash('sha256').update('sma-release-sync-v1:' + (options.secret || JSON.parse(readFileSync(join(directory, 'secrets.json'), 'utf8')).credential)).digest();
    this.state = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : { releases: [], comparison: null, job: null, history: [] };
    if (this.state.job?.status === 'running') { this.state.job.status = 'interrupted'; this.state.job.message = '服务已重启，任务中断；请重新核对后重试。'; this.save(); }
    if (this.state.layout !== MIRROR_LAYOUT) {
      this.state.layout = MIRROR_LAYOUT; this.state.comparison = null; this.state.job = null;
      this.state.history = this.state.history.map(job => ({ ...job, layout: job.layout || 'legacy-flat' }));
      this.save();
    }
    this.running = false;
  }
  save() {
    const temp = this.file + '.tmp';
    writeFileSync(temp, JSON.stringify(this.state), { mode: 0o600 }); renameSync(temp, this.file);
  }
  seal(value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from('release-share-v1'));
    return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]).toString('base64');
  }
  share() {
    if (!this.state.share) fail('请先保存本地 SFTPGo 分享地址。');
    const b = Buffer.from(this.state.share, 'base64'), decipher = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
    decipher.setAAD(Buffer.from('release-share-v1')); decipher.setAuthTag(b.subarray(-16));
    return Buffer.concat([decipher.update(b.subarray(12, -16)), decipher.final()]).toString();
  }
  configure(url) {
    if (this.running) fail('任务执行中，不能修改目标仓库。');
    this.state.share = this.seal(parseShare(url)); this.state.comparison = null; this.save();
  }
  status() {
    return { repository: REPOSITORY, layout: MIRROR_LAYOUT, configured: Boolean(this.state.share), targetOrigin: this.state.share ? new URL(this.share()).origin : null, releases: this.state.releases, comparison: this.state.comparison, job: this.state.job, history: this.state.history };
  }
  async request(url, options = {}, limit = MAX_FILE) {
    const { timeoutMs = 60000, ...fetchOptions } = options;
    const response = await this.fetcher(url, { ...fetchOptions, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) { await response.body?.cancel(); fail(`远端请求失败（HTTP ${response.status}）；检查网络、分享权限或 GitHub 限流。`); }
    return { response, body: await boundedBody(response, limit) };
  }
  githubHeaders() {
    return { Accept: 'application/vnd.github+json', 'User-Agent': 'sma-center-release-sync', ...(process.env.SMA_CENTER_GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.SMA_CENTER_GITHUB_TOKEN}` } : {}) };
  }
  async releases() {
    if (this.running) fail('任务执行中，请稍后刷新。');
    const list = [];
    for (let page = 1; page <= 10; page++) {
      const { body } = await this.request(`${API}/releases?per_page=100&page=${page}`, { headers: this.githubHeaders() }, 8 * 1024 * 1024);
      const data = JSON.parse(body.toString()); if (!Array.isArray(data)) fail('GitHub 未返回 Release 列表。');
      list.push(...data.filter(item => !item.draft).map(normalizeRelease));
      if (data.length < 100) { this.state.releases = list; this.save(); return this.status(); }
    }
    fail('Release 超过 1000 条，未完整读取，停止以免误判。');
  }
  async release(tag) {
    if (!safeName(tag)) fail('版本号无效。');
    const { body } = await this.request(`${API}/releases/tags/${encodeURIComponent(tag)}`, { headers: this.githubHeaders() }, 2 * 1024 * 1024);
    return normalizeRelease(JSON.parse(body.toString()));
  }
  async download(asset) {
    let url = asset.url;
    for (let hop = 0; hop < 5; hop++) {
      const response = await this.fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(600000), headers: { 'User-Agent': 'sma-center-release-sync' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = new URL(response.headers.get('location') || '', url); await response.body?.cancel();
        if (next.protocol !== 'https:' || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(next.hostname)) fail('拒绝不受信任的附件重定向。');
        url = next.href; continue;
      }
      if (!response.ok) { await response.body?.cancel(); fail(`GitHub 附件下载失败（HTTP ${response.status}）。`); }
      const body = await boundedBody(response);
      if (!asset.digest || body.length !== asset.size || sha(body) !== asset.digest) fail(`附件 ${asset.name} 缺少可信摘要或 SHA-256 校验失败。`);
      return body;
    }
    fail('附件重定向次数过多。');
  }
  async list(path = '/') {
    const { body } = await this.request(`${this.share()}/dirs?path=${encodeURIComponent(path)}`, {}, 2 * 1024 * 1024);
    const entries = JSON.parse(body.toString()); if (!Array.isArray(entries)) fail('无法列举分享目录，可能已过期或需要密码。');
    return entries;
  }
  downloadUrl(tag, name) { return `${this.share()}/browse?path=${encodeURIComponent(versionPath(tag, name))}`; }
  async localDigest(tag, name) {
    const { body } = await this.request(this.downloadUrl(tag, name), { timeoutMs: 600000 });
    return sha(body);
  }
  async compare(release) {
    const directory = versionPath(release.tag);
    const root = await this.list(), folder = root.find(item => item.name === release.tag);
    if (folder && String(folder.type) !== '1') fail(`版本目录 ${directory} 被同名非目录占用，请先人工处理。`);
    const entries = folder ? await this.list(directory) : [], assets = [];
    for (const asset of release.assets) {
      this.progress(`核对 ${asset.name}`, assets.length, release.assets.length);
      const local = entries.find(item => item.name === asset.name);
      let status = 'missing';
      if (local) {
        if (String(local.type) !== '2') fail(`目标同名项 ${asset.name} 不是文件，停止操作。`);
        status = Number(local.size) === asset.size && asset.digest && await this.localDigest(release.tag, asset.name) === asset.digest ? 'aligned' : 'conflict';
      }
      assets.push({ ...asset, status: asset.digest ? status : 'unverified' });
    }
    return { id: randomUUID(), layout: MIRROR_LAYOUT, directory, folderExists: Boolean(folder), tag: release.tag, checkedAt: new Date().toISOString(), assets, extras: entries.filter(item => !release.assets.some(asset => asset.name === item.name)).length };
  }
  progress(message, done, total) {
    if (this.state.job) { Object.assign(this.state.job, { message, done, total }); this.save(); }
  }
  async uploadSession() {
    const base = new URL(this.share()), cookies = new Map();
    let url = this.share() + '/upload';
    for (let hop = 0; hop < 4; hop++) {
      const cookie = [...cookies.values()].join('; ');
      const response = await this.fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(60000), headers: cookie ? { Cookie: cookie } : {} });
      for (const value of response.headers.getSetCookie?.() || []) {
        const pair = value.split(';')[0]; cookies.set(pair.split('=')[0], pair);
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = new URL(response.headers.get('location') || '', url); await response.body?.cancel();
        if (next.origin !== base.origin || ![base.pathname + '/browse', base.pathname + '/upload'].includes(next.pathname)) fail('分享页跳转到登录页或不可信地址，请检查分享权限。');
        // Empty shares redirect /upload to /browse; pin the directory to the root.
        if (next.pathname.endsWith('/browse') && !next.search) next.searchParams.set('path', '/');
        url = next.href; continue;
      }
      if (!response.ok) { await response.body?.cancel(); fail(`获取分享上传会话失败（HTTP ${response.status}）。`); }
      const body = await boundedBody(response, 2 * 1024 * 1024);
      const csrf = body.toString().match(/['"]X-CSRF-TOKEN['"]\s*:\s*['"]([^'"]+)['"]/)?.[1];
      if (!csrf) fail('分享页未提供上传令牌，可能只读、需要密码或版本不兼容。');
      return { 'X-CSRF-TOKEN': csrf, ...(cookies.size ? { Cookie: [...cookies.values()].join('; ') } : {}) };
    }
    fail('分享页重定向次数过多。');
  }
  async sync(release, allowOverwrite) {
    const plan = await this.compare(release); this.state.comparison = plan; this.save();
    if (plan.assets.some(asset => asset.status === 'unverified')) fail('有附件缺少 GitHub SHA-256 摘要，不能自动同步。');
    if (!allowOverwrite && plan.assets.some(asset => asset.status === 'conflict')) fail('发现冲突文件。请核对后明确勾选允许替换，再重试。');
    const pending = plan.assets.filter(asset => asset.status !== 'aligned').sort((a, b) => (a.name === 'latest.txt' ? 2 : /(?:checksums|\.sha256$)/.test(a.name) ? 1 : 0) - (b.name === 'latest.txt' ? 2 : /(?:checksums|\.sha256$)/.test(b.name) ? 1 : 0));
    const headers = pending.length ? await this.uploadSession() : {};
    for (const [index, asset] of pending.entries()) {
      this.progress(`下载、校验并上传 ${versionPath(release.tag, asset.name)}`, index, pending.length);
      const body = await this.download(asset);
      this.progress(`上传 ${versionPath(release.tag, asset.name)}`, index, pending.length);
      // Do not send CSRF/cookies to GitHub. SFTPGo takes a raw file body, not multipart.
      const { response } = await this.request(`${this.share()}/%2F${encodeURIComponent(versionPath(release.tag, asset.name))}?mkdir_parents=true`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body, timeoutMs: 600000 }, 128 * 1024);
      this.progress(`回读校验 ${versionPath(release.tag, asset.name)}`, index, pending.length);
      if (response.status !== 201 || await this.localDigest(release.tag, asset.name) !== asset.digest) fail(`上传 ${asset.name} 后验证失败；未完成发布，请重新核对。`);
    }
    this.state.comparison = await this.compare(release); this.save();
    if (this.state.comparison.assets.some(asset => asset.status !== 'aligned')) fail('同步后仍有差异，请检查是否有其他发布操作同时修改目标。');
    this.progress('全部附件已通过 SHA-256 对齐验证。', pending.length, pending.length);
  }
  start(kind, tag, allowOverwrite = false) {
    if (this.running) fail('已有任务执行中，请勿重复提交。');
    this.share(); if (!['compare', 'sync'].includes(kind) || !safeName(tag)) fail('任务参数无效。');
    const checkedAt = Date.parse(this.state.comparison?.checkedAt ?? '');
    if (kind === 'sync' && (this.state.comparison?.layout !== MIRROR_LAYOUT || this.state.comparison?.directory !== versionPath(tag) || this.state.comparison?.tag !== tag || !Number.isFinite(checkedAt) || checkedAt > Date.now() || Date.now() - checkedAt > 600000)) fail('请先核对所选版本目录，核对结果有效期为 10 分钟。');
    this.running = true;
    this.state.job = { id: randomUUID(), layout: MIRROR_LAYOUT, directory: versionPath(tag), kind, tag, status: 'running', message: '读取 GitHub Release…', startedAt: new Date().toISOString(), done: 0, total: 0 }; this.save();
    // Persistence failures must not become an unhandled rejection in the long-lived gateway.
    this.pending = this.run(kind, tag, allowOverwrite).catch(() => { this.running = false; console.error('Release task persistence failed; inspect data volume permissions and capacity.'); });
    return this.status();
  }
  async run(kind, tag, allowOverwrite) {
    try {
      const release = await this.release(tag);
      if (kind === 'compare') { this.state.comparison = await this.compare(release); this.progress('核对完成；尚未修改文件服务器。', release.assets.length, release.assets.length); }
      else await this.sync(release, allowOverwrite);
      this.state.job.status = 'completed';
    } catch (error) {
      this.state.job.status = 'failed';
      this.state.job.message = error instanceof Error && !/https?:\/\//.test(error.message) ? error.message : '任务失败，请检查服务网络、分享权限和日志。';
    } finally {
      this.running = false; this.state.job.finishedAt = new Date().toISOString();
      this.state.history = [this.state.job, ...this.state.history].slice(0, 20); this.save();
    }
  }
  async commands(tag, platform) {
    if (!safeName(tag) || !['linux', 'windows'].includes(platform)) fail('文档参数无效。');
    const paths = platform === 'windows' ? ['docs/windows/README.md'] : ['docs/automatic-installation.md', 'docs/lifecycle.md'];
    const documents = [];
    if (this.state.share) {
      const release = await this.release(tag);
      const groups = release.assets.filter(asset => asset.digest && (platform === 'linux' ? /\.(deb|rpm|apk)$/.test(asset.name) : /\.msi$/.test(asset.name))).map(asset => {
        const url = this.downloadUrl(tag, asset.name);
        const native = asset.name.endsWith('.deb') ? `sudo apt install ./${asset.name}` : asset.name.endsWith('.rpm') ? `sudo dnf install ./${asset.name}` : `sudo apk add --allow-untrusted ./${asset.name}`;
        const command = platform === 'linux'
          ? `curl -fL ${shellQuote(url)} -o ${shellQuote(asset.name)} && \\\nprintf '%s  %s\\n' ${shellQuote(asset.digest)} ${shellQuote(asset.name)} | sha256sum -c - && \\\n${native}`
          : `$ErrorActionPreference = 'Stop'\nInvoke-WebRequest -Uri ${psQuote(url)} -OutFile ${psQuote(asset.name)}\nif ((Get-FileHash -LiteralPath ${psQuote(asset.name)} -Algorithm SHA256).Hash.ToLowerInvariant() -ne ${psQuote(asset.digest)}) { throw 'SHA-256 mismatch' }\n$install = Start-Process msiexec.exe -ArgumentList @('/i', ('"' + (Resolve-Path ${psQuote(asset.name)}).Path + '"')) -Verb RunAs -Wait -PassThru\nif ($install.ExitCode -notin @(0, 3010)) { throw ('MSI failed: ' + $install.ExitCode) }`;
        return { title: `下载、校验并安装 ${asset.name}`, language: platform === 'linux' ? 'sh' : 'powershell', command, dangerous: asset.name.endsWith('.apk') };
      });
      documents.push({ path: `版本目录 ${versionPath(tag)} · 按系统和架构只选一个安装包`, source: `https://github.com/${REPOSITORY}/blob/${encodeURIComponent(tag)}/docs/${platform === 'linux' ? 'installation.md' : 'windows/README.md'}`, groups, error: groups.length ? null : '该版本没有可生成原生安装命令的带摘要安装包。' });
    }
    for (const path of paths) {
      const source = `https://raw.githubusercontent.com/${REPOSITORY}/${encodeURIComponent(tag)}/${path}`;
      try {
        const { body } = await this.request(source, {}, 512 * 1024);
        const groups = extractCommands(body.toString()).filter(group => !/install-sma\.sh|sma-ctl upgrade|pubshares\//.test(group.command));
        documents.push({ path, source: `https://github.com/${REPOSITORY}/blob/${encodeURIComponent(tag)}/${path}`, groups, error: null });
      } catch { documents.push({ path, source: `https://github.com/${REPOSITORY}/tree/${encodeURIComponent(tag)}/docs`, groups: [], error: '该标签未提供此文档，或 GitHub 暂时不可达。不会用其他版本文档替代。' }); }
    }
    return { tag, platform, directory: versionPath(tag), documents };
  }
}

export function releaseService() {
  const symbol = Symbol.for('sma-center.release-sync.v1');
  if (!globalThis[symbol]) globalThis[symbol] = new ReleaseSyncService(process.env.SMA_CENTER_DATA_DIR || join(process.cwd(), '.sma-center-data'));
  return globalThis[symbol];
}
