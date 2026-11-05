export function reportedStatus(
  resource: { kind: string; agentUrl?: string },
  sample?: { quality: string; timestamp: number },
  now = Date.now(),
) {
  if (resource.kind !== "server" || !resource.agentUrl)
    return { label: "未接入状态上报", tone: "muted" };
  if (!sample) return { label: "等待首次上报", tone: "muted" };
  if (now - sample.timestamp > 90000 || sample.quality === "stale")
    return { label: "上报已过期", tone: "warning" };
  if (sample.quality === "error")
    return { label: "上报连接失败", tone: "warning" };
  if (sample.quality === "partial")
    return { label: "部分采集异常", tone: "warning" };
  return { label: "上报正常", tone: "good" };
}
