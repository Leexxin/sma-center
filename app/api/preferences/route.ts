import { getOwner } from "@/app/auth";
import { savePreferences, type Accent, type Density, type ResourceKind, type Theme } from "@/db/resources";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const user = await getOwner();
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const accent = String(body.accent ?? "cyan") as Accent;
    const density = String(body.density ?? "comfortable") as Density;
    const theme = String(body.theme ?? "dark") as Theme;
    const sidebarCollapsed = Boolean(body.sidebarCollapsed);
    const navOrder = Array.isArray(body.navOrder) ? body.navOrder.map(String) as ResourceKind[] : [];
    const pageName = String(body.pageName ?? "").trim().slice(0, 32);
    const greeting = String(body.greeting ?? "").trim().slice(0, 80);
    const validNavOrder = navOrder.length === 3 && ["tool", "site", "server"].every((kind) => navOrder.includes(kind as ResourceKind));
    if (!pageName || !greeting || !["cyan", "violet", "orange"].includes(accent) || !["comfortable", "compact"].includes(density) || !["dark", "light"].includes(theme) || !validNavOrder) {
      return Response.json({ error: "请检查主页设置。" }, { status: 400 });
    }
    return Response.json(await savePreferences(user.userId, { pageName, greeting, accent, density, theme, sidebarCollapsed, navOrder }));
  } catch (error) {
    console.error("Failed to save preferences", error);
    return Response.json({ error: "设置保存失败，请稍后重试。" }, { status: 503 });
  }
}
