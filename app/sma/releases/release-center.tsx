'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Check, Copy, Download, GitBranch, Package, RefreshCw, ShieldCheck, Terminal, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

type Asset = { name: string; size: number; digest: string | null; url: string; status?: string };
type Release = { tag: string; name: string; prerelease: boolean; publishedAt: string; url: string; body: string; assets: Asset[] };
type Job = { id: string; tag: string; kind: string; status: string; message: string; done: number; total: number; startedAt: string };
type State = { configured: boolean; targetOrigin: string | null; releases: Release[]; comparison: null | { id: string; tag: string; checkedAt: string; assets: Asset[]; extras: number }; job: Job | null; history: Job[] };
type Commands = { tag: string; platform: string; documents: { path: string; source: string; error: string | null; groups: { title: string; language: string; command: string; dangerous: boolean }[] }[] };
const labels: Record<string, string> = { missing: '缺失', aligned: 'SHA-256 一致', conflict: '内容冲突', unverified: '缺少摘要' };
const size = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function request<T = State>(body?: object): Promise<T> {
  const response = await fetch('/api/sma/releases', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error((result as { error?: string })?.error || '操作失败');
  return result as T;
}

function CommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      let success = false;
      if (navigator.clipboard && window.isSecureContext) {
        try { await navigator.clipboard.writeText(command); success = true; } catch { /* Fall back when browser clipboard permission is unavailable. */ }
      }
      if (!success) {
        const previous = document.activeElement;
        const input = document.createElement('textarea'); input.value = command; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.appendChild(input); input.select();
        success = document.execCommand('copy'); input.remove();
        if (previous instanceof HTMLElement) previous.focus();
        if (!success) throw new Error();
      }
      setCopied(true); window.setTimeout(() => setCopied(false), 1600);
    } catch { toast.error('复制失败，请手动选中命令复制。'); }
  }
  return <div className="release-command"><pre><code>{command}</code></pre><button onClick={copy} aria-label="复制此命令">{copied ? <Check /> : <Copy />}{copied ? '已复制' : '复制'}</button></div>;
}

export default function ReleaseCenter({ theme, accent }: { theme: string; accent: string }) {
  const [state, setState] = useState<State | null>(null);
  const [tag, setTag] = useState('');
  const [share, setShare] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [tab, setTab] = useState<'files' | 'commands'>('files');
  const [platform, setPlatform] = useState('linux');
  const [commands, setCommands] = useState<Commands | null>(null);
  const [commandsBusy, setCommandsBusy] = useState(false);
  const [commandsError, setCommandsError] = useState('');
  const load = useCallback(async () => {
    try { const next = await request() as State; setState(next); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : '读取失败'); }
  }, []);
  useEffect(() => { let active = true; request().then(next => { if (active) { setState(next); setTag(next.releases.find(item => !item.prerelease)?.tag || next.releases[0]?.tag || ''); } }).catch(err => { if (active) setError(err.message); }); return () => { active = false; }; }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; }, [theme]);
  const running = state?.job?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void load(), 1500);
    return () => window.clearInterval(timer);
  }, [running, load]);
  useEffect(() => {
    if (!tag || tab !== 'commands') return;
    let active = true;
    request<Commands>({ action: 'commands', tag, platform }).then(result => { if (active) { setCommands(result); setCommandsBusy(false); } }).catch(err => { if (active) { setCommandsError(err.message); setCommandsBusy(false); } });
    return () => { active = false; };
  }, [tag, platform, tab]);
  async function act(action: string) {
    setBusy(true); setError('');
    try {
      const next = await request({ action, tag, ...(action === 'configure' ? { shareUrl: share } : {}), allowOverwrite: overwrite }) as State;
      setState(next);
      if (action === 'configure') { setShare(''); setOverwrite(false); toast.success('分享地址已加密保存'); }
      if (action === 'refresh' && !next.releases.some(item => item.tag === tag)) setTag(next.releases.find(item => !item.prerelease)?.tag || next.releases[0]?.tag || '');
    } catch (err) { setError(err instanceof Error ? err.message : '操作失败'); }
    finally { setBusy(false); }
  }
  const release = state?.releases.find(item => item.tag === tag);
  const comparison = state?.comparison?.tag === tag ? state.comparison : null;
  const assets = comparison?.assets || release?.assets || [];
  const conflicts = comparison?.assets.filter(item => item.status === 'conflict').length || 0;
  const missing = comparison?.assets.filter(item => item.status === 'missing').length || 0;
  const aligned = comparison?.assets.filter(item => item.status === 'aligned').length || 0;
  const disabled = busy || running;
  return <div className={`release-center theme-${theme} accent-${accent}`}>
    <Toaster richColors />
    <header className="release-topbar"><Link href="/"><ArrowLeft />返回工作台</Link><span><ShieldCheck />验证器保护</span></header>
    <main className="release-main">
      <section className="release-heading"><div><p className="eyebrow">SOFTWARE DELIVERY</p><h1>SMA 版本中心<span>Release Hub</span></h1><p>从 GitHub 到内网，让每一次交付都有据可查。</p></div><Button onClick={() => act('refresh')} disabled={disabled}><RefreshCw className={busy ? 'spin' : ''} />刷新 GitHub</Button></section>
      {error && <div role="alert" className="release-alert"><TriangleAlert />{error}<button onClick={() => void load()}>重试读取</button></div>}
      <section className="release-endpoints" aria-label="同步来源与目标">
        <div><GitBranch /><span><small>权威发布源</small><a href="https://github.com/Leexxin/server-monitor-agent/releases" target="_blank" rel="noreferrer">Leexxin / server-monitor-agent<ArrowUpRight /></a></span><b>GitHub Releases</b></div>
        <div><Download /><span><small>内网镜像 · SFTPGo</small><strong>{state?.targetOrigin || '尚未配置本地文件仓库'}</strong></span><b>{state?.configured ? '已保存' : '待配置'}</b></div>
      </section>
      <details className="release-config" open={!state?.configured}><summary>配置本地分享地址</summary><p>填写 SFTPGo 的 upload 分享页。需要同时具备列举、下载和上传权限；地址加密保存，不会写入 Git 或页面 JSON 备份。</p><div><Input aria-label="SFTPGo 分享地址" type="url" value={share} onChange={event => setShare(event.target.value)} placeholder="http://文件服务器:8080/web/client/pubshares/分享标识/upload" disabled={disabled} /><Button onClick={() => act('configure')} disabled={disabled || !share.trim()}>保存配置</Button></div></details>
      <div className="release-workspace">
        <aside className="release-versions"><div className="release-panel-title"><Package /><h2>发布版本</h2><span>{state?.releases.length || 0}</span></div><p>包含稳定版和预览版</p>{!state?.releases.length && <div className="release-empty">点击右上角“刷新 GitHub”<br />获取实际发布版本</div>}{state?.releases.map(item => <button key={item.tag} className={tag === item.tag ? 'selected' : ''} aria-pressed={tag === item.tag} disabled={disabled} onClick={() => { setTag(item.tag); setOverwrite(false); setCommands(null); setCommandsError(''); setCommandsBusy(tab === 'commands'); }}><span><strong>{item.tag}</strong><small>{item.prerelease ? '预览版' : '稳定版'} · {item.assets.length} 个附件</small></span><small>{new Date(item.publishedAt).toLocaleDateString('zh-CN')}</small></button>)}</aside>
        <section className="release-content">
          {!release ? <div className="release-welcome"><Package /><h2>选择一个发布版本</h2><p>核对真实文件内容，再决定是否同步。不会自动安装或执行任何脚本。</p></div> : <>
            <div className="release-version-heading"><div><span className="release-tag">{release.prerelease ? 'PRE-RELEASE' : 'STABLE RELEASE'}</span><h2>{release.name}</h2><a href={release.url} target="_blank" rel="noreferrer">查看 GitHub 发布说明<ArrowUpRight /></a></div><span>{size(release.assets.reduce((sum, asset) => sum + asset.size, 0))}<small>{release.assets.length} 个附件</small></span></div>
            <div role="tablist" aria-label="版本内容" className="release-tabs"><button role="tab" aria-selected={tab === 'files'} onClick={() => setTab('files')}><Package />附件与对齐</button><button role="tab" aria-selected={tab === 'commands'} onClick={() => { if (tab !== 'commands') { setTab('commands'); setCommandsBusy(true); setCommandsError(''); } }}><Terminal />安装与运维命令</button></div>
            {tab === 'files' ? <>
              <div className="release-stats"><div><small>缺失附件</small><strong>{comparison ? missing : '—'}</strong></div><div><small>内容冲突</small><strong>{comparison ? conflicts : '—'}</strong></div><div><small>校验一致</small><strong>{comparison ? aligned : '—'}</strong></div></div>
              <div className="release-actions"><Button variant="outline" onClick={() => act('compare')} disabled={disabled || !state?.configured}><ShieldCheck />核对两边仓库</Button><Button onClick={() => act('sync')} disabled={disabled || !comparison || !assets.length || assets.some(asset => asset.status === 'unverified') || (conflicts > 0 && !overwrite)}><Download />同步所选版本</Button></div>
              <p className="release-help">核对会下载同名文件计算 SHA-256。同步仅写入所选版本附件，保留其他文件；需要分享地址同时支持读写。</p>
              {comparison && <label className="release-overwrite"><input type="checkbox" checked={overwrite} disabled={disabled} onChange={event => setOverwrite(event.target.checked)} /><span>允许替换所选版本的冲突文件，包括脚本、校验清单及版本索引。<small>同步旧 Linux 版本可能回退安装源；不会删除其他版本的包。没有原子发布窗口，请避免同时手动上传。</small></span></label>}
              {state?.job && <div className={`release-job ${state.job.status}`} role="status" aria-live="polite"><div><strong>{state.job.tag} · {state.job.kind === 'sync' ? '同步' : '核对'}</strong><span>{({ running: '执行中', failed: '失败', completed: '已完成', interrupted: '已中断' } as Record<string, string>)[state.job.status]}</span></div><p>{state.job.message}</p><progress max={Math.max(state.job.total, 1)} value={state.job.done} aria-label="当前阶段文件进度" /><small>{state.job.done} / {state.job.total} · 阶段进度，不代表整体字节百分比</small></div>}
              <div className="release-table-wrap"><table><thead><tr><th>发布附件</th><th>大小</th><th>本地状态</th></tr></thead><tbody>{assets.map(asset => <tr key={asset.name}><td><a href={asset.url} target="_blank" rel="noreferrer">{asset.name}<ArrowUpRight /></a><small title={asset.digest || '缺少可信 SHA-256'}>{asset.digest ? `SHA-256 ${asset.digest.slice(0, 16)}…` : '未提供 SHA-256'}</small></td><td>{size(asset.size)}</td><td><span className={`release-file-state ${asset.status || ''}`}>{labels[asset.status || ''] || '尚未核对'}</span></td></tr>)}</tbody></table></div>
              {comparison && <p className="release-help">核对时间：{new Date(comparison.checkedAt).toLocaleString('zh-CN')}。额外 {comparison.extras} 个本地项目保持不变。同步前会重新核对。</p>}
              <details className="release-notes"><summary>发布说明</summary><pre>{release.body || '此版本未提供说明。'}</pre></details>
            </> : <div className="release-docs">
              <div className="release-platform" role="group" aria-label="命令平台">{['linux', 'windows'].map(value => <button aria-pressed={platform === value} key={value} onClick={() => { if (platform !== value) { setPlatform(value); setCommandsBusy(true); setCommandsError(''); } }}>{value === 'linux' ? 'Linux' : 'Windows / PowerShell'}</button>)}</div>
              <div className="release-warning"><TriangleAlert /><p>命令来自所选 Release 标签的项目文档，展示不代表执行。先阅读原文和权限要求，再到目标服务器运行。Token 不要粘贴到公开日志；卸载、清理、换 Token 和升级可能中断服务。</p></div>
              {commandsBusy && <p role="status">正在读取该版本文档…</p>}{commandsError && <p role="alert">{commandsError}</p>}
              {!commandsBusy && commands?.tag === tag && commands.platform === platform && commands.documents.map(document => <section key={document.path}><div className="release-doc-heading"><h3>{document.path}</h3><a href={document.source} target="_blank" rel="noreferrer">阅读完整文档<ArrowUpRight /></a></div>{document.error && <p className="release-warning">{document.error}</p>}{document.groups.map((group, index) => <details className="release-command-group" key={index} open={index === 0}><summary>{group.title}{group.dangerous && <span>含风险操作 · 请先备份</span>}</summary><CommandBlock command={group.command} /></details>)}</section>)}
            </div>}
          </>}
        </section>
      </div>
      {!!state?.history.length && <details className="release-history"><summary>最近任务记录 · {state.history.length}</summary>{state.history.map(job => <div key={job.id}><span>{new Date(job.startedAt).toLocaleString('zh-CN')} · {job.tag} · {job.kind}</span><strong>{job.status}</strong><p>{job.message}</p></div>)}</details>}
      <footer className="release-footer"><ShieldCheck />先核对，再发布。GitHub 为源，内网为镜像，不反向修改 GitHub，不自动执行安装。</footer>
    </main>
  </div>;
}
