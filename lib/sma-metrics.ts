// SMA schema v1. Unknown fields are deliberately not forwarded to the browser.
export type Numbers = Record<string, number>;
type Filesystem = { device: string; mountpoint: string; filesystemType: string; sizeBytes?: number; availableBytes?: number };
type Disk = { device: string; readBytes?: number; writtenBytes?: number; readsCompleted?: number; writesCompleted?: number; ioInProgress?: number };
export type Snapshot = {
  schemaVersion: "v1"; agentVersion: string | null; timestamp: string; receivedAt: string;
  hostname: string; host: { os: string; architecture: string; systemMountpoint: string; unsupportedMetrics: string[] };
  cpu: { logicalCount?: number; seconds: Record<string, Numbers> } | null;
  memory: Numbers | null; filesystems: Filesystem[];
  disks: Disk[]; load: Numbers | null;
  uptimeSeconds: number | null; bootTimeSeconds: number | null;
  errors: Array<{ collector: string; code: string }>;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.slice(0, 256) : "";
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const version = (value: unknown): string | null => typeof value === "string" && /^v?\d+\.\d+\.\d+[\w.+-]*$/.test(value) && value.length < 100 ? value : null;

export function normalizeSnapshot(input: unknown, receivedAt = new Date().toISOString()): Snapshot {
  const s = object(input), host = object(s.host);
  if (s.schemaVersion !== "v1") throw new Error("unsupported_schema");
  if (typeof s.timestamp !== "string" || !Number.isFinite(Date.parse(s.timestamp))) throw new Error("invalid_snapshot");
  const unsupported = list(host.unsupportedMetrics).filter((v): v is string => typeof v === "string");
  const errors = list(s.errors).map((v) => ({ collector: text(object(v).collector), code: text(object(v).code) }));
  function numbers(value: unknown, prefix: string, fields: string[]): Numbers {
    const source = object(value), result: Numbers = {};
    const collector = prefix === "filesystems" ? "filesystem" : prefix === "disks" ? "disk" : prefix.split(".")[0];
    if (errors.some((e) => e.collector === collector)) return result;
    for (const field of fields) {
      const n = number(source[field]);
      if (n !== null && !unsupported.some((p) => p === collector || p === prefix || p === `${prefix}.${field}` || p === `${prefix}[].${field}` || p === `${collector}.${field}`)) result[field] = n;
    }
    return result;
  }
  const cpu = object(s.cpu), seconds: Record<string, Numbers> = {};
  for (const [key, modes] of Object.entries(object(cpu.seconds))) {
    const fields = Object.keys(object(modes));
    seconds[key] = numbers(modes, "cpu.seconds", fields);
    // Do not silently drop invalid modes and calculate from a partial CPU.
    if (Object.keys(seconds[key]).length !== fields.length) seconds[key] = {};
  }
  return {
    schemaVersion: "v1", agentVersion: version(s.agentVersion), timestamp: s.timestamp, receivedAt,
    hostname: text(host.hostname) || "未知",
    host: { os: text(host.os) || "未知", architecture: text(host.architecture) || "未知", systemMountpoint: text(host.systemMountpoint) || "/", unsupportedMetrics: unsupported },
    cpu: s.cpu ? { logicalCount: number(cpu.logicalCount) ?? undefined, seconds } : null,
    memory: s.memory ? numbers(s.memory, "memory", ["totalBytes", "availableBytes", "freeBytes", "cachedBytes", "buffersBytes", "swapTotalBytes", "swapFreeBytes"]) : null,
    filesystems: list(s.filesystems).map((v) => { const f = object(v); return { ...numbers(f, "filesystems", ["sizeBytes", "availableBytes", "freeBytes", "files", "filesFree"]), device: text(f.device), mountpoint: text(f.mountpoint), filesystemType: text(f.filesystemType) }; }),
    disks: list(s.disks).map((v) => { const d = object(v); return { ...numbers(d, "disks", ["readBytes", "writtenBytes", "readsCompleted", "writesCompleted", "ioInProgress"]), device: text(d.device) }; }),
    load: s.load && host.os !== "windows" ? numbers(s.load, "load", ["load1", "load5", "load15"]) : null,
    uptimeSeconds: unsupported.includes("uptimeSeconds") ? null : number(s.uptimeSeconds), bootTimeSeconds: number(s.bootTimeSeconds),
    errors,
  };
}
export const failed = (s: Snapshot, collector: string) => s.errors.some((e) => e.collector === collector);
export function percent(total?: number, available?: number): number | null {
  return total != null && total > 0 && available != null ? Math.max(0, Math.min(100, (1 - available / total) * 100)) : null;
}
function compatible(previous: Snapshot | undefined, current: Snapshot): previous is Snapshot {
  return !!previous && current.hostname === previous.hostname && current.host.os === previous.host.os && current.host.architecture === previous.host.architecture && current.agentVersion === previous.agentVersion && current.bootTimeSeconds === previous.bootTimeSeconds && !(current.uptimeSeconds != null && previous.uptimeSeconds != null && current.uptimeSeconds < previous.uptimeSeconds) && Date.parse(current.timestamp) > Date.parse(previous.timestamp);
}
export function cpuPercent(previous: Snapshot | undefined, current: Snapshot): number | null {
  if (!compatible(previous, current) || failed(previous, "cpu") || failed(current, "cpu") || !previous.cpu || !current.cpu || previous.cpu.logicalCount !== current.cpu.logicalCount || !current.cpu.logicalCount) return null;
  const before = previous.cpu.seconds, now = current.cpu.seconds;
  if (!Object.keys(now).length || Object.keys(now).length !== Object.keys(before).length) return null;
  let total = 0, idle = 0;
  for (const [key, modes] of Object.entries(now)) {
    if (!before[key] || !("idle" in modes) || Object.keys(modes).length !== Object.keys(before[key]).length) return null;
    for (const [mode, value] of Object.entries(modes)) {
      const old = before[key][mode], delta = value - old;
      if (old == null || !Number.isFinite(delta) || delta < 0) return null;
      total += delta;
      if (mode === "idle") idle += delta;
    }
  }
  return total > 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : null;
}
export function metrics(current: Snapshot, previous?: Snapshot) {
  const root = current.filesystems.find((f) => f.mountpoint === current.host.systemMountpoint);
  const usablePrevious = compatible(previous, current) ? previous : undefined;
  return {
    cpuPercent: cpuPercent(previous, current),
    memoryPercent: failed(current, "memory") ? null : percent(current.memory?.totalBytes, current.memory?.availableBytes),
    systemDiskPercent: failed(current, "filesystem") ? null : percent(root?.sizeBytes, root?.availableBytes),
    diskRates: current.disks.map((disk) => {
      const old = usablePrevious?.disks.find((d) => d.device === disk.device);
      const seconds = usablePrevious ? (Date.parse(current.timestamp) - Date.parse(usablePrevious.timestamp)) / 1000 : 0;
      const keys = ["readBytes", "writtenBytes", "readsCompleted", "writesCompleted"] as const;
      const valid = old && seconds > 0 && !failed(current, "disk") && !failed(usablePrevious!, "disk") && keys.every((k) => disk[k] != null && old[k] != null && disk[k] >= old[k]);
      return { device: disk.device, readBytesPerS: valid ? (disk.readBytes! - old.readBytes!) / seconds : null, writeBytesPerS: valid ? (disk.writtenBytes! - old.writtenBytes!) / seconds : null, readIOPS: valid ? (disk.readsCompleted! - old.readsCompleted!) / seconds : null, writeIOPS: valid ? (disk.writesCompleted! - old.writesCompleted!) / seconds : null };
    }),
  };
}
export type LiveSnapshot = Snapshot & { metrics: ReturnType<typeof metrics> };
