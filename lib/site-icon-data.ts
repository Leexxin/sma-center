// Only embedded images are persisted; no arbitrary remote/script URLs in icon fields.
export const MAX_ICON_BYTES = 64 * 1024;
export function normalizeSiteIcon(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.length > Math.ceil(MAX_ICON_BYTES / 3) * 4 + 80 ||
    !/^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
    throw new Error("INVALID_SITE_ICON");
  const encoded = value.slice(value.indexOf(",") + 1);
  const bytes = encoded.length / 4 * 3 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (encoded.length % 4 !== 0 || bytes > MAX_ICON_BYTES) throw new Error("INVALID_SITE_ICON");
  return value;
}
