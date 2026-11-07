import { getOwner } from "@/app/auth";
import { collectSiteIcon } from "@/lib/site-icon";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!(await getOwner())) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    const body = await request.json() as { url?: unknown; iconSource?: unknown } | null;
    const siteIcon = await collectSiteIcon(typeof body?.url === "string" ? body.url : "", fetch, typeof body?.iconSource === "string" ? body.iconSource : undefined);
    return Response.json({ siteIcon }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "请输入有效的 HTTP 或 HTTPS 站点地址。" }, { status: 400 });
  }
}
