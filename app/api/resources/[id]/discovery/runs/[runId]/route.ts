import { getOwner } from "@/app/auth";
import { proxySmaDiscovery } from "@/lib/sma-discovery";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string; runId: string }> }) {
  const user = await getOwner();
  if (!user) return Response.json({ error: { code: "unauthorized", message: "请先登录。" } }, { status: 401 });
  const { id, runId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(runId)) return Response.json({ error: { code: "invalid_request", message: "任务 ID 无效。" } }, { status: 400 });
  return proxySmaDiscovery(user.userId, id, `/v1/discovery/runs/${encodeURIComponent(runId)}`, "GET");
}
