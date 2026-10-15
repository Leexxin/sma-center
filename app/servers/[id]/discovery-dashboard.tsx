"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Vinext's next/link prefetch shim errors on this dynamic route. */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowLeft, Check, ChevronRight, CircleDot, Clock3, Database,
  FileStack, Gauge, Network, Play, Radar, RefreshCw, Server, ShieldCheck, Waypoints,
} from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { Preferences, Resource } from "@/db/resources";

type Capabilities = { enabled: boolean; detectors: string[]; reportEnabled: boolean; maxConcurrency: number };
type RunStatus = "queued" | "running" | "succeeded" | "partial" | "failed";
type DiscoveryAsset = {
  id: string; category: string; product: string; displayName: string; status: string; confidence: string;
  ports?: Array<{ protocol?: string; port?: number }>;
  evidence?: Array<{ source?: string; value?: string; pid?: number }>;
  detectedAt?: string;
};
type DiscoveryRun = {
  id: string; status: RunStatus; detectors?: string[]; createdAt?: string; startedAt?: string; completedAt?: string; assetCount?: number;
  result?: { schemaVersion?: string; host?: { hostname?: string }; assets?: DiscoveryAsset[]; summary?: Record<string, number>; errors?: Array<{ detector?: string; code?: string; message?: string }> };
  report?: { requested?: boolean; status?: string; attempts?: number; lastAttempt?: string };
};

const terminal = new Set<RunStatus>(["succeeded", "partial", "failed"]);
const statusLabel: Record<RunStatus, string> = { queued: "等待执行", running: "正在发现", succeeded: "发现完成", partial: "部分完成", failed: "发现失败" };
const categoryMeta: Record<string, { label: string; icon: typeof Database }> = {
  database: { label: "数据库", icon: Database }, middleware: { label: "中间件", icon: Network }, file_transfer: { label: "文件传输", icon: FileStack },
};

async function readPayload(response: Response) {
  const payload: unknown = await response.json().catch(() => null);
  const apiError = payload && typeof payload === "object" && "error" in payload
    ? (payload as { error?: { message?: string } }).error
    : undefined;
  if (!response.ok) throw new Error(apiError?.message ?? `请求失败：HTTP ${response.status}`);
  return payload;
}

export default function DiscoveryDashboard({ server, preferences }: { server: Resource; preferences: Preferences }) {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [runs, setRuns] = useState<DiscoveryRun[]>([]);
  const [activeRun, setActiveRun] = useState<DiscoveryRun | null>(null);
  const [report, setReport] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/resources/${server.id}/discovery`;

  const loadRun = useCallback(async (runId: string) => {
    try {
      const response = await fetch(`${base}/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
      const run = await readPayload(response) as DiscoveryRun;
      setError("");
      setActiveRun(run);
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)].slice(0, 20));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取发现任务失败。");
    }
  }, [base]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [capabilityResponse, runsResponse] = await Promise.all([
        fetch(`${base}/capabilities`, { cache: "no-store" }),
        fetch(`${base}/runs`, { cache: "no-store" }),
      ]);
      const caps = await readPayload(capabilityResponse) as Capabilities;
      const history = await readPayload(runsResponse) as { runs?: DiscoveryRun[] };
      setCapabilities(caps);
      setSelected(caps.detectors ?? []);
      setReport(Boolean(caps.reportEnabled));
      const nextRuns = history.runs ?? [];
      setRuns(nextRuns);
      if (nextRuns[0]) await loadRun(nextRuns[0].id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法连接 SMA 自动发现服务。");
    } finally {
      setLoading(false);
    }
  }, [base, loadRun]);

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.style.colorScheme = preferences.theme;
    const timer = window.setTimeout(() => void loadOverview(), 0);
    return () => window.clearTimeout(timer);
  }, [loadOverview, preferences.theme]);

  useEffect(() => {
    if (!activeRun || terminal.has(activeRun.status)) return;
    const timer = window.setTimeout(() => void loadRun(activeRun.id), 1000);
    return () => window.clearTimeout(timer);
  }, [activeRun, loadRun]);

  async function startDiscovery() {
    setStarting(true);
    setError("");
    try {
      const response = await fetch(`${base}/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ detectors: selected, report }) });
      if (response.status === 409) {
        toast.info("这台服务器已有发现任务正在执行");
        await loadOverview();
        return;
      }
      const created = await readPayload(response) as DiscoveryRun;
      setActiveRun(created);
      toast.success("自动发现任务已创建");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "创建发现任务失败。";
      setError(message);
      toast.error(message);
    } finally {
      setStarting(false);
    }
  }

  const assets = useMemo(() => activeRun?.result?.assets ?? [], [activeRun?.result?.assets]);
  const summary = activeRun?.result?.summary;
  const groupedAssets = useMemo(() => Object.entries(assets.reduce<Record<string, DiscoveryAsset[]>>((groups, asset) => {
    (groups[asset.category] ??= []).push(asset);
    return groups;
  }, {})), [assets]);
  const isRunning = activeRun && !terminal.has(activeRun.status);

  return <div className={`discovery-shell theme-${preferences.theme} accent-${preferences.accent}`}>
    <Toaster position="top-right" richColors />
    <header className="discovery-topbar"><a href="/" className="back-link"><ArrowLeft />返回工具站</a><div className="discovery-brand"><span>S</span><strong>sma-center / SMA DISCOVERY</strong></div><div className={`agent-state ${error ? "offline" : loading ? "connecting" : "online"}`}><CircleDot />{error ? "连接异常" : loading ? "正在连接" : "Agent 已连接"}</div></header>
    <main className="discovery-main">
      <section className="discovery-hero"><div><p className="eyebrow">SERVER INTELLIGENCE</p><h1>{server.name}</h1><p>{server.description || "SMA 自动发现控制台"}</p><div className="server-address"><Server />{server.agentUrl}</div></div><div className="hero-orbit" aria-hidden="true"><Radar /><span /><span /></div></section>

      {error && <section className="discovery-error"><AlertTriangle /><div><strong>无法使用自动发现</strong><p>{error}</p></div><Button variant="outline" onClick={loadOverview}><RefreshCw />重新连接</Button></section>}

      <section className="discovery-overview">
        <div className="capability-card"><div className="panel-title"><div><ShieldCheck /><span><strong>发现能力</strong><small>由 Agent 动态提供</small></span></div><b>{capabilities?.enabled ? "已启用" : loading ? "连接中" : "不可用"}</b></div><div className="detector-list">{capabilities?.detectors.map((detector) => <button key={detector} className={selected.includes(detector) ? "selected" : ""} onClick={() => setSelected((current) => current.includes(detector) ? current.filter((item) => item !== detector) : [...current, detector])}><span>{selected.includes(detector) && <Check />}</span>{detector}</button>)}{!capabilities?.detectors.length && <p>暂无可用探测器</p>}</div><label className="report-option"><Checkbox checked={report} disabled={!capabilities?.reportEnabled} onCheckedChange={(checked) => setReport(Boolean(checked))} /><span><strong>同步到固定上报地址</strong><small>{capabilities?.reportEnabled ? "由 Agent 管理员预先配置" : "Agent 未配置上报地址"}</small></span></label><Button className="discovery-start" disabled={!capabilities?.enabled || !selected.length || starting || Boolean(isRunning)} onClick={startDiscovery}>{starting || isRunning ? <RefreshCw className="spin" /> : <Play />}{isRunning ? "发现进行中" : starting ? "正在创建…" : "开始自动发现"}</Button></div>
        <div className="run-card"><div className="panel-title"><div><Activity /><span><strong>最近一次任务</strong><small>{activeRun?.createdAt ? new Date(activeRun.createdAt).toLocaleString("zh-CN") : "尚未执行"}</small></span></div>{activeRun && <b className={`run-${activeRun.status}`}>{statusLabel[activeRun.status]}</b>}</div><div className="run-stage"><div className={activeRun ? "complete" : ""}><span /><small>任务创建</small></div><i /><div className={activeRun?.startedAt || activeRun?.status === "running" ? "complete" : ""}><span /><small>探测执行</small></div><i /><div className={activeRun && terminal.has(activeRun.status) ? "complete" : ""}><span /><small>结果聚合</small></div></div><div className="run-stats"><span><b>{summary?.total ?? activeRun?.assetCount ?? 0}</b>发现资产</span><span><b>{activeRun?.detectors?.length ?? selected.length}</b>探测器</span><span><b>{activeRun?.report?.attempts ?? 0}</b>上报尝试</span></div>{activeRun?.report && <div className="report-status"><Waypoints />上报状态：{activeRun.report.status ?? "未知"}</div>}</div>
      </section>

      <section className="asset-section"><div className="asset-head"><div><p className="eyebrow">DISCOVERED ASSETS</p><h2>发现的服务</h2><p>结果来自只读进程、端口和白名单脚本探测。</p></div><span>{assets.length} 项资产</span></div>{assets.length ? <div className="asset-groups">{groupedAssets.map(([category, items]) => { const meta = categoryMeta[category] ?? { label: category, icon: Gauge }; const Icon = meta.icon; return <section className="asset-group" key={category}><header><Icon /><strong>{meta.label}</strong><span>{items.length}</span></header><div className="asset-grid">{items.map((asset) => <article className="asset-card" key={asset.id}><div className="asset-card-head"><div><span className={`confidence confidence-${asset.confidence}`} /><div><h3>{asset.displayName}</h3><small>{asset.product}</small></div></div><b>{asset.status === "running" ? "运行中" : "已配置"}</b></div><div className="port-list">{asset.ports?.length ? asset.ports.map((port) => <span key={`${port.protocol}-${port.port}`}>{port.protocol?.toUpperCase()} {port.port}</span>) : <span>未发现监听端口</span>}</div><details><summary>查看发现依据 <ChevronRight /></summary><div className="evidence-list">{asset.evidence?.map((item, index) => <div key={`${item.source}-${index}`}><span>{item.source}</span><p>{item.value}</p>{item.pid && <b>PID {item.pid}</b>}</div>)}</div></details></article>)}</div></section>; })}</div> : <div className="asset-empty"><Radar /><strong>{isRunning ? "正在扫描服务与配置" : "还没有发现结果"}</strong><p>{isRunning ? "任务完成后，资产会自动出现在这里。" : "选择探测器并开始一次自动发现。"}</p></div>}</section>

      {!!activeRun?.result?.errors?.length && <section className="discovery-warnings"><AlertTriangle /><div><strong>部分探测器未完成</strong>{activeRun.result.errors.map((item, index) => <p key={`${item.detector}-${index}`}>{item.detector}: {item.message ?? item.code}</p>)}</div></section>}

      <section className="history-section"><div className="asset-head"><div><p className="eyebrow">RECENT RUNS</p><h2>任务历史</h2></div><Button variant="ghost" onClick={loadOverview}><RefreshCw />刷新</Button></div><div className="history-list">{runs.length ? runs.map((run) => <button key={run.id} className={activeRun?.id === run.id ? "active" : ""} onClick={() => loadRun(run.id)}><span className={`history-status run-${run.status}`}><Clock3 /></span><div><strong>{statusLabel[run.status]}</strong><small>{run.createdAt ? new Date(run.createdAt).toLocaleString("zh-CN") : run.id}</small></div><b>{run.assetCount ?? run.result?.summary?.total ?? "—"} 项</b><ChevronRight /></button>) : <div className="history-empty">Agent 暂无保留的发现任务</div>}</div></section>
    </main>
  </div>;
}
