"use client";
import CollectionStatus from "@/components/console/collection-status";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Bell,
  ChevronRight,
  Database,
  GripVertical,
  LayoutGrid,
  Layers,
  Link as LinkIcon,
  MoreHorizontal,
  Plus,
  Redo2,
  Search,
  Server,
  Settings,
  StickyNote,
  Trash2,
  Undo2,
  Wrench,
  X,
  Globe,
  Pencil,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import ConsoleShell, { type ConsoleView } from "@/components/console/shell";
import {
  ResourceEditor,
  dialogTheme,
} from "@/components/console/resource-manager";
import EnhancedCard, {
  CardFields,
  CardIcon,
} from "@/components/console/card-runtime";
import {
  createCardId,
  cardIcons,
  parseCardValues,
  editableCardValues,
  type CardDefinition,
} from "@/lib/card-package";
import ConsoleSettings from "@/components/console/settings";
import ServerMetrics from "@/components/console/server-metrics";
import { toast } from "sonner";
import {
  metricLabels,
  moveWidget,
  widgetMeta,
  widgetTypes,
  type Board,
  type Widget,
  type WidgetType,
  type MetricKey,
} from "@/lib/workspace-model";
import type { Preferences, Resource } from "@/db/resources";

type Sample = {
  resourceId: string;
  timestamp: number;
  quality: "valid" | "partial" | "stale" | "error";
  payload: Partial<Record<MetricKey, number | null>> & {
    sourceTimestamp?: string;
    agentVersion?: string;
    errors?: { collector: string; code: string }[];
  };
};
type Event = {
  id: string;
  resourceId: string;
  resourceName: string;
  title: string;
  kind: string;
  startedAt: number;
  recoveredAt: number | null;
  acknowledgedAt: number | null;
  mutedUntil: number | null;
};
type Observation = {
  samples: Sample[];
  events: Event[];
  enabled: boolean;
  receivedAt: number;
};
type Point = { timestamp: number; value: number | null };
const resourceMeta = {
  tool: { name: "工具", icon: Wrench },
  site: { name: "站点", icon: Globe },
  server: { name: "服务器", icon: Server },
  database: { name: "数据库", icon: Database },
  middleware: { name: "中间件", icon: Layers },
};
const templateIcons = {
  resource: Server,
  metric: Activity,
  timeseries: Activity,
  links: LinkIcon,
  note: StickyNote,
  events: Bell,
};
const metricValue = (v: number | null | undefined) =>
  v == null ? "—" : `${v.toFixed(1)}%`;
const time = (at: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
const dateTime = (at: number) =>
  new Date(at).toLocaleString("zh-CN", { hour12: false });
async function json<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "请求失败。");
  return result;
}
function History({
  points,
  label,
  failed,
  pending,
}: {
  points: Point[];
  label: string;
  failed?: boolean;
  pending?: boolean;
}) {
  if (failed || pending)
    return (
      <div className="ws-empty-chart">
        {failed ? "历史查询失败" : "正在读取…"}
      </div>
    );
  if (!points.some((p) => p.value != null))
    return <div className="ws-empty-chart">暂无有效采样</div>;
  return (
    <div
      className="ws-chart"
      role="img"
      aria-label={`${label}历史趋势，单位百分比`}
    >
      <ResponsiveContainer width="100%" height={150}>
        <LineChart
          data={points}
          margin={{ top: 10, right: 10, left: -16, bottom: 0 }}
        >
          <CartesianGrid vertical={false} stroke="var(--ws-line)" />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={time}
            minTickGap={35}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "var(--ws-muted)" }}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 50, 100]}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "var(--ws-muted)" }}
          />
          <Tooltip
            labelFormatter={(v) => dateTime(Number(v))}
            formatter={(v) => [metricValue(Number(v)), label]}
            contentStyle={{
              background: "var(--ws-panel)",
              border: "1px solid var(--ws-line)",
              borderRadius: 10,
              color: "var(--ws-ink)",
              fontSize: 12,
            }}
          />
          <Line
            type="linear"
            dataKey="value"
            stroke="var(--ws-blue)"
            strokeWidth={2}
            dot={points.length < 3}
            isAnimationActive={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
function makeWidget(
  type: WidgetType,
  definition?: CardDefinition,
  resourceId = "",
): Widget {
  return {
    version: 1,
    id: createCardId(),
    type,
    title: "",
    size:
      definition?.size ||
      (["timeseries", "links", "events"].includes(type) ? "wide" : "medium"),
    resourceId,
    metric: "cpuPercent",
    text: "",
    threshold: 90,
    ...(definition
      ? {
          pluginId: definition.id,
          icon: definition.icon,
          values: Object.fromEntries(
            definition.fields.map((f) => [f.key, f.default]),
          ),
        }
      : {}),
  };
}
export default function Workspace({
  initialBoards,
  resources: initialResources,
  initialPreferences,
  initialView,
  initialBoard,
  initialDefinitions,
  initialAdd,
  initialResource,
}: {
  initialDefinitions: CardDefinition[];
  initialAdd?: string;
  initialResource?: string;
  initialBoards: Board[];
  resources: Resource[];
  initialPreferences: Preferences;
  initialView?: string;
  initialBoard?: string;
}) {
  const [definitions, setDefinitions] = useState(initialDefinitions);
  const initialDef = initialDefinitions.find((d) => d.id === initialAdd);
  const [resources, setResources] = useState(initialResources);
  const [settingsOpen, setSettingsOpen] = useState(initialView === "settings");
  const [resourceEditor, setResourceEditor] = useState<
    Resource | null | undefined
  >(undefined);
  const [boards, setBoards] = useState(initialBoards),
    [activeId, setActiveId] = useState(
      initialBoards.some((b) => b.id === initialBoard)
        ? initialBoard!
        : initialBoards[0].id,
    );
  const active = boards.find((b) => b.id === activeId) || boards[0];
  const [draft, setDraft] = useState<Board | null>(null),
    [past, setPast] = useState<Board[]>([]),
    [future, setFuture] = useState<Board[]>([]);
  const [preferences, setPreferences] = useState(initialPreferences),
    [hours, setHours] = useState(1),
    [observation, setObservation] = useState<Observation | null>(null),
    [offline, setOffline] = useState(false),
    [series, setSeries] = useState<
      Record<string, { points: Point[]; error?: boolean }>
    >({});
  const [gallery, setGallery] = useState(
      Boolean(initialAdd || initialResource),
    ),
    [configure, setConfigure] = useState<Widget | null>(() =>
      initialDef
        ? makeWidget("plugin", initialDef)
        : initialResource
          ? makeWidget("resource", undefined, initialResource)
          : initialAdd &&
              widgetTypes.includes(initialAdd as WidgetType) &&
              initialAdd !== "plugin"
            ? makeWidget(initialAdd as WidgetType)
            : null,
    ),
    [boardDialog, setBoardDialog] = useState(initialView === "new-board"),
    [newName, setNewName] = useState("");
  const [detail, setDetail] = useState<Resource | null>(null),
    [eventOpen, setEventOpen] = useState(initialView === "events"),
    [connections, setConnections] = useState(initialView === "sources"),
    [saving, setSaving] = useState(false),
    [query, setQuery] = useState("");
  const dragId = useRef<string | null>(null),
    [dragging, setDragging] = useState<string | null>(null),
    [dropId, setDropId] = useState<string | null>(null);
  const current = draft || active;
  const resourceMap = useMemo(
    () => new Map(resources.map((r) => [r.id, r])),
    [resources],
  );
  const samples = useMemo(
    () => new Map(observation?.samples.map((s) => [s.resourceId, s]) || []),
    [observation],
  );
  const activeEvents =
    observation?.events.filter(
      (e) =>
        !e.recoveredAt &&
        (!e.mutedUntil || e.mutedUntil < (observation?.receivedAt || 0)),
    ) || [];
  const poll = useCallback(async () => {
    try {
      setObservation(await json<Observation>("/api/observability"));
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      if (disposed) return;
      try {
        const o = await json<Observation>("/api/observability");
        if (!disposed) {
          setObservation(o);
          setOffline(false);
        }
      } catch {
        if (!disposed) setOffline(true);
      }
    };
    void load();
    const timer = window.setInterval(load, 15000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.style.colorScheme = preferences.theme;
  }, [preferences.theme]);
  const seriesKeys = [
    ...new Set([
      ...current.widgets
        .filter((w) => w.type === "timeseries")
        .map((w) => `${w.resourceId}:${w.metric}`),
      ...(detail?.kind === "server" ? [`${detail.id}:cpuPercent`] : []),
    ]),
  ]
    .sort()
    .join("|");
  useEffect(() => {
    let active = true;
    const load = async () => {
      const next: Record<string, { points: Point[]; error?: boolean }> = {};
      await Promise.all(
        seriesKeys
          .split("|")
          .filter(Boolean)
          .map(async (key) => {
            const sep = key.lastIndexOf(":"),
              resourceId = key.slice(0, sep),
              metric = key.slice(sep + 1);
            try {
              const result = await json<{ points: Point[] }>(
                `/api/observability?resourceId=${encodeURIComponent(resourceId)}&metric=${metric}&hours=${hours}`,
              );
              next[`${hours}:${key}`] = { points: result.points };
            } catch {
              next[`${hours}:${key}`] = { points: [], error: true };
            }
          }),
      );
      if (active) setSeries(next);
    };
    void load();
    const timer = window.setInterval(load, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [seriesKeys, hours]);
  useEffect(() => {
    if (!draft) return;
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [draft]);
  function change(next: Board) {
    if (!draft) return;
    setPast((p) => [...p.slice(-49), draft]);
    setFuture([]);
    setDraft(next);
  }
  function begin() {
    setDraft(structuredClone(active));
    setPast([]);
    setFuture([]);
  }
  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const saved = await json<Board>(`/api/dashboards/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      setBoards((bs) => bs.map((b) => (b.id === saved.id ? saved : b)));
      setDraft(null);
      toast.success("已保存");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function cancel() {
    if (saving) return;
    try {
      const latest = await json<Board[]>("/api/dashboards");
      setBoards(latest);
      setDraft(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function createBoard() {
    if (saving) return;
    setSaving(true);
    try {
      const created = await json<Board>("/api/dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, revision: 0, widgets: [] }),
      });
      setBoards((bs) => [...bs, created]);
      setActiveId(created.id);
      setBoardDialog(false);
      setNewName("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function deleteBoard() {
    if (!window.confirm(`删除面板“${active.name}”？资源不会被删除。`)) return;
    try {
      await json(`/api/dashboards/${active.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: active.revision }),
      });
      setBoards((bs) => bs.filter((b) => b.id !== active.id));
      setActiveId(boards.find((b) => b.id !== active.id)!.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  function openGallery() {
    setConfigure(null);
    setGallery(true);
  }
  function choose(type: WidgetType) {
    setConfigure(makeWidget(type));
  }
  async function addWidget() {
    if (!configure || saving) return;
    let configured = configure;
    try {
      if (configure.type === "plugin") {
        const definition = definitions.find((d) => d.id === configure.pluginId);
        if (!definition) throw new Error("插件不存在");
        configured = {
          ...configure,
          values: parseCardValues(definition, configure.values || {}),
        };
      }
      const base = draft || active,
        existing = base.widgets.some((w) => w.id === configured.id);
      if (base.widgets.length >= 60 && !existing)
        throw new Error("最多添加 60 张卡片。");
      const next = {
        ...base,
        widgets: existing
          ? base.widgets.map((w) => (w.id === configured.id ? configured : w))
          : [...base.widgets, configured],
      };
      if (draft) change(next);
      else {
        setSaving(true);
        const saved = await json<Board>(`/api/dashboards/${base.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        setBoards((bs) => bs.map((b) => (b.id === saved.id ? saved : b)));
        toast.success(existing ? "卡片已更新" : "卡片已添加");
      }
      setGallery(false);
      setConfigure(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function editWidget(w: Widget) {
    const definition = definitions.find((d) => d.id === w.pluginId);
    setConfigure({
      ...w,
      ...(definition
        ? { values: editableCardValues(definition, w.values) }
        : {}),
    });
    setGallery(true);
  }
  async function eventAction(id: string, action: string) {
    try {
      await json("/api/observability", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      await poll();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const status = (r: Resource) => {
    if (r.kind !== "server")
      return {
        label: "未接入状态上报",
        className: "neutral",
      };
    if (!r.agentUrl) return { label: "未配置 Agent", className: "neutral" };
    const s = samples.get(r.id);
    if (offline) return { label: "状态更新失败", className: "warning" };
    return !s
      ? { label: "等待采样", className: "neutral" }
      : s.quality === "error"
        ? { label: "采集失败", className: "warning" }
        : s.quality === "stale"
          ? { label: "数据过期", className: "warning" }
          : s.quality === "partial"
            ? { label: "部分采集异常", className: "warning" }
            : { label: "采集正常", className: "good" };
  };
  function value(r: Resource | undefined, metric: MetricKey) {
    const s = r && samples.get(r.id);
    return !s || offline || s.quality === "error" || s.quality === "stale"
      ? null
      : s.payload[metric];
  }
  function eventsList(events: Event[], compact = false) {
    return !events.length ? (
      <p className="ws-empty">{observation ? "暂无事件" : "正在读取…"}</p>
    ) : (
      <div className="ws-events">
        {events.slice(0, compact ? 3 : 100).map((e) => (
          <div className="ws-event" key={e.id}>
            <span className={`ws-dot ${e.recoveredAt ? "good" : "warning"}`} />
            <div>
              <button
                className="ws-text-link"
                onClick={() => {
                  setDetail(resourceMap.get(e.resourceId) || null);
                  setEventOpen(false);
                }}
              >
                {e.title}
              </button>
              <small>
                {e.resourceName} · {dateTime(e.startedAt)}
              </small>
              {!compact && (
                <div className="ws-event-actions">
                  <span>
                    {e.recoveredAt
                      ? `已恢复 ${time(e.recoveredAt)}`
                      : e.acknowledgedAt
                        ? "已确认"
                        : "待处理"}
                  </span>
                  {!e.acknowledgedAt && (
                    <button onClick={() => eventAction(e.id, "acknowledge")}>
                      确认
                    </button>
                  )}
                  {!e.recoveredAt && (
                    <button
                      onClick={() =>
                        eventAction(
                          e.id,
                          e.mutedUntil &&
                            e.mutedUntil > (observation?.receivedAt || 0)
                            ? "unmute"
                            : "mute",
                        )
                      }
                    >
                      {e.mutedUntil &&
                      e.mutedUntil > (observation?.receivedAt || 0)
                        ? "取消静默"
                        : "静默 1 小时"}
                    </button>
                  )}
                </div>
              )}
            </div>
            <ChevronRight size={14} />
          </div>
        ))}
      </div>
    );
  }
  function renderContent(w: Widget) {
    const r = resourceMap.get(w.resourceId);
    if (w.type === "plugin")
      return (
        <EnhancedCard
          widget={w}
          definition={definitions.find((d) => d.id === w.pluginId)}
          boardId={active.id}
          editing={!!draft}
        />
      );
    if (w.type === "note")
      return <p className="ws-note">{w.text || "未填写内容"}</p>;
    if (w.type === "events")
      return (
        <>
          {eventsList(activeEvents, true)}
          <button
            className="ws-text-link ws-bottom"
            onClick={() => setEventOpen(true)}
          >
            全部事件 <ArrowUpRight size={13} />
          </button>
        </>
      );
    if (w.type === "links") {
      const pinned = resources.filter((r) => r.pinned);
      return pinned.length ? (
        <div className="ws-links">
          {pinned.map((r) => {
            const Icon = resourceMeta[r.kind].icon;
            return (
              <a href={r.url} key={r.id} target="_blank" rel="noreferrer">
                <span>
                  <Icon size={19} />
                </span>
                {r.name}
                <ArrowUpRight size={11} />
              </a>
            );
          })}
        </div>
      ) : (
        <p className="ws-empty">在资源管理中收藏常用入口。</p>
      );
    }
    if (!r)
      return (
        <div className="ws-empty">
          资源已删除。
          <button
            className="ws-text-link"
            onClick={() => {
              if (!draft) {
                begin();
              }
            }}
          >
            编辑面板以重新绑定
          </button>
        </div>
      );
    if (w.type === "resource") {
      const state = status(r);
      const sample = samples.get(r.id);
      return (
        <>
          <CollectionStatus
            className={`ws-state ${state.className}`}
            label={state.label}
            errors={sample?.payload.errors}
          />
          {r.kind === "server" ? (
            <>
              <div className="ws-metrics">
                {(Object.keys(metricLabels) as MetricKey[]).map((key) => (
                  <div key={key}>
                    <small>{metricLabels[key]}</small>
                    <strong>{metricValue(value(r, key))}</strong>
                    <div className="ws-meter">
                      <span style={{ width: `${value(r, key) ?? 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="ws-cardfoot">
                <span>{sample?.payload.agentVersion || "版本未知"}</span>
                <span>{sample ? `采样 ${time(sample.timestamp)}` : "—"}</span>
              </div>
            </>
          ) : (
            <>
              <p className="ws-resource-description">
                {r.description || r.category}
              </p>
              <div className="ws-cardfoot">
                <span>{resourceMeta[r.kind].name}</span>
                <a href={r.url} target="_blank" rel="noreferrer">
                  打开 <ArrowUpRight size={12} />
                </a>
              </div>
            </>
          )}
        </>
      );
    }
    const v = value(r, w.metric);
    return (
      <>
        <div className="ws-value">
          {metricValue(v)}
          <span>{metricLabels[w.metric]}</span>
        </div>
        <div
          className={`ws-value-state ${v != null && v >= w.threshold ? "warning" : ""}`}
        >
          {v == null
            ? <CollectionStatus label={status(r).label} errors={samples.get(r.id)?.payload.errors} />
            : v >= w.threshold
              ? `超过 ${w.threshold}% 阈值`
              : `阈值 ${w.threshold}%`}
        </div>
        {w.type === "timeseries" && (
          <History
            points={series[`${hours}:${r.id}:${w.metric}`]?.points || []}
            failed={series[`${hours}:${r.id}:${w.metric}`]?.error}
            pending={!series[`${hours}:${r.id}:${w.metric}`]}
            label={metricLabels[w.metric]}
          />
        )}
        <div className="ws-cardfoot">
          <span>{r.name}</span>
          <span>
            {samples.has(r.id)
              ? `采样 ${time(samples.get(r.id)!.timestamp)}`
              : "等待采样"}
          </span>
        </div>
      </>
    );
  }
  const visible = current.widgets.filter(
    (w) =>
      !query ||
      `${w.title} ${resourceMap.get(w.resourceId)?.name || ""} ${widgetMeta[w.type].name} ${w.text}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  function openView(view: ConsoleView) {
    if (view === "resources") window.location.assign("/resources");
    if (view === "events") setEventOpen(true);
    if (view === "sources") setConnections(true);
    if (view === "gallery") {
      setQuery("");
      openGallery();
    }
    if (view === "settings") setSettingsOpen(true);
  }
  async function restored(
    nextResources: Resource[],
    nextPreferences: Preferences,
  ) {
    const nextBoards = await json<Board[]>("/api/dashboards");
    setDefinitions(await json<CardDefinition[]>("/api/card-definitions"));
    setResources(nextResources);
    setPreferences(nextPreferences);
    setBoards(nextBoards);
    setActiveId(nextBoards[0].id);
    setDraft(null);
  }
  return (
    <>
      <ConsoleShell
        context={{ preferences, boards, resourceCount: resources.length }}
        breadcrumb={active.name}
        activeId={active.id}
        editing={!!draft}
        onSelectBoard={(id) => setActiveId(id)}
        onNewBoard={() => {
          setNewName("");
          setBoardDialog(true);
        }}
        onView={openView}
        onPreferencesChange={setPreferences}
        toolbar={
          <label className="ws-search">
            <Search size={15} />
            <input
              aria-label="搜索卡片"
              placeholder="搜索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={!!draft}
            />
            {query && (
              <button aria-label="清空搜索" onClick={() => setQuery("")}>
                <X size={13} />
              </button>
            )}
          </label>
        }
      >
        <header className="ws-heading">
          <div>
            <h1>{active.name}</h1>
            <p>
              {resources.length} 项资源
              {observation && ` · 更新于 ${time(observation.receivedAt)}`}
            </p>
          </div>
          <div className="ws-actions">
            <button
              onClick={() => {
                setQuery("");
                begin();
              }}
              disabled={!!draft}
            >
              <Pencil size={14} />
              编辑
            </button>
            <button className="ws-primary" onClick={openGallery}>
              <Plus size={16} />
              添加卡片
            </button>
          </div>
        </header>
        {offline && (
          <div role="alert" className="ws-banner">
            指标更新失败，显示内容可能已过期。
            <button onClick={poll}>重试</button>
          </div>
        )}
        {observation && !observation.enabled && (
          <div className="ws-banner">后台采集已关闭。</div>
        )}
        <div className="ws-toolbar">
          <div className="ws-range" aria-label="时间范围">
            {[1, 6, 24, 168].map((h) => (
              <button
                key={h}
                aria-pressed={hours === h}
                onClick={() => setHours(h)}
              >
                {h === 168 ? "7 天" : `${h} 小时`}
              </button>
            ))}
          </div>
          {!draft && (
            <button
              className="ws-icon-button"
              disabled={boards.length <= 1}
              onClick={deleteBoard}
              aria-label="删除面板"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
        {draft && (
          <div className="ws-editbar">
            <input
              aria-label="面板名称"
              maxLength={40}
              value={draft.name}
              onChange={(e) => change({ ...draft, name: e.target.value })}
            />
            <button
              aria-label="撤销"
              disabled={!past.length || saving}
              onClick={() => {
                setFuture((f) => [draft, ...f]);
                setDraft(past[past.length - 1]);
                setPast((p) => p.slice(0, -1));
              }}
            >
              <Undo2 size={16} />
            </button>
            <button
              aria-label="重做"
              disabled={!future.length || saving}
              onClick={() => {
                setPast((p) => [...p, draft]);
                setDraft(future[0]);
                setFuture((f) => f.slice(1));
              }}
            >
              <Redo2 size={16} />
            </button>
            <span className="ws-spacer" />
            <button onClick={cancel} disabled={saving}>
              取消
            </button>
            <button
              className="ws-primary"
              onClick={save}
              disabled={saving || !draft.name.trim()}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        )}
        <section
          className={`ws-grid ${draft ? "ws-editing" : ""}`}
          aria-label="卡片"
        >
          {visible.map((w) => {
            const r = resourceMap.get(w.resourceId);
            const Icon =
              w.type === "resource" && r
                ? resourceMeta[r.kind].icon
                : w.type === "plugin"
                  ? LayoutGrid
                  : templateIcons[w.type];
            const index = current.widgets.findIndex((c) => c.id === w.id);
            return (
              <article
                key={w.id}
                data-widget-id={w.id}
                className={`ws-card ws-size-${w.size} ${dragging === w.id ? "ws-dragging" : ""} ${dropId === w.id ? "ws-drop" : ""}`}
                onDragOver={(e) => {
                  if (draft && dragId.current) {
                    e.preventDefault();
                    setDropId(w.id);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draft && dragId.current)
                    change({
                      ...draft,
                      widgets: moveWidget(draft.widgets, dragId.current, index),
                    });
                  dragId.current = null;
                  setDragging(null);
                  setDropId(null);
                }}
              >
                {draft && (
                  <div className="ws-card-edit">
                    <button
                      className="ws-handle"
                      draggable={!saving}
                      aria-label={`移动 ${w.title || r?.name || widgetMeta[w.type].name}`}
                      onDragStart={(e) => {
                        dragId.current = w.id;
                        e.dataTransfer.setData("text/plain", w.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(w.id);
                      }}
                      onDragEnd={() => {
                        dragId.current = null;
                        setDragging(null);
                        setDropId(null);
                      }}
                    >
                      <GripVertical size={16} />
                    </button>
                    <button
                      aria-label="前移卡片"
                      disabled={index === 0 || saving}
                      onClick={() =>
                        change({
                          ...draft,
                          widgets: moveWidget(draft.widgets, w.id, index - 1),
                        })
                      }
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      aria-label="后移卡片"
                      disabled={index === draft.widgets.length - 1 || saving}
                      onClick={() =>
                        change({
                          ...draft,
                          widgets: moveWidget(draft.widgets, w.id, index + 1),
                        })
                      }
                    >
                      <ArrowDown size={14} />
                    </button>
                    <select
                      aria-label="卡片尺寸"
                      value={w.size}
                      disabled={saving}
                      onChange={(e) =>
                        change({
                          ...draft,
                          widgets: draft.widgets.map((c) =>
                            c.id === w.id
                              ? {
                                  ...c,
                                  size: e.target.value as Widget["size"],
                                }
                              : c,
                          ),
                        })
                      }
                    >
                      <option value="small">小</option>
                      <option value="medium">中</option>
                      <option value="wide">宽</option>
                      <option value="full">整行</option>
                    </select>
                    <button
                      aria-label="配置卡片"
                      onClick={() => editWidget(w)}
                      disabled={saving}
                    >
                      <Settings size={14} />
                    </button>
                    <button
                      aria-label="移除卡片"
                      onClick={() =>
                        change({
                          ...draft,
                          widgets: draft.widgets.filter((c) => c.id !== w.id),
                        })
                      }
                      disabled={saving}
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}
                <div className="ws-cardhead">
                  <span className="ws-cardicon">
                    {w.icon || w.type === "plugin" ? (
                      <CardIcon
                        name={
                          w.icon ||
                          definitions.find((d) => d.id === w.pluginId)?.icon
                        }
                      />
                    ) : (
                      <Icon size={18} />
                    )}
                  </span>
                  <div>
                    <h2>
                      {w.title ||
                        r?.name ||
                        definitions.find((d) => d.id === w.pluginId)?.name ||
                        widgetMeta[w.type].name}
                    </h2>
                    <small>
                      {r
                        ? resourceMeta[r.kind].name
                        : w.type === "timeseries"
                          ? `${hours} 小时`
                          : widgetMeta[w.type].name}
                    </small>
                  </div>
                  {!draft && (
                    <button
                      className="ws-icon-button"
                      aria-label={`查看 ${w.title || r?.name || widgetMeta[w.type].name}`}
                      onClick={() => {
                        if (w.type === "events") setEventOpen(true);
                        else if (r) setDetail(r);
                        else {
                          editWidget(w);
                        }
                      }}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  )}
                </div>
                {renderContent(w)}
              </article>
            );
          })}
        </section>
        {!visible.length && (
          <div className="ws-board-empty">
            <LayoutGrid size={30} />
            <h2>{query ? "没有匹配的卡片" : "还没有卡片"}</h2>
            <button className="ws-primary" onClick={openGallery}>
              添加卡片
            </button>
          </div>
        )}
      </ConsoleShell>
      <Dialog
        open={gallery}
        onOpenChange={(open) => {
          setGallery(open);
          if (!open) setConfigure(null);
        }}
      >
        <DialogContent className={dialogTheme(preferences)}>
          <DialogHeader>
            <DialogTitle>
              {configure
                ? current.widgets.some((w) => w.id === configure.id)
                  ? "配置卡片"
                  : definitions.find((d) => d.id === configure.pluginId)
                      ?.name || widgetMeta[configure.type].name
                : "添加卡片"}
            </DialogTitle>
            <DialogDescription>
              {configure ? "选择内容与显示方式。" : "选择卡片类型。"}
            </DialogDescription>
          </DialogHeader>
          {!configure ? (
            <div className="ws-templates">
              {widgetTypes
                .filter((type) => type !== "plugin")
                .map((type) => {
                  const Icon = templateIcons[type];
                  return (
                    <button key={type} onClick={() => choose(type)}>
                      <Icon size={22} />
                      <strong>{widgetMeta[type].name}</strong>
                      <small>{widgetMeta[type].description}</small>
                      <Plus size={15} />
                    </button>
                  );
                })}
              {definitions.map((def) => (
                <button
                  key={def.id}
                  onClick={() => setConfigure(makeWidget("plugin", def))}
                >
                  <CardIcon name={def.icon} size={22} />
                  <strong>{def.name}</strong>
                  <small>{def.description}</small>
                  <Plus size={15} />
                </button>
              ))}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void addWidget();
              }}
              className="ws-config"
            >
              <label>
                标题
                <input
                  maxLength={80}
                  value={configure.title}
                  onChange={(e) =>
                    setConfigure({ ...configure, title: e.target.value })
                  }
                  placeholder="使用资源名称"
                />
              </label>
              {["resource", "metric", "timeseries"].includes(
                configure.type,
              ) && (
                <label>
                  资源
                  <select
                    required
                    value={configure.resourceId}
                    onChange={(e) =>
                      setConfigure({
                        ...configure,
                        resourceId: e.target.value,
                      })
                    }
                  >
                    <option value="">选择资源</option>
                    {resources
                      .filter(
                        (r) =>
                          configure.type === "resource" || r.kind === "server",
                      )
                      .map((r) => (
                        <option value={r.id} key={r.id}>
                          {r.name} · {resourceMeta[r.kind].name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {["resource", "metric", "timeseries"].includes(
                configure.type,
              ) && (
                <button type="button" onClick={() => setResourceEditor(null)}>
                  新建资源
                </button>
              )}
              {["metric", "timeseries"].includes(configure.type) && (
                <>
                  <label>
                    指标
                    <select
                      value={configure.metric}
                      onChange={(e) =>
                        setConfigure({
                          ...configure,
                          metric: e.target.value as MetricKey,
                        })
                      }
                    >
                      {(Object.keys(metricLabels) as MetricKey[]).map((k) => (
                        <option key={k} value={k}>
                          {metricLabels[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    显示阈值（%）
                    <input
                      type="number"
                      min={0}
                      max={100}
                      required
                      value={configure.threshold}
                      onChange={(e) =>
                        setConfigure({
                          ...configure,
                          threshold: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </>
              )}
              {configure.type === "note" && (
                <label>
                  内容
                  <textarea
                    rows={7}
                    maxLength={4000}
                    value={configure.text}
                    onChange={(e) =>
                      setConfigure({ ...configure, text: e.target.value })
                    }
                  />
                </label>
              )}
              <label>
                图标
                <select
                  aria-label="卡片图标"
                  value={configure.icon || ""}
                  onChange={(e) =>
                    setConfigure({
                      ...configure,
                      icon: e.target.value || undefined,
                    })
                  }
                >
                  <option value="">自动</option>
                  {cardIcons.map((icon) => (
                    <option key={icon}>{icon}</option>
                  ))}
                </select>
              </label>
              {configure.type === "plugin" &&
                definitions.find((d) => d.id === configure.pluginId) && (
                  <CardFields
                    definition={
                      definitions.find((d) => d.id === configure.pluginId)!
                    }
                    values={configure.values || {}}
                    onChange={(values) =>
                      setConfigure({ ...configure, values })
                    }
                  />
                )}
              <label>
                尺寸
                <select
                  value={configure.size}
                  onChange={(e) =>
                    setConfigure({
                      ...configure,
                      size: e.target.value as Widget["size"],
                    })
                  }
                >
                  <option value="small">小</option>
                  <option value="medium">中</option>
                  <option value="wide">宽</option>
                  <option value="full">整行</option>
                </select>
              </label>
              <div className="ws-actions">
                <button type="button" onClick={() => setConfigure(null)}>
                  返回
                </button>
                <button className="ws-primary" disabled={saving} type="submit">
                  确定
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={boardDialog} onOpenChange={setBoardDialog}>
        <DialogContent className={dialogTheme(preferences)}>
          <DialogHeader>
            <DialogTitle>新建面板</DialogTitle>
            <DialogDescription>面板名称</DialogDescription>
          </DialogHeader>
          <form
            className="ws-config"
            onSubmit={(e) => {
              e.preventDefault();
              void createBoard();
            }}
          >
            <input
              aria-label="新面板名称"
              required
              maxLength={40}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button className="ws-primary" disabled={saving || !newName.trim()}>
              创建
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={eventOpen} onOpenChange={setEventOpen}>
        <DialogContent className={dialogTheme(preferences)}>
          <DialogHeader>
            <DialogTitle>事件</DialogTitle>
            <DialogDescription>
              采集连接连续失败 3 次，或指标超过 90% 持续 5 分钟时记录事件。
            </DialogDescription>
          </DialogHeader>
          {eventsList(observation?.events || [])}
        </DialogContent>
      </Dialog>
      <Dialog open={connections} onOpenChange={setConnections}>
        <DialogContent className={dialogTheme(preferences)}>
          <DialogHeader>
            <DialogTitle>数据连接</DialogTitle>
            <DialogDescription>
              SMA 每 30 秒采集，历史保留 7 天。
            </DialogDescription>
          </DialogHeader>
          <div className="ws-connections">
            {resources
              .filter((r) => r.kind === "server")
              .map((r) => (
                <div key={r.id}>
                  <Server size={17} />
                  <div>
                    <strong>{r.name}</strong>
                    <CollectionStatus
                      label={status(r).label}
                      errors={samples.get(r.id)?.payload.errors}
                    />
                  </div>
                  <button
                    className="ws-text-link"
                    onClick={() => {
                      setConnections(false);
                      setResourceEditor(r);
                    }}
                  >
                    配置 <ArrowUpRight size={12} />
                  </button>
                </div>
              ))}
            {!resources.some((r) => r.kind === "server") && (
              <p>尚未配置服务器。</p>
            )}
            <p>
              数据库与中间件目前支持资源卡片。性能指标连接器、站点探测、日志与链路尚未接入。
            </p>
            <button
              className="ws-text-link"
              onClick={() => {
                setConnections(false);
                window.location.assign("/resources");
              }}
            >
              管理资源 <ArrowUpRight size={13} />
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className={dialogTheme(preferences)}>
          <DialogHeader>
            <DialogTitle>{detail?.name}</DialogTitle>
            <DialogDescription>
              {detail && resourceMeta[detail.kind].name}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <>
              <CollectionStatus
                className={`ws-state ${status(detail).className}`}
                label={status(detail).label}
                errors={samples.get(detail.id)?.payload.errors}
              />
              <p>{detail.description}</p>
              {detail.kind === "server" && (
                <>
                  <div className="ws-metrics">
                    {(Object.keys(metricLabels) as MetricKey[]).map((k) => (
                      <div key={k}>
                        <small>{metricLabels[k]}</small>
                        <strong>{metricValue(value(detail, k))}</strong>
                      </div>
                    ))}
                  </div>
                  <History
                    points={
                      series[`${hours}:${detail.id}:cpuPercent`]?.points || []
                    }
                    failed={series[`${hours}:${detail.id}:cpuPercent`]?.error}
                    pending={!series[`${hours}:${detail.id}:cpuPercent`]}
                    label="CPU"
                  />
                </>
              )}
              {detail.kind === "server" && detail.agentUrl && (
                <ServerMetrics resourceId={detail.id} />
              )}
              <dl className="ws-detail-list">
                <div>
                  <dt>最近采样</dt>
                  <dd>
                    {samples.has(detail.id)
                      ? dateTime(samples.get(detail.id)!.timestamp)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>分类</dt>
                  <dd>{detail.category}</dd>
                </div>
                <div>
                  <dt>备注</dt>
                  <dd>{detail.note || "—"}</dd>
                </div>
              </dl>
              <div className="ws-actions">
                <a href={detail.url} target="_blank" rel="noreferrer">
                  打开 <ArrowUpRight size={14} />
                </a>
                {detail.kind === "server" && detail.agentUrl && (
                  <a href={`/servers/${detail.id}`}>
                    服务发现 <ArrowUpRight size={14} />
                  </a>
                )}
                <button
                  className="ws-text-link"
                  onClick={() => {
                    setDetail(null);
                    setResourceEditor(detail);
                  }}
                >
                  编辑资源
                </button>
              </div>
              {eventsList(
                (observation?.events || []).filter(
                  (e) => e.resourceId === detail.id,
                ),
                true,
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <ConsoleSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        preferences={preferences}
        onPreferencesChange={setPreferences}
        onRestored={restored}
        editing={!!draft}
      />
      {resourceEditor !== undefined && (
        <ResourceEditor
          key={resourceEditor?.id || "new"}
          resource={resourceEditor}
          preferences={preferences}
          boards={boards}
          onClose={() => setResourceEditor(undefined)}
          onSaved={(r) => {
            setResources((rs) =>
              rs.some((item) => item.id === r.id)
                ? rs.map((item) => (item.id === r.id ? r : item))
                : [r, ...rs],
            );
            if (resourceEditor === null)
              setConfigure((c) =>
                c && (c.type === "resource" || r.kind === "server")
                  ? { ...c, resourceId: r.id }
                  : c,
              );
          }}
          onDeleted={(id) =>
            setResources((rs) => rs.filter((r) => r.id !== id))
          }
        />
      )}
    </>
  );
}
