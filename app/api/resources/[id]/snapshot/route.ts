import { getOwner } from "@/app/auth";
import { getServerAgentConnection, SmaCredentialConfigurationError } from "@/db/agent-credentials";
import { readLimitedJson, smaHeaders } from "@/lib/sma-http";

export const dynamic = "force-dynamic";

type CpuModes = Record<string, number>;
type SmaSnapshot = {
  schemaVersion?: string;
  timestamp?: string;
  host?: { hostname?: string };
  cpu?: { logicalCount?: number; seconds?: Record<string, CpuModes> };
  memory?: Record<string, number>;
  filesystems?: Array<Record<string, string | number | boolean>>;
  disks?: Array<Record<string, string | number>>;
  load?: { load1?: number; load5?: number; load15?: number };
  uptimeSeconds?: number;
  bootTimeSeconds?: number;
  errors?: Array<{ collector?: string; code?: string; message?: string }>;
};

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

  let endpoint: URL;
  try {
    endpoint = new URL(`${config.agentUrl}/v1/snapshot`);
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error("unsupported protocol");
  } catch {
    return Response.json({ error: "SMA Agent 地址无效。", code: "invalid_url" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(endpoint, { headers: smaHeaders(config.token), cache: "no-store", redirect: "manual", signal: controller.signal });
    if (!response.ok) {
      const retryable = response.status === 503;
      return Response.json({ error: response.status === 401 ? "SMA Agent 凭据未配置或无效。" : `SMA Agent 返回 ${response.status}。`, code: response.status === 401 ? "unauthorized" : "upstream_error", retryable }, { status: 502 });
    }
    const snapshot = await readLimitedJson(response, 1_000_000) as SmaSnapshot;
    if (snapshot.schemaVersion !== "v1") return Response.json({ error: "暂不支持此 SMA schemaVersion。", code: "unsupported_schema" }, { status: 502 });

    let cpuTotalSeconds = 0;
    let cpuIdleSeconds = 0;
    for (const modes of Object.values(snapshot.cpu?.seconds ?? {})) {
      cpuIdleSeconds += Number(modes.idle ?? 0);
      cpuTotalSeconds += Object.values(modes).reduce((sum, value) => sum + Number(value || 0), 0);
    }

    return Response.json({
      schemaVersion: snapshot.schemaVersion,
      timestamp: snapshot.timestamp,
      hostname: snapshot.host?.hostname ?? "unknown",
      cpu: { logicalCount: snapshot.cpu?.logicalCount ?? 0, totalSeconds: cpuTotalSeconds, idleSeconds: cpuIdleSeconds },
      memory: snapshot.memory ?? null,
      filesystems: snapshot.filesystems ?? [],
      disks: snapshot.disks ?? [],
      load: snapshot.load ?? null,
      uptimeSeconds: snapshot.uptimeSeconds ?? null,
      bootTimeSeconds: snapshot.bootTimeSeconds ?? null,
      errors: snapshot.errors ?? [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to fetch SMA snapshot", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "无法连接 SMA Agent。", code: "network_error", retryable: true }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
