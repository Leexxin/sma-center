import { env } from "cloudflare:workers";

export function isBackupAdmin(email: string) {
  const configured = String(env.SMA_CENTER_ADMIN_EMAILS ?? env.ATLAS_ADMIN_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length) return configured.includes(email.toLowerCase());

  // The portable local Sites runtime uses this synthetic account.
  return email.toLowerCase().endsWith("@sites.test");
}
