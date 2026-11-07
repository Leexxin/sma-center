import { MAX_ICON_BYTES, normalizeSiteIcon } from "./site-icon-data.ts";
const MAX_PAGE_BYTES = 256 * 1024;
function webUrl(value: string, base?: string) {
  const url = new URL(value, base);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 2048)
    throw new Error("INVALID_SITE_URL");
  return url.href;
}
function decode(value: string) {
  return value.replace(/&(?:amp|quot|apos|#39|#x([0-9a-f]+)|#([0-9]+));/gi, (whole, hex, decimal) => {
    if (hex || decimal) {
      const n = parseInt(hex || decimal, hex ? 16 : 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return /amp/i.test(whole) ? "&" : /quot/i.test(whole) ? '"' : "'";
  });
}
function attributes(tag: string) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
    .map((m) => [m[1].toLowerCase(), decode(m[2] ?? m[3] ?? m[4])]));
}
export function iconCandidates(html: string, pageUrl: string): string[] {
  const source = html.replace(/<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script\s*>/gi, "");
  let base = pageUrl;
  const baseTag = source.match(/<base\b[^>]*>/i);
  if (baseTag) { try { base = webUrl(attributes(baseTag[0]).href, pageUrl); } catch {} }
  const icons: string[] = [], touch: string[] = [];
  for (const tag of source.match(/<link\b[^>]*>/gi) || []) {
    const attrs = attributes(tag), rel = (attrs.rel || "").toLowerCase().split(/\s+/);
    if (!attrs.href) continue;
    try {
      const url = webUrl(attrs.href, base);
      if (rel.includes("icon")) icons.push(url);
      else if (rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed")) touch.push(url);
    } catch {}
  }
  const fallback = new URL("/favicon.ico", pageUrl).href;
  return [...new Set([...icons, ...touch])].filter((url) => url !== fallback).slice(0, 5).concat(fallback);
}
async function limitedBody(response: Response, maximum: number) {
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel(); throw new Error("ICON_TOO_LARGE");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("EMPTY_ICON");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw new Error("ICON_TOO_LARGE");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
async function request(url: string, signal: AbortSignal, fetcher: typeof fetch) {
  for (let i = 0; i < 4; i++) {
    const response = await fetcher(webUrl(url), { redirect: "manual", signal, credentials: "omit", headers: { Accept: "text/html,image/*;q=0.9" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("INVALID_REDIRECT");
      const destination = webUrl(location, url);
      const from = new URL(url), to = new URL(destination);
      const upgrade = from.protocol === "http:" && to.protocol === "https:" && from.hostname === to.hostname && !from.port && !to.port;
      if (from.origin !== to.origin && !upgrade) throw new Error("CROSS_ORIGIN_ICON_REDIRECT");
      url = destination; continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error("ICON_UNAVAILABLE"); }
    return { response, url };
  }
  throw new Error("TOO_MANY_REDIRECTS");
}
function imageType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString())) return "gif";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "webp";
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return "x-icon";
  // SVG is used only as an img data URL, never inline markup or an executable document.
  const svg = bytes.toString("utf8").trim().replace(/^<\?xml[^>]*>\s*/i, "");
  if (/^<svg[\s>]/i.test(svg) && !/<!DOCTYPE|<!ENTITY|<script|<foreignObject|\bon\w+\s*=|(?:href|src)\s*=/i.test(svg)) return "svg+xml";
  return null;
}
export async function collectSiteIcon(input: string, fetcher: typeof fetch = fetch, iconSource?: string) {
  const page = webUrl(input), signal = AbortSignal.timeout(8000);
  let candidates = iconSource ? [webUrl(iconSource)] : [new URL("/favicon.ico", page).href];
  if (!iconSource) try {
    const { response, url } = await request(page, signal, fetcher);
    candidates = iconCandidates((await limitedBody(response, MAX_PAGE_BYTES)).toString("utf8"), url);
  } catch { if (signal.aborted) return ""; }
  for (const url of candidates) {
    if (signal.aborted) break;
    try {
      const { response } = await request(url, signal, fetcher);
      const bytes = await limitedBody(response, MAX_ICON_BYTES), type = imageType(bytes);
      if (type) return normalizeSiteIcon(`data:image/${type};base64,${bytes.toString("base64")}`);
    } catch {}
  }
  return "";
}
