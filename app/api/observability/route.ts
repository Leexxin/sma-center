import { getOwner } from "@/app/auth";
import { getRawDb } from "@/db/index";
import { metricLabels } from "@/lib/workspace-model";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const owner = await getOwner();
  if (!owner) return Response.json({ error: "请先登录。" }, { status: 401 });
  const db = getRawDb();
  const url = new URL(request.url);
  const hours = Number(url.searchParams.get("hours") || 1);
  const metric = url.searchParams.get("metric") || "cpuPercent";
  const id = url.searchParams.get("resourceId");
  if (![1, 6, 24, 168].includes(hours) || !Object.hasOwn(metricLabels, metric))
    return Response.json({ error: "查询参数无效。" }, { status: 400 });
  if (id) {
    const found = await db
      .prepare("SELECT id FROM resources WHERE id = ? AND user_id = ?")
      .bind(id, owner.userId)
      .first();
    if (!found)
      return Response.json({ error: "资源不存在。" }, { status: 404 });
    // At most 360 averaged buckets. Error/null samples break the line instead of becoming zero.
    const step = Math.max(30_000, Math.ceil((hours * 3600_000) / 360));
    const rows = await db
      .prepare(
        `SELECT CAST(timestamp / ? AS INTEGER) * ? AS timestamp,
      CASE WHEN SUM(CASE WHEN quality = 'error' OR json_extract(payload, ?) IS NULL THEN 1 ELSE 0 END) > 0 THEN NULL ELSE AVG(json_extract(payload, ?)) END AS value
      FROM monitor_samples WHERE resource_id = ? AND user_id = ? AND timestamp >= ? GROUP BY CAST(timestamp / ? AS INTEGER) ORDER BY timestamp LIMIT 361`,
      )
      .bind(
        step,
        step,
        `$.${metric}`,
        `$.${metric}`,
        id,
        owner.userId,
        Date.now() - hours * 3600_000,
        step,
      )
      .all();
    return Response.json({ points: rows.results, step, metric });
  }
  const [samples, events] = await Promise.all([
    db
      .prepare(
        `SELECT s.resource_id AS resourceId, s.timestamp, s.quality, s.payload FROM resources r JOIN monitor_samples s ON s.resource_id = r.id AND s.timestamp = (SELECT MAX(timestamp) FROM monitor_samples t WHERE t.resource_id = r.id) WHERE r.user_id = ?`,
      )
      .bind(owner.userId)
      .all<{
        resourceId: string;
        timestamp: number;
        quality: string;
        payload: string;
      }>(),
    db
      .prepare(
        `SELECT e.id, e.resource_id AS resourceId, r.name AS resourceName, e.kind, e.title, e.started_at AS startedAt,
      e.recovered_at AS recoveredAt, e.acknowledged_at AS acknowledgedAt, e.muted_until AS mutedUntil FROM monitor_events e JOIN resources r ON r.id = e.resource_id WHERE e.user_id = ? ORDER BY e.started_at DESC LIMIT 100`,
      )
      .bind(owner.userId)
      .all(),
  ]);
  return Response.json(
    {
      samples: samples.results.map((s) => ({
        ...s,
        quality: Date.now() - s.timestamp > 90_000 ? "stale" : s.quality,
        payload: JSON.parse(s.payload),
      })),
      events: events.results,
      enabled:
        process.env.NODE_ENV === "production" &&
        process.env.SMA_CENTER_SELF_HOSTED === "1" &&
        process.env.SMA_CENTER_MONITOR_ENABLED !== "false",
      receivedAt: Date.now(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function PATCH(request: Request) {
  const owner = await getOwner();
  if (!owner) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    const { id, action } = (await request.json()) as {
      id: string;
      action: string;
    };
    if (
      typeof id !== "string" ||
      id.length > 160 ||
      !["acknowledge", "mute", "unmute"].includes(action)
    )
      return Response.json({ error: "操作无效。" }, { status: 400 });
    const db = getRawDb();
    const result =
      action === "acknowledge"
        ? await db
            .prepare(
              "UPDATE monitor_events SET acknowledged_at = ? WHERE id = ? AND user_id = ?",
            )
            .bind(Date.now(), id, owner.userId)
            .run()
        : await db
            .prepare(
              "UPDATE monitor_events SET muted_until = ? WHERE id = ? AND user_id = ?",
            )
            .bind(
              action === "mute" ? Date.now() + 3600_000 : null,
              id,
              owner.userId,
            )
            .run();
    return Response.json(
      { ok: Boolean(result.meta.changes) },
      { status: result.meta.changes ? 200 : 404 },
    );
  } catch {
    return Response.json({ error: "操作失败。" }, { status: 400 });
  }
}
