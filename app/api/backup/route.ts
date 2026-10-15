import { getOwner } from "@/app/auth";
import { createFullBackup, parseBackup, restoreFullBackup } from "@/db/backups";
import { getPreferences, listResources, recordUser } from "@/db/resources";
import { isBackupAdmin } from "@/lib/backup-admin";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await getOwner();
  if (!user) return { response: Response.json({ error: "请先登录。" }, { status: 401 }) };
  if (!isBackupAdmin(user.email)) return { response: Response.json({ error: "你没有管理备份的权限。" }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  try {
    await recordUser(auth.user);
    const backup = await createFullBackup();
    const date = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(backup, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="sma-center-backup-${date}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Failed to create backup", error);
    return Response.json({ error: "备份生成失败，请稍后重试。" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 5_000_000) return Response.json({ error: "备份文件不能超过 5 MB。" }, { status: 413 });
  try {
    const body = await request.json() as { backup?: unknown; mode?: unknown };
    const mode = body.mode === "replace" ? "replace" : "merge";
    const backup = parseBackup(body.backup);
    const summary = await restoreFullBackup(backup, mode);
    await recordUser(auth.user);
    const [resources, preferences] = await Promise.all([listResources(auth.user.userId), getPreferences(auth.user.userId)]);
    return Response.json({ summary, resources, preferences });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "INVALID_BACKUP" || code === "BACKUP_TOO_LARGE") {
      return Response.json({ error: code === "BACKUP_TOO_LARGE" ? "备份内容超过允许数量。" : "这不是有效的 sma-center 备份文件。" }, { status: 400 });
    }
    console.error("Failed to restore backup", error);
    return Response.json({ error: "还原失败，现有数据未完整更新。请重试或使用另一份备份。" }, { status: 503 });
  }
}
