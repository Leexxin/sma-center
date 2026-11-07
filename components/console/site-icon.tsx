"use client";
import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
const previews = new Map<string, { expires: number; result: Promise<string> }>();
function preview(url: string, iconSource?: string) {
  const key = JSON.stringify([url, iconSource]);
  const existing = previews.get(key);
  if (existing && existing.expires > Date.now()) return existing.result;
  const result = fetch("/api/site-icon", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, iconSource }),
  }).then(async (response) => response.ok ? (await response.json() as { siteIcon: string }).siteIcon : "").catch(() => "");
  if (previews.size >= 100) previews.delete(previews.keys().next().value!);
  previews.set(key, { expires: Date.now() + 600000, result });
  return result;
}
export default function SiteIcon({ icon, url, iconSource, size = 18 }: { icon?: string; url?: string; iconSource?: string; size?: number }) {
  const [failed, setFailed] = useState<string | undefined>();
  const [discovered, setDiscovered] = useState({ url: "", icon: "" });
  useEffect(() => {
    if (icon || !url) return;
    try { if (!["http:", "https:"].includes(new URL(url).protocol)) return; } catch { return; }
    let active = true;
    void preview(url, iconSource).then((value) => { if (active) setDiscovered({ url, icon: value }); });
    return () => { active = false; };
  }, [icon, url, iconSource]);
  const source = icon || (discovered.url === url ? discovered.icon : "");
  return source && failed !== source ? (
    // Embedded captured favicon; Next Image optimization provides no benefit here.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={source} alt="" width={size} height={size} className="site-favicon" onError={() => setFailed(source)} />
  ) : <Globe size={size} aria-hidden="true" />;
}
