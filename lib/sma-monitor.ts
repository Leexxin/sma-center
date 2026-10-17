import { createHash } from "node:crypto";
import { readLimitedJson, smaHeaders } from "./sma-http.ts";
import { normalizeSnapshot, metrics, version, type LiveSnapshot } from "./sma-metrics.ts";

export class MonitorError extends Error {
  code: string;
  agentVersion: string | null = null;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
type Entry = { source: string; at: number; value?: LiveSnapshot; pending?: Promise<LiveSnapshot>; error?: MonitorError };
// Bounded, process-local sampling cache. No tokens or unbounded history are stored.
export class SmaMonitor {
  private entries = new Map<string, Entry>();
  private request: typeof fetch;
  private now: () => number;
  constructor(request: typeof fetch = fetch, now = Date.now) { this.request = request; this.now = now; }
  private async publicVersion(agentUrl: string): Promise<string | null> {
    try {
      const result = await this.request(`${agentUrl}/version`, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(3000) });
      return result.ok ? version((await readLimitedJson(result, 16_384) as { version?: unknown } | null)?.version) : null;
    } catch { return null; }
  }
  async get(id: string, agentUrl: string, token: string | null): Promise<LiveSnapshot> {
    const source = createHash("sha256").update(JSON.stringify([agentUrl, token])).digest("hex");
    const time = this.now();
    let entry = this.entries.get(id);
    if (entry?.source === source) {
      if (entry.pending) return entry.pending;
      if (time - entry.at < 30_000) { if (entry.error) throw entry.error; if (entry.value) return entry.value; }
    }
    const previous = entry?.source === source && time - entry.at < 90_000 ? entry.value : undefined;
    entry = { source, at: time };
    this.entries.delete(id);
    if (this.entries.size >= 500) {
      const oldest = [...this.entries].find(([, e]) => !e.pending)?.[0];
      if (!oldest) throw new MonitorError("busy", "采集繁忙，请稍后重试。");
      this.entries.delete(oldest);
    }
    this.entries.set(id, entry);
    const target = entry;
    target.pending = (async () => {
      try {
        const response = await this.request(`${agentUrl}/v1/snapshot`, { headers: smaHeaders(token), cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new MonitorError(response.status === 401 ? "unauthorized" : "upstream_error", response.status === 401 ? "SMA Token 无效，请核对凭据。" : response.status === 404 ? "SMA 接口不存在，请检查 Agent 地址。" : `SMA Agent 返回 ${response.status}。`);
        const snapshot = normalizeSnapshot(await readLimitedJson(response, 1_000_000), new Date(this.now()).toISOString());
        if (!snapshot.agentVersion) {
          // Public version endpoint: never send the agent token here.
          snapshot.agentVersion = await this.publicVersion(agentUrl);
        }
        const value = { ...snapshot, metrics: metrics(snapshot, previous) };
        target.value = value;
        return value;
      } catch (error) {
        target.value = undefined; // Disconnect/invalid response resets all rate baselines.
        target.error = error instanceof MonitorError ? error : new MonitorError(error instanceof Error && error.message === "unsupported_schema" ? "unsupported_schema" : "invalid_or_unreachable", "SMA 无法连接或快照格式无效。");
        target.error.agentVersion = await this.publicVersion(agentUrl);
        throw target.error;
      } finally { target.pending = undefined; }
    })();
    return target.pending;
  }
}
export const smaMonitor = new SmaMonitor();
