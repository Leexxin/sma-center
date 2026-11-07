import { getRawDb } from "../db/index";
import { getServerAgentConnection } from "../db/agent-credentials";
import { SmaMonitor } from "./sma-monitor";
import { evaluateAlerts, type AlertState } from "./alert-rules";
import { createHash } from "node:crypto";
const monitor = new SmaMonitor();
const states = new Map<string, AlertState>();
let running = false;
export async function collectSamples() {
  if (running) return;
  running = true;
  const db = getRawDb();
  try {
    const targets = (
      await db
        .prepare(
          "SELECT id, user_id, name FROM resources WHERE kind = 'server' AND agent_url <> '' ORDER BY id LIMIT 100",
        )
        .all<{ id: string; user_id: string; name: string }>()
    ).results;
    for (const id of states.keys())
      if (!targets.some((t) => t.id === id)) states.delete(id);
    for (let offset = 0; offset < targets.length; offset += 3)
      await Promise.all(
        targets.slice(offset, offset + 3).map(async (target) => {
          let state: AlertState = states.get(target.id) || {
            failures: 0,
            high: {},
          };
          states.set(target.id, state);
          const now = Date.now();
          const event = async (
            kind: string,
            title: string,
            active: boolean,
          ) => {
            if (active)
              await db
                .prepare(
                  `INSERT OR IGNORE INTO monitor_events (id, user_id, resource_id, kind, title, started_at) VALUES (?, ?, ?, ?, ?, ?)`,
                )
                .bind(
                  crypto.randomUUID(),
                  target.user_id,
                  target.id,
                  kind,
                  title,
                  now,
                )
                .run();
            else
              await db
                .prepare(
                  "UPDATE monitor_events SET recovered_at = ? WHERE resource_id = ? AND kind = ? AND recovered_at IS NULL",
                )
                .bind(now, target.id, kind)
                .run();
          };
          try {
            const connection = await getServerAgentConnection(
              target.user_id,
              target.id,
            );
            if (!connection?.agentUrl) return;
            const source = createHash("sha256")
              .update(JSON.stringify([connection.agentUrl, connection.token]))
              .digest("hex");
            if (state.source !== source)
              state = { failures: 0, high: {}, source };
            const snapshot = await monitor.get(
              `${target.user_id}:${connection.agentUrl}`,
              connection.agentUrl.replace(/\/$/, ""),
              connection.token,
            );
            const age = Date.now() - Date.parse(snapshot.timestamp);
            if (age > 90_000 || age < -30_000) throw new Error("stale");
            const payload = {
              cpuPercent: snapshot.metrics.cpuPercent,
              memoryPercent: snapshot.metrics.memoryPercent,
              systemDiskPercent: snapshot.metrics.systemDiskPercent,
              sourceTimestamp: snapshot.timestamp,
              agentVersion: snapshot.agentVersion,
              errors: snapshot.errors,
            };
            await db
              .prepare(
                "INSERT OR REPLACE INTO monitor_samples (resource_id, user_id, timestamp, quality, payload) VALUES (?, ?, ?, ?, ?)",
              )
              .bind(
                target.id,
                target.user_id,
                now,
                snapshot.errors.length ? "partial" : "valid",
                JSON.stringify(payload),
              )
              .run();
            const evaluated = evaluateAlerts(state, payload, now);
            states.set(target.id, evaluated.state);
            for (const d of evaluated.decisions)
              await event(d.kind, d.title, d.active);
          } catch {
            const evaluated = evaluateAlerts(state, null, now);
            states.set(target.id, evaluated.state);
            await db
              .prepare(
                "INSERT OR REPLACE INTO monitor_samples (resource_id, user_id, timestamp, quality, payload) VALUES (?, ?, ?, 'error', '{}')",
              )
              .bind(target.id, target.user_id, now)
              .run();
            for (const d of evaluated.decisions)
              await event(d.kind, d.title, d.active);
          }
        }),
      );
    await db
      .prepare("DELETE FROM monitor_samples WHERE timestamp < ?")
      .bind(Date.now() - 7 * 86400_000)
      .run();
    await db
      .prepare("DELETE FROM monitor_events WHERE recovered_at < ?")
      .bind(Date.now() - 30 * 86400_000)
      .run();
  } finally {
    running = false;
  }
}
export function startSampling() {
  const global = globalThis as typeof globalThis & {
    smaSampler?: ReturnType<typeof setInterval>;
  };
  if (
    global.smaSampler ||
    process.env.NODE_ENV !== "production" ||
    process.env.SMA_CENTER_MONITOR_ENABLED === "false"
  )
    return;
  const tick = () => {
    void collectSamples().catch(() =>
      console.error("Background sampling failed"),
    );
  };
  global.smaSampler = setInterval(tick, 30_000);
  global.smaSampler.unref();
  const initial = setTimeout(tick, 5000);
  initial.unref();
}
