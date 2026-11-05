import { cardIcons, type CardIconName } from "./card-package.ts";
export const widgetTypes = [
  "resource",
  "metric",
  "timeseries",
  "links",
  "note",
  "events",
  "plugin",
] as const;
export type WidgetType = (typeof widgetTypes)[number];
export const metricLabels = {
  cpuPercent: "CPU",
  memoryPercent: "内存",
  systemDiskPercent: "系统盘",
} as const;
export type MetricKey = keyof typeof metricLabels;
export type Widget = {
  version: 1;
  id: string;
  type: WidgetType;
  title: string;
  size: "small" | "medium" | "wide" | "full";
  resourceId: string;
  metric: MetricKey;
  text: string;
  threshold: number;
  icon?: string;
  pluginId?: string;
  values?: Record<string, string | number | boolean>;
};
export type Board = {
  id: string;
  name: string;
  revision: number;
  widgets: Widget[];
  createdAt: number;
  updatedAt: number;
};
export const widgetMeta: Record<
  WidgetType,
  { name: string; description: string }
> = {
  plugin: { name: "增强卡片", description: "插件与自定义卡片" },
  resource: { name: "资源", description: "服务器、站点、数据库或中间件" },
  metric: { name: "指标", description: "单个数值与阈值" },
  timeseries: { name: "趋势", description: "CPU、内存或系统盘历史" },
  links: { name: "收藏", description: "已收藏的工具与站点" },
  note: { name: "文本", description: "备忘、值班信息与操作说明" },
  events: { name: "事件", description: "采集异常与指标告警" },
};
const identifier = (s: unknown): s is string =>
  typeof s === "string" && /^[a-zA-Z0-9:_-]{1,160}$/.test(s);
export function parseWidgets(value: unknown): Widget[] {
  if (!Array.isArray(value) || value.length > 60)
    throw new Error("INVALID_WIDGETS");
  const ids = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("INVALID_WIDGETS");
    const w = raw as Record<string, unknown>;
    if (
      (w.version !== undefined && w.version !== 1) ||
      !identifier(w.id) ||
      ids.has(w.id) ||
      !widgetTypes.includes(w.type as WidgetType) ||
      !["small", "medium", "wide", "full"].includes(String(w.size)) ||
      typeof w.title !== "string" ||
      w.title.length > 80 ||
      typeof w.text !== "string" ||
      w.text.length > 4000 ||
      typeof w.resourceId !== "string" ||
      (w.resourceId && !identifier(w.resourceId)) ||
      !Object.hasOwn(metricLabels, String(w.metric)) ||
      typeof w.threshold !== "number" ||
      !Number.isFinite(w.threshold) ||
      w.threshold < 0 ||
      w.threshold > 100
    )
      throw new Error("INVALID_WIDGETS");
    if (
      ["resource", "metric", "timeseries"].includes(String(w.type)) &&
      !w.resourceId
    )
      throw new Error("RESOURCE_REQUIRED");
    if (
      w.icon !== undefined &&
      (typeof w.icon !== "string" ||
        !cardIcons.includes(w.icon as CardIconName))
    )
      throw new Error("INVALID_WIDGETS");
    if (
      w.type === "plugin" &&
      (typeof w.pluginId !== "string" ||
        !/^[a-z][a-z0-9.-]{2,79}$/.test(w.pluginId))
    )
      throw new Error("INVALID_WIDGETS");
    if (
      w.values !== undefined &&
      (!w.values ||
        typeof w.values !== "object" ||
        Array.isArray(w.values) ||
        Object.keys(w.values).length > 20 ||
        Object.entries(w.values).some(
          ([k, v]) =>
            !/^[a-z][a-z0-9_]{0,39}$/.test(k) ||
            ["constructor", "prototype"].includes(k) ||
            !["string", "number", "boolean"].includes(typeof v) ||
            (typeof v === "string" && v.length > 4000) ||
            (typeof v === "number" && !Number.isFinite(v)),
        ))
    )
      throw new Error("INVALID_WIDGETS");
    ids.add(w.id);
    return {
      version: 1,
      id: w.id,
      type: w.type as WidgetType,
      title: w.title.trim(),
      size: w.size as Widget["size"],
      resourceId: w.resourceId,
      metric: w.metric as MetricKey,
      text: w.text,
      threshold: w.threshold,
      ...(w.icon !== undefined ? { icon: w.icon as string } : {}),
      ...(w.type === "plugin"
        ? {
            pluginId: w.pluginId as string,
            values: (w.values || {}) as Record<
              string,
              string | number | boolean
            >,
          }
        : {}),
    };
  });
}
export function parseBoardWrite(value: unknown) {
  const input = value as Record<string, unknown>;
  if (
    !input ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 40 ||
    !Number.isSafeInteger(input.revision) ||
    Number(input.revision) < 0
  )
    throw new Error("INVALID_BOARD");
  return {
    name: input.name.trim(),
    revision: Number(input.revision),
    widgets: parseWidgets(input.widgets),
  };
}
export function moveWidget(
  items: Widget[],
  id: string,
  target: number,
): Widget[] {
  const index = items.findIndex((w) => w.id === id);
  if (index < 0 || target < 0 || target >= items.length || target === index)
    return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}
export function starterWidgets(
  resources: Array<{ id: string; kind: string }>,
): Widget[] {
  const base = {
    version: 1 as const,
    title: "",
    size: "medium" as const,
    resourceId: "",
    metric: "cpuPercent" as const,
    text: "",
    threshold: 90,
  };
  return [
    {
      ...base,
      id: crypto.randomUUID(),
      type: "events" as const,
      size: "wide" as const,
    },
    ...resources.slice(0, 8).map((r) => ({
      ...base,
      id: crypto.randomUUID(),
      type: "resource" as const,
      resourceId: r.id,
    })),
    {
      ...base,
      id: crypto.randomUUID(),
      type: "links" as const,
      size: "wide" as const,
    },
  ];
}
