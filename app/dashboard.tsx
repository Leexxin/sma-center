"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  CircleDot,
  Cloud,
  Command,
  Cpu,
  DatabaseBackup,
  Download,
  FileJson,
  Activity,
  Clock3,
  Globe2,
  HardDrive,
  LayoutDashboard,
  KeyRound,
  ListRestart,
  MemoryStick,
  Moon,
  MoreHorizontal,
  Pin,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Server,
  Settings2,
  Sun,
  SlidersHorizontal,
  Star,
  RefreshCw,
  Radar,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { Accent, Density, Preferences, Resource, ResourceKind, ResourceStatus, ResourceWrite, Theme } from "@/db/resources";

type DashboardProps = {
  initialResources: Resource[];
  initialPreferences: Preferences;
  user: { displayName: string; email: string };
  canManageBackups: boolean;
};

type BackupPreview = {
  backup: unknown;
  name: string;
  exportedAt?: string;
  users: number;
  preferences: number;
  resources: number;
};

type ResourceDraft = ResourceWrite;

type LiveSnapshot = {
  schemaVersion: "v1";
  timestamp?: string;
  hostname: string;
  cpu: { logicalCount: number; totalSeconds: number; idleSeconds: number };
  memory: null | Record<string, number>;
  filesystems: Array<Record<string, string | number | boolean>>;
  disks: Array<Record<string, string | number>>;
  load: null | { load1?: number; load5?: number; load15?: number };
  uptimeSeconds: number | null;
  bootTimeSeconds: number | null;
  errors: Array<{ collector?: string; code?: string; message?: string }>;
};

type ServerMonitor = { snapshot?: LiveSnapshot; cpuUsage?: number; loading?: boolean; error?: string };

const emptyDraft: ResourceDraft = {
  kind: "tool",
  name: "",
  url: "",
  description: "",
  category: "其他",
  status: "unknown",
  note: "",
  pinned: false,
  cpuUsage: 0,
  temperature: 0,
  memoryUsage: 0,
  diskUsage: 0,
  agentUrl: "",
};

const kindMeta: Record<ResourceKind, { label: string; icon: typeof Wrench }> = {
  tool: { label: "工具", icon: Wrench },
  site: { label: "站点", icon: Globe2 },
  server: { label: "服务器", icon: Server },
};

const statusMeta: Record<ResourceStatus, { label: string; className: string }> = {
  online: { label: "运行中", className: "status-online" },
  warning: { label: "需关注", className: "status-warning" },
  offline: { label: "已离线", className: "status-offline" },
  unknown: { label: "未检查", className: "status-unknown" },
};

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function formatBytes(value?: number) {
  if (!value || value < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
}

function formatDuration(value?: number | null) {
  if (!value) return "—";
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  return days ? `${days} 天 ${hours} 小时` : `${hours} 小时`;
}

async function readError(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return payload?.error ?? "操作失败，请稍后重试。";
}

export default function Dashboard({ initialResources, initialPreferences, user, canManageBackups }: DashboardProps) {
  const [resources, setResources] = useState(initialResources);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [filter, setFilter] = useState<"all" | ResourceKind>("all");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sortingNav, setSortingNav] = useState(false);
  const [draft, setDraft] = useState<ResourceDraft>(emptyDraft);
  const [agentToken, setAgentToken] = useState("");
  const [clearAgentToken, setClearAgentToken] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [backupPreview, setBackupPreview] = useState<BackupPreview | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(preferences);
  const [serverMonitors, setServerMonitors] = useState<Record<string, ServerMonitor>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const rawSnapshotsRef = useRef<Record<string, LiveSnapshot>>({});

  const counts = useMemo(() => ({
    tool: resources.filter((item) => item.kind === "tool").length,
    site: resources.filter((item) => item.kind === "site").length,
    server: resources.filter((item) => item.kind === "server").length,
    healthy: resources.filter((item) => item.status === "online").length,
  }), [resources]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return resources.filter((item) => {
      const inTab = filter === "all" || item.kind === filter;
      const inSearch = !needle || [item.name, item.description, item.category, item.url, item.note].join(" ").toLowerCase().includes(needle);
      const inCategory = category === "all" || item.category === category;
      return inTab && inSearch && inCategory;
    });
  }, [resources, filter, query, category]);

  const favorites = useMemo(() => resources.filter((item) => item.pinned && (filter === "all" || item.kind === filter)), [resources, filter]);
  const categories = useMemo(() => Array.from(new Set(resources.filter((item) => filter === "all" || item.kind === filter).map((item) => item.category))).sort(), [resources, filter]);

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.style.colorScheme = preferences.theme;
  }, [preferences.theme]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
      if (event.key === "Escape" && document.activeElement === searchInputRef.current && query) {
        setQuery("");
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [query]);

  function startAdd(kind: ResourceKind = "tool") {
    setEditingId(null);
    setDraft({ ...emptyDraft, kind, status: kind === "tool" ? "online" : "unknown" });
    setAgentToken("");
    setClearAgentToken(false);
    setResourceOpen(true);
  }

  function startEdit(resource: Resource) {
    setEditingId(resource.id);
    setDraft({
      kind: resource.kind,
      name: resource.name,
      url: resource.url,
      description: resource.description,
      category: resource.category,
      status: resource.status,
      note: resource.note,
      pinned: resource.pinned,
      cpuUsage: resource.cpuUsage,
      temperature: resource.temperature,
      memoryUsage: resource.memoryUsage,
      diskUsage: resource.diskUsage,
      agentUrl: resource.agentUrl,
    });
    setAgentToken("");
    setClearAgentToken(false);
    setResourceOpen(true);
  }

  async function persistResource(input: ResourceDraft, id?: string, credential?: { agentToken?: string; clearAgentToken?: boolean }) {
    const response = await fetch(id ? `/api/resources/${id}` : "/api/resources", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, ...credential }),
    });
    if (!response.ok) throw new Error(await readError(response));
    const saved = await response.json() as Resource;
    setResources((current) => id ? current.map((item) => item.id === id ? saved : item) : [saved, ...current]);
    return saved;
  }

  async function handleSave() {
    setSaving(true);
    try {
      await persistResource(draft, editingId ?? undefined, { agentToken: agentToken || undefined, clearAgentToken });
      setAgentToken("");
      setClearAgentToken(false);
      setResourceOpen(false);
      toast.success(editingId ? "已更新记录" : "已添加到主页");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editingId) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/resources/${editingId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readError(response));
      setResources((current) => current.filter((item) => item.id !== editingId));
      setDeleteOpen(false);
      setResourceOpen(false);
      toast.success("记录已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  async function handleSettingsSave() {
    setSaving(true);
    try {
      const response = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsDraft),
      });
      if (!response.ok) throw new Error(await readError(response));
      const saved = await response.json() as Preferences;
      setPreferences(saved);
      setSettingsOpen(false);
      toast.success("主页外观已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "设置保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function handleBackupDownload() {
    setSaving(true);
    try {
      const response = await fetch("/api/backup", { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const name = disposition.match(/filename="([^"]+)"/)?.[1] ?? `sma-center-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("完整备份已下载");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "备份生成失败。");
    } finally {
      setSaving(false);
    }
  }

  async function handleBackupFile(file?: File) {
    if (!file) return;
    if (file.size > 5_000_000) {
      toast.error("备份文件不能超过 5 MB。");
      return;
    }
    try {
      const backup = JSON.parse(await file.text()) as Record<string, unknown>;
      if (!["sma-center-backup-v1", "atlas-backup-v1"].includes(String(backup.format)) || !Array.isArray(backup.users) || !Array.isArray(backup.preferences) || !Array.isArray(backup.resources)) throw new Error();
      setBackupPreview({ backup, name: file.name, exportedAt: typeof backup.exportedAt === "string" ? backup.exportedAt : undefined, users: backup.users.length, preferences: backup.preferences.length, resources: backup.resources.length });
      setRestoreOpen(true);
    } catch {
      toast.error("这不是有效的 sma-center 备份文件。");
    } finally {
      if (backupInputRef.current) backupInputRef.current.value = "";
    }
  }

  async function handleRestore(mode: "merge" | "replace") {
    if (!backupPreview) return;
    setRestoring(true);
    try {
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup: backupPreview.backup, mode }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const result = await response.json() as { resources: Resource[]; preferences: Preferences };
      setResources(result.resources);
      setPreferences(result.preferences);
      setSettingsDraft(result.preferences);
      setRestoreOpen(false);
      setBackupPreview(null);
      toast.success(mode === "replace" ? "完整备份已覆盖还原" : "备份已合并还原");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "还原失败，请稍后重试。");
    } finally {
      setRestoring(false);
    }
  }

  async function savePreferenceUpdate(next: Preferences) {
    const response = await fetch("/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!response.ok) throw new Error(await readError(response));
    return response.json() as Promise<Preferences>;
  }

  async function toggleTheme() {
    const previous = preferences;
    const next: Preferences = { ...preferences, theme: preferences.theme === "dark" ? "light" : "dark" };
    setPreferences(next);
    setSettingsDraft((current) => ({ ...current, theme: next.theme }));
    try {
      setPreferences(await savePreferenceUpdate(next));
    } catch (error) {
      setPreferences(previous);
      setSettingsDraft((current) => ({ ...current, theme: previous.theme }));
      toast.error(error instanceof Error ? error.message : "主题切换失败。");
    }
  }

  async function updateSidebar(next: Preferences) {
    const previous = preferences;
    setPreferences(next);
    try {
      setPreferences(await savePreferenceUpdate(next));
    } catch (error) {
      setPreferences(previous);
      toast.error(error instanceof Error ? error.message : "侧栏设置保存失败。");
    }
  }

  function selectView(nextFilter: "all" | ResourceKind) {
    setFilter(nextFilter);
    setCategory("all");
  }

  function moveNav(kind: ResourceKind, direction: -1 | 1) {
    const order = [...preferences.navOrder];
    const from = order.indexOf(kind);
    const to = from + direction;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    void updateSidebar({ ...preferences, navOrder: order });
  }

  async function toggleFavorite(resource: Resource) {
    try {
      await persistResource({
        kind: resource.kind, name: resource.name, url: resource.url, description: resource.description,
        category: resource.category, status: resource.status, note: resource.note, pinned: !resource.pinned,
        cpuUsage: resource.cpuUsage, temperature: resource.temperature, memoryUsage: resource.memoryUsage, diskUsage: resource.diskUsage, agentUrl: resource.agentUrl,
      }, resource.id);
      toast.success(resource.pinned ? "已取消收藏" : "已加入个性化收藏");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "收藏状态更新失败。");
    }
  }

  useEffect(() => {
    const modelContext = (document as Document & { modelContext?: {
      registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void>;
    } }).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    const report = (error: unknown) => console.warn("WebMCP registration failed", error);
    try {
      void Promise.resolve(modelContext.registerTool({
        name: "list_resources",
        title: "读取个人导航记录",
        description: "读取当前用户主页中的工具、站点和服务器记录。",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async () => ({ resources }),
      }, { signal: lifecycle.signal })).catch(report);
      void Promise.resolve(modelContext.registerTool({
        name: "create_resource",
        title: "添加导航记录",
        description: "向当前用户主页添加一个工具、站点或服务器。",
        inputSchema: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["tool", "site", "server"] },
            name: { type: "string" },
            url: { type: "string" },
            description: { type: "string" },
            category: { type: "string" },
          },
          required: ["kind", "name", "url"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (value: unknown) => {
          const input = value as Partial<ResourceDraft>;
          if (!input.name || !input.url || !input.kind || !["tool", "site", "server"].includes(input.kind)) throw new Error("名称、网址和类型不能为空。");
          const saved = await persistResource({ ...emptyDraft, ...input, kind: input.kind });
          return { id: saved.id, name: saved.name, kind: saved.kind };
        },
      }, { signal: lifecycle.signal })).catch(report);
    } catch (error) {
      report(error);
    }
    return () => lifecycle.abort();
  }, [resources]);

  const monitoredServers = useMemo(() => resources.filter((item) => item.kind === "server" && item.agentUrl), [resources]);

  useEffect(() => {
    if (!monitoredServers.length) return;
    let active = true;
    async function load(resource: Resource) {
      setServerMonitors((current) => ({ ...current, [resource.id]: { ...current[resource.id], loading: true } }));
      try {
        const response = await fetch(`/api/resources/${resource.id}/snapshot`, { cache: "no-store" });
        const payload = await response.json() as LiveSnapshot & { error?: string };
        if (!response.ok) throw new Error(payload.error || "读取指标失败");
        const previous = rawSnapshotsRef.current[resource.id];
        const deltaTotal = previous ? payload.cpu.totalSeconds - previous.cpu.totalSeconds : 0;
        const deltaIdle = previous ? payload.cpu.idleSeconds - previous.cpu.idleSeconds : 0;
        const cpuUsage = deltaTotal > 0 && deltaIdle >= 0 ? Math.max(0, Math.min(100, (1 - deltaIdle / deltaTotal) * 100)) : undefined;
        rawSnapshotsRef.current[resource.id] = payload;
        if (active) setServerMonitors((current) => ({ ...current, [resource.id]: { snapshot: payload, cpuUsage, loading: false } }));
      } catch (error) {
        if (active) setServerMonitors((current) => ({ ...current, [resource.id]: { ...current[resource.id], loading: false, error: error instanceof Error ? error.message : "读取指标失败" } }));
      }
    }
    monitoredServers.forEach(load);
    const warmup = window.setTimeout(() => monitoredServers.forEach(load), 1200);
    const interval = window.setInterval(() => monitoredServers.forEach(load), 30_000);
    return () => { active = false; window.clearTimeout(warmup); window.clearInterval(interval); };
  }, [monitoredServers]);

  const initials = user.displayName.trim().slice(0, 2).toUpperCase();
  const currentLabel = filter === "all" ? preferences.pageName : kindMeta[filter].label + (filter === "tool" ? "库" : "");
  const editingCredentialConfigured = Boolean(editingId && resources.find((item) => item.id === editingId)?.credentialConfigured);

  function renderCard(resource: Resource, favorite = false) {
    const Icon = kindMeta[resource.kind].icon;
    const status = statusMeta[resource.status];
    const monitor = serverMonitors[resource.id];
    const snapshot = monitor?.snapshot;
    const memoryUsage = snapshot?.memory?.totalBytes ? (1 - Number(snapshot.memory.availableBytes ?? 0) / Number(snapshot.memory.totalBytes)) * 100 : undefined;
    const rootFs = snapshot?.filesystems.find((item) => item.mountpoint === "/") ?? snapshot?.filesystems[0];
    const filesystemUsage = rootFs && Number(rootFs.sizeBytes) > 0 ? (1 - Number(rootFs.availableBytes ?? 0) / Number(rootFs.sizeBytes)) * 100 : undefined;
    const load1 = snapshot?.load?.load1;
    const primaryMetrics = [
      { label: "CPU", value: monitor?.cpuUsage, display: monitor?.cpuUsage == null ? "—" : `${Math.round(monitor.cpuUsage)}%`, icon: Cpu },
      { label: "内存", value: memoryUsage, display: memoryUsage == null ? "—" : `${Math.round(memoryUsage)}%`, icon: MemoryStick },
      { label: "根分区", value: filesystemUsage, display: filesystemUsage == null ? "—" : `${Math.round(filesystemUsage)}%`, icon: HardDrive },
      { label: "负载", value: load1 == null ? undefined : Math.min(100, (load1 / Math.max(snapshot?.cpu.logicalCount ?? 1, 1)) * 100), display: load1 == null ? "—" : load1.toFixed(2), icon: Activity },
    ];
    return (
      <article className={`resource-card ${favorite ? "favorite-card" : ""}`} key={`${favorite ? "favorite" : "all"}-${resource.id}`}>
        <div className="card-actions"><button className={`favorite-toggle ${resource.pinned ? "active" : ""}`} aria-label={resource.pinned ? `取消收藏 ${resource.name}` : `收藏 ${resource.name}`} aria-pressed={resource.pinned} onClick={() => toggleFavorite(resource)}><Star /></button><button className="card-edit" aria-label={`编辑 ${resource.name}`} onClick={() => startEdit(resource)}><MoreHorizontal /></button></div>
        <div className={`resource-icon kind-${resource.kind}`}><Icon /></div>
        <div className="resource-copy"><div className="resource-title"><h3>{resource.name}</h3></div><p>{resource.description || "暂无说明"}</p></div>
        <div className="resource-meta"><span>{resource.category}</span>{resource.kind !== "tool" && <span className={status.className}><CircleDot />{status.label}</span>}</div>
        {resource.kind === "server" && <HoverCard openDelay={260} closeDelay={120}><HoverCardTrigger asChild><div className={`server-metrics ${monitor?.loading ? "loading" : ""}`} tabIndex={0} aria-label={`${resource.name} SMA 实时指标`}>
          {primaryMetrics.map((metric) => { const MetricIcon = metric.icon; const level = (metric.value ?? 0) >= 85 ? "critical" : (metric.value ?? 0) >= 70 ? "warning" : "normal"; return <div className={`metric ${level}`} key={metric.label}><div><span><MetricIcon />{metric.label}</span><strong>{metric.display}</strong></div><div className="metric-track"><span style={{ transform: `scaleX(${Math.min((metric.value ?? 0) / 100, 1)})` }} /></div></div>; })}
          {!resource.agentUrl && <span className="monitor-state">悬浮查看 · 尚未接入 SMA</span>}{resource.agentUrl && monitor?.loading && !snapshot && <span className="monitor-state"><RefreshCw />正在建立采样基线</span>}{monitor?.error && <span className="monitor-state error">{monitor.error}</span>}
        </div></HoverCardTrigger><HoverCardContent className="server-detail-card" side="bottom" align="start" sideOffset={12}>
          <div className="detail-head"><div><span className="detail-status" /><div><strong>{snapshot?.hostname ?? resource.name}</strong><small>SMA {snapshot?.schemaVersion ?? "v1"} · {snapshot?.timestamp ? new Date(snapshot.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "等待快照"}</small></div></div>{monitor?.loading && <RefreshCw className="spin" />}</div>
          {!resource.agentUrl ? <div className="monitor-empty"><Server /><strong>配置 SMA Agent 地址</strong><p>在编辑服务器中填写例如 http://10.0.0.10:9108，本站后端会代理读取 /v1/snapshot。</p></div> : monitor?.error && !snapshot ? <div className="monitor-empty error"><Cloud /><strong>暂时无法读取</strong><p>{monitor.error}</p></div> : snapshot && <>
            <div className="detail-summary"><div><Cpu /><span>逻辑 CPU</span><strong>{snapshot.cpu.logicalCount || "—"}</strong></div><div><Clock3 /><span>运行时间</span><strong>{formatDuration(snapshot.uptimeSeconds)}</strong></div><div><Activity /><span>负载 1 / 5 / 15</span><strong>{[snapshot.load?.load1, snapshot.load?.load5, snapshot.load?.load15].map((v) => v == null ? "—" : v.toFixed(2)).join(" / ")}</strong></div></div>
            <div className="detail-section"><h4>内存</h4><div className="detail-pairs"><span>总量 <b>{formatBytes(snapshot.memory?.totalBytes)}</b></span><span>可用 <b>{formatBytes(snapshot.memory?.availableBytes)}</b></span><span>缓存 <b>{formatBytes(snapshot.memory?.cachedBytes)}</b></span><span>Swap 可用 <b>{formatBytes(snapshot.memory?.swapFreeBytes)}</b></span></div></div>
            <div className="detail-section"><h4>文件系统</h4><div className="detail-list">{snapshot.filesystems.slice(0, 4).map((fs) => <div key={`${fs.device}-${fs.mountpoint}`}><span><b>{String(fs.mountpoint)}</b><small>{String(fs.device)} · {String(fs.filesystemType)}</small></span><strong>{formatBytes(Number(fs.availableBytes))} 可用</strong></div>)}</div></div>
            <div className="detail-section"><h4>磁盘 I/O</h4><div className="detail-list">{snapshot.disks.slice(0, 4).map((disk) => <div key={String(disk.device)}><span><b>{String(disk.device)}</b><small>当前 I/O {Number(disk.ioInProgress ?? 0)}</small></span><strong>读 {formatBytes(Number(disk.readBytes))} · 写 {formatBytes(Number(disk.writtenBytes))}</strong></div>)}</div></div>
            {!!snapshot.errors.length && <div className="collector-errors">{snapshot.errors.map((item, index) => <span key={`${item.collector}-${index}`}>{item.collector}: {item.message ?? item.code}</span>)}</div>}
          </>}
        </HoverCardContent></HoverCard>}
        {resource.kind === "server" && resource.agentUrl && snapshot && !monitor?.error && <a href={`/servers/${resource.id}`} className="sma-console-link"><span><Radar /><b>SMA 自动发现</b></span><ChevronRight /></a>}
        {!favorite && resource.note && <p className="resource-note">{resource.note}</p>}
        <a href={resource.url} target="_blank" rel="noreferrer" className="resource-link"><span>{hostname(resource.url)}</span><ArrowUpRight /></a>
      </article>
    );
  }

  return (
    <>
      <Toaster position="top-right" richColors />
      <div className={`app-shell theme-${preferences.theme} accent-${preferences.accent} density-${preferences.density} ${preferences.sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand-mark"><span>S</span><div><strong>sma-center</strong><small>PERSONAL HUB</small></div></div>
        <nav aria-label="主导航" className="side-nav">
          <button className={filter === "all" ? "active" : ""} aria-current={filter === "all" ? "page" : undefined} title="总览" onClick={() => selectView("all")}><LayoutDashboard /><b>总览</b></button>
          {preferences.navOrder.map((kind, index) => { const item = kindMeta[kind]; const Icon = item.icon; return <div className="nav-sort-row" key={kind}><button className={filter === kind ? "active" : ""} aria-current={filter === kind ? "page" : undefined} title={item.label} onClick={() => selectView(kind)}><Icon /><b>{kind === "tool" ? "工具库" : item.label}</b><span>{counts[kind]}</span></button>{sortingNav && !preferences.sidebarCollapsed && <div className="nav-move"><button aria-label={`上移${item.label}`} disabled={index === 0} onClick={() => moveNav(kind, -1)}><ArrowUp /></button><button aria-label={`下移${item.label}`} disabled={index === preferences.navOrder.length - 1} onClick={() => moveNav(kind, 1)}><ArrowDown /></button></div>}</div>; })}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-tools"><button className={`settings-button ${sortingNav ? "active" : ""}`} title="菜单排序" onClick={() => setSortingNav(!sortingNav)}><ListRestart /><b>菜单排序</b></button><button className="collapse-button" title={preferences.sidebarCollapsed ? "展开侧栏" : "收起侧栏"} aria-label={preferences.sidebarCollapsed ? "展开侧栏" : "收起侧栏"} onClick={() => updateSidebar({ ...preferences, sidebarCollapsed: !preferences.sidebarCollapsed })}>{preferences.sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</button></div>
        <button className="settings-button" title="主页设置" onClick={() => { setSettingsDraft(preferences); setSettingsOpen(true); }}><Settings2 /><b>主页设置</b></button>
        <div className="user-card">
          <div className="avatar">{initials}</div>
          <div><strong>{user.displayName}</strong><small>{user.email}</small></div>
          <MoreHorizontal />
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="mobile-brand"><span>S</span><strong>sma-center</strong></div>
          <div className="search-wrap"><Search /><Input ref={searchInputRef} aria-label="搜索工具、站点和服务器" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、分类、网址…" />{query ? <button className="clear-search" aria-label="清空搜索" onClick={() => { setQuery(""); searchInputRef.current?.focus(); }}><X /></button> : <kbd><span>⌘</span><span>K</span></kbd>}</div>
          <div className="topbar-actions"><button className="theme-toggle" onClick={toggleTheme} aria-label={preferences.theme === "dark" ? "切换到明亮模式" : "切换到黑暗模式"} title={preferences.theme === "dark" ? "明亮模式" : "黑暗模式"}>{preferences.theme === "dark" ? <Sun /> : <Moon />}</button><Button onClick={() => startAdd()} className="primary-action"><Plus />添加记录</Button></div>
        </header>

        <div className="content-wrap">
          {filter === "all" && <><section className="welcome-row">
            <div><p className="eyebrow">个人工作台 · {new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(new Date())}</p><h1>{preferences.greeting}</h1><p>你的常用入口都在这里，保持专注，快速出发。</p></div>
            <div className="health-chip"><span className="pulse-dot" /><strong>{counts.healthy}</strong><span>项服务运行正常</span></div>
          </section>

          <section className="overview-grid" aria-label="资源概览">
            <div className="overview-card featured"><div className="overview-icon"><Command /></div><span>已收录</span><strong>{resources.length}</strong><small>个常用入口</small><ChevronRight /></div>
            <div className="overview-card"><div className="overview-icon"><Wrench /></div><span>工具</span><strong>{counts.tool}</strong><small>效率与开发</small></div>
            <div className="overview-card"><div className="overview-icon"><Globe2 /></div><span>站点</span><strong>{counts.site}</strong><small>服务与内容</small></div>
            <div className="overview-card"><div className="overview-icon"><Cloud /></div><span>服务器</span><strong>{counts.server}</strong><small>节点与存储</small></div>
          </section></>}

          <section className="favorites-section" aria-labelledby="favorites-title">
            <div className="section-head compact-head"><div><p className="eyebrow">PINNED FOR YOU</p><h2 id="favorites-title">个性化收藏</h2><p>{filter === "all" ? "最常用的入口，始终放在最顺手的位置" : `${currentLabel}中已收藏的入口`}</p></div><span className="favorite-count"><Star />{favorites.length}</span></div>
            {favorites.length ? <div className="favorites-grid">{favorites.map((resource) => renderCard(resource, true))}</div> : <button className="favorite-empty" onClick={() => startAdd(filter === "all" ? "tool" : filter)}><Star /><span><strong>这里还没有收藏</strong><small>点击任意卡片上的五角星，即可固定到这里</small></span></button>}
          </section>

          <section className="library-section">
            <div className="section-head">
              <div><h2>{currentLabel}</h2><p>{filter === "all" ? "全部入口" : `全部${kindMeta[filter].label}`}</p></div>
              <Tabs value={filter} onValueChange={(value) => setFilter(value as "all" | ResourceKind)}>
                <TabsList className="filter-tabs">
                  <TabsTrigger value="all">全部</TabsTrigger><TabsTrigger value="tool">工具</TabsTrigger><TabsTrigger value="site">站点</TabsTrigger><TabsTrigger value="server">服务器</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="category-row" aria-label="按分类筛选"><button className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>全部</button>{categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div>

            {filtered.length ? (
              <div className="resource-grid">
                {filtered.map((resource) => renderCard(resource))}
                <button className="add-card" onClick={() => startAdd(filter === "all" ? "tool" : filter)}><span><Plus /></span><strong>添加新入口</strong><small>工具、站点或服务器</small></button>
              </div>
            ) : (
              <div className="empty-state"><div><Search /></div><h3>没有找到匹配项</h3><p>换个关键词，或直接添加一条新记录。</p><Button onClick={() => startAdd()}><Plus />添加记录</Button></div>
            )}
          </section>
        </div>
      </main>

      <Dialog open={resourceOpen} onOpenChange={setResourceOpen}>
        <DialogContent className="form-dialog">
          <DialogHeader><DialogTitle>{editingId ? "编辑记录" : "添加到主页"}</DialogTitle><DialogDescription>保存后会同步到你的个人空间，其他用户无法看到。</DialogDescription></DialogHeader>
          <div className="form-grid">
            <div className="field"><Label htmlFor="kind">类型</Label><Select value={draft.kind} onValueChange={(value) => setDraft({ ...draft, kind: value as ResourceKind })}><SelectTrigger id="kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="tool">工具</SelectItem><SelectItem value="site">站点</SelectItem><SelectItem value="server">服务器</SelectItem></SelectContent></Select></div>
            <div className="field"><Label htmlFor="status">状态</Label><Select value={draft.status} onValueChange={(value) => setDraft({ ...draft, status: value as ResourceStatus })}><SelectTrigger id="status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="online">运行中</SelectItem><SelectItem value="warning">需关注</SelectItem><SelectItem value="offline">已离线</SelectItem><SelectItem value="unknown">未检查</SelectItem></SelectContent></Select></div>
            <div className="field full"><Label htmlFor="name">名称</Label><Input id="name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例如：家庭服务器" /></div>
            <div className="field full"><Label htmlFor="url">网址</Label><Input id="url" type="url" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://" /></div>
            <div className="field"><Label htmlFor="category">分类</Label><Input id="category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="开发 / 运维 / 设计" /></div>
            <div className="field"><Label htmlFor="description">一句说明</Label><Input id="description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="这个入口是做什么的" /></div>
            <div className="field full"><Label htmlFor="note">备注</Label><Textarea id="note" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="机器配置、续费日或使用提醒…" /></div>
            {draft.kind === "server" && <div className="server-fields full"><div className="server-fields-head"><div><strong>SMA 实时监控</strong><small>兼容 schemaVersion v1，每 30 秒自动刷新</small></div><span>/v1/snapshot</span></div><div className="field"><Label htmlFor="agent-url">Agent 地址</Label><Input id="agent-url" type="url" value={draft.agentUrl} onChange={(e) => setDraft({ ...draft, agentUrl: e.target.value })} placeholder="http://10.0.0.10:9108" /></div><div className="field"><div className="credential-label"><Label htmlFor="agent-token">Bearer Token</Label><span className={(editingCredentialConfigured && !clearAgentToken) || agentToken ? "configured" : "empty"}>{clearAgentToken ? "保存后清除" : editingCredentialConfigured || agentToken ? "凭据已配置" : "未配置"}</span></div><div className="credential-input"><KeyRound /><Input id="agent-token" type="password" autoComplete="new-password" value={agentToken} disabled={clearAgentToken} onChange={(event) => { setAgentToken(event.target.value); setClearAgentToken(false); }} placeholder={editingCredentialConfigured ? "留空以保留现有 Token" : "输入该 Agent 的唯一 Token"} />{editingCredentialConfigured && <Button type="button" variant="ghost" className={clearAgentToken ? "undo-clear" : "clear-credential"} onClick={() => { setClearAgentToken((current) => !current); setAgentToken(""); }}>{clearAgentToken ? <ShieldCheck /> : <ShieldOff />}{clearAgentToken ? "撤销清除" : "清除"}</Button>}</div><small className="field-hint">Token 只写入服务端加密存储，不会回显、导出到备份或发送到浏览器。</small></div></div>}
            <button type="button" className={`pin-toggle ${draft.pinned ? "active" : ""}`} onClick={() => setDraft({ ...draft, pinned: !draft.pinned })}><Pin />{draft.pinned ? "已置顶到前排" : "置顶到前排"}{draft.pinned && <Check />}</button>
          </div>
          <DialogFooter className="dialog-actions">
            {editingId && <Button variant="ghost" className="delete-button" onClick={() => setDeleteOpen(true)}><Trash2 />删除</Button>}
            <div className="action-spacer" /><Button variant="ghost" onClick={() => setResourceOpen(false)}>取消</Button><Button disabled={saving || !draft.name || !draft.url} onClick={handleSave}>{saving ? "保存中…" : "保存记录"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这条记录？</AlertDialogTitle><AlertDialogDescription>删除后无法恢复，但不会影响对应的网站或服务器本身。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={handleDelete}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="form-dialog settings-dialog"><DialogHeader><DialogTitle>自定义主页</DialogTitle><DialogDescription>这些设置只属于你的账号。</DialogDescription></DialogHeader>
          <div className="settings-form">
            <div className="field"><Label htmlFor="page-name">主页名称</Label><Input id="page-name" value={settingsDraft.pageName} onChange={(e) => setSettingsDraft({ ...settingsDraft, pageName: e.target.value })} /></div>
            <div className="field"><Label htmlFor="greeting">欢迎语</Label><Input id="greeting" value={settingsDraft.greeting} onChange={(e) => setSettingsDraft({ ...settingsDraft, greeting: e.target.value })} /></div>
            <div className="field"><Label>界面主题</Label><div className="theme-options">{(["light", "dark"] as Theme[]).map((theme) => <button key={theme} className={settingsDraft.theme === theme ? "selected" : ""} onClick={() => setSettingsDraft({ ...settingsDraft, theme })}>{theme === "light" ? <Sun /> : <Moon />}{theme === "light" ? "明亮" : "黑暗"}{settingsDraft.theme === theme && <Check className="option-check" />}</button>)}</div></div>
            <div className="field"><Label>强调色</Label><div className="color-options">{(["cyan", "violet", "orange"] as Accent[]).map((accent) => <button key={accent} aria-label={`选择 ${accent} 强调色`} className={`${accent} ${settingsDraft.accent === accent ? "selected" : ""}`} onClick={() => setSettingsDraft({ ...settingsDraft, accent })}>{settingsDraft.accent === accent && <Check />}</button>)}</div></div>
            <div className="field"><Label>信息密度</Label><div className="density-options">{(["comfortable", "compact"] as Density[]).map((density) => <button key={density} className={settingsDraft.density === density ? "selected" : ""} onClick={() => setSettingsDraft({ ...settingsDraft, density })}><SlidersHorizontal />{density === "comfortable" ? "舒适" : "紧凑"}</button>)}</div></div>
            {canManageBackups && <section className="backup-panel" aria-labelledby="backup-title">
              <div className="backup-panel-head"><div className="backup-icon"><DatabaseBackup /></div><div><strong id="backup-title">全站备份与还原</strong><span>用户身份、主页设置和全部导航记录</span></div><ShieldCheck /></div>
              <p>备份明确排除 SMA Token、密码和会话凭据。覆盖还原会清除现有 SMA 凭据，之后需逐台重新配置。</p>
              <div className="backup-actions"><Button type="button" variant="outline" onClick={handleBackupDownload} disabled={saving}><Download />{saving ? "生成中…" : "下载完整备份"}</Button><Button type="button" variant="outline" onClick={() => backupInputRef.current?.click()}><Upload />选择备份还原</Button></div>
              <input ref={backupInputRef} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => handleBackupFile(event.target.files?.[0])} />
            </section>}
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setSettingsOpen(false)}>取消</Button><Button onClick={handleSettingsSave} disabled={saving}>{saving ? "保存中…" : "应用设置"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}><AlertDialogContent className="restore-dialog"><AlertDialogHeader><AlertDialogTitle>还原全站数据</AlertDialogTitle><AlertDialogDescription>请确认备份范围并选择还原方式。</AlertDialogDescription></AlertDialogHeader>{backupPreview && <div className="restore-preview"><div className="restore-file"><FileJson /><span><strong>{backupPreview.name}</strong><small>{backupPreview.exportedAt ? new Date(backupPreview.exportedAt).toLocaleString("zh-CN") : "sma-center 完整备份"}</small></span></div><div className="restore-counts"><span><b>{backupPreview.users}</b> 位用户</span><span><b>{backupPreview.preferences}</b> 份主页设置</span><span><b>{backupPreview.resources}</b> 条导航记录</span></div><p><strong>合并还原</strong>会保留当前 SMA 凭据；<strong>覆盖还原</strong>会清除全部凭据，且备份文件不会恢复它们。</p></div>}<AlertDialogFooter><AlertDialogCancel disabled={restoring}>取消</AlertDialogCancel><Button variant="outline" disabled={restoring} onClick={() => handleRestore("merge")}>合并还原</Button><AlertDialogAction variant="destructive" disabled={restoring} onClick={() => handleRestore("replace")}>{restoring ? "还原中…" : "覆盖还原"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      </div>
    </>
  );
}
