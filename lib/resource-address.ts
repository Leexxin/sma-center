export function isIp(value: string) {
  const parts = value.split(".");
  if (parts.length === 4 && parts.every(p => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255)) return true;
  if (!value.includes(":")) return false;
  try { return new URL(`http://[${value}]`).hostname.startsWith("["); } catch { return false; }
}
export function validResourceAddress(value: string, kind: string) {
  if (kind === "server" && isIp(value)) return true;
  if (kind === "server") {
    const match = value.startsWith("[") ? value.match(/^\[([^\]]+)\](?::(\d+))?$/) : value.match(/^([^:]+)(?::(\d+))?$/);
    if (match && isIp(match[1]) && (!match[2] || (Number(match[2]) > 0 && Number(match[2]) <= 65535))) return true;
  }
  try {
    const url = new URL(value);
    return !url.username && !url.password && ["http:","https:", ...(kind === "database" ? ["mysql:","postgresql:","redis:","elasticsearch:","tcp:"] : [])].includes(url.protocol);
  } catch { return false; }
}
export function resourceOpenUrl(resource: {kind: string; url: string}) {
  try { const url = new URL(resource.url); return ["http:","https:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch {}
  if (resource.kind === "server" && validResourceAddress(resource.url,"server"))
    return `http://${isIp(resource.url) && resource.url.includes(":") ? `[${resource.url}]` : resource.url}`;
  return undefined;
}
