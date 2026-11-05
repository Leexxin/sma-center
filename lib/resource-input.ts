import type { CredentialWrite, ResourceKind, ResourceStatus, ResourceWrite } from "@/db/resources";

export type ParsedResourceInput = { resource: ResourceWrite; credential: CredentialWrite };

export function parseResourceInput(value: unknown): ParsedResourceInput {
  const body = value as Record<string, unknown>;
  const kind = String(body?.kind ?? "tool") as ResourceKind;
  const status = String(body?.status ?? "unknown") as ResourceStatus;
  const name = String(body?.name ?? "").trim();
  const url = String(body?.url ?? "").trim();
  if (!name || !url || !["tool", "site", "server", "database", "middleware"].includes(kind) || !["online", "warning", "offline", "unknown"].includes(status)) {
    throw new Error("INVALID_INPUT");
  }
  try {
    new URL(url);
  } catch {
    throw new Error("INVALID_URL");
  }
  const agentUrl = String(body.agentUrl ?? "").trim().replace(/\/$/, "").slice(0, 240);
  if (agentUrl) {
    try {
      if (!["http:", "https:"].includes(new URL(agentUrl).protocol)) throw new Error();
    } catch {
      throw new Error("INVALID_AGENT_URL");
    }
  }
  const agentToken = typeof body.agentToken === "string" ? body.agentToken.trim() : "";
  const clearAgentToken = body.clearAgentToken === true;
  if (agentToken.length > 4096 || /[\r\n]/.test(agentToken) || (agentToken && clearAgentToken)) throw new Error("INVALID_CREDENTIAL");
  if (kind !== "server" && (agentToken || clearAgentToken)) throw new Error("INVALID_CREDENTIAL");

  return { resource: {
    name: name.slice(0, 80),
    url,
    kind,
    status,
    description: String(body.description ?? "").trim().slice(0, 180),
    category: String(body.category ?? "其他").trim().slice(0, 40) || "其他",
    note: String(body.note ?? "").trim().slice(0, 240),
    pinned: Boolean(body.pinned),
    cpuUsage: Math.min(100, Math.max(0, Number(body.cpuUsage) || 0)),
    temperature: Math.min(150, Math.max(0, Number(body.temperature) || 0)),
    memoryUsage: Math.min(100, Math.max(0, Number(body.memoryUsage) || 0)),
    diskUsage: Math.min(100, Math.max(0, Number(body.diskUsage) || 0)),
    agentUrl,
  }, credential: { token: agentToken || undefined, clear: clearAgentToken } };
}
