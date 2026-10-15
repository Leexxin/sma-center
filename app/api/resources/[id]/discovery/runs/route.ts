import { getOwner } from "@/app/auth";
import { proxySmaDiscovery } from "@/lib/sma-discovery";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getOwner();
  if (!user) return Response.json({ error: { code: "unauthorized", message: "请先登录。" } }, { status: 401 });
  const { id } = await context.params;
  return proxySmaDiscovery(user.userId, id, "/v1/discovery/runs", "GET");
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getOwner();
  if (!user) return Response.json({ error: { code: "unauthorized", message: "请先登录。" } }, { status: 401 });
  try {
    const input = await request.json() as Record<string, unknown>;
    const detectors = Array.isArray(input.detectors) ? input.detectors.map(String).slice(0, 20) : [];
    if (detectors.some((item) => !item || item.length > 120) || Object.keys(input).some((key) => !["detectors", "report"].includes(key))) {
      return Response.json({ error: { code: "invalid_request", message: "发现任务参数无效。" } }, { status: 400 });
    }
    const { id } = await context.params;
    return proxySmaDiscovery(user.userId, id, "/v1/discovery/runs", "POST", { detectors, report: Boolean(input.report) });
  } catch {
    return Response.json({ error: { code: "invalid_request", message: "请输入有效的 JSON。" } }, { status: 400 });
  }
}
