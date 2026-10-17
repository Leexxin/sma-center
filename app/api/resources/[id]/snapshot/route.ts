import { getOwner } from "@/app/auth";
import { getServerAgentConnection, SmaCredentialConfigurationError } from "@/db/agent-credentials";
import { smaMonitor, MonitorError } from "@/lib/sma-monitor";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getOwner();
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  const { id } = await context.params;
  let config;
  try {
    config = await getServerAgentConnection(user.userId, id);
  } catch (error) {
    if (error instanceof SmaCredentialConfigurationError) return Response.json({ error: error.message, code: error.code }, { status: 503 });
    throw error;
  }
  if (!config) return Response.json({ error: "服务器不存在。" }, { status: 404 });
  if (!config.agentUrl) return Response.json({ error: "尚未配置 SMA Agent 地址。", code: "not_configured" }, { status: 422 });

  try {
    const endpoint = new URL(config.agentUrl);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("unsupported URL");
  } catch {
    return Response.json({ error: "SMA Agent 地址无效。", code: "invalid_url" }, { status: 400 });
  }

  try {
    return Response.json(await smaMonitor.get(`${user.userId}:${config.agentUrl}`, config.agentUrl.replace(/\/$/, ""), config.token), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof MonitorError ? error.message : "读取 SMA 指标失败。", agentVersion: error instanceof MonitorError ? error.agentVersion : null, code: error instanceof MonitorError ? error.code : "upstream_error", retryable: !(error instanceof MonitorError && ["unauthorized", "unsupported_schema"].includes(error.code)) }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
