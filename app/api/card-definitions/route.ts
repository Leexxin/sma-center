import { getOwner } from "@/app/auth";
import { listCardDefinitions, saveCardDefinition } from "@/db/card-definitions";
export const dynamic = "force-dynamic";
export async function GET() {
  const owner = await getOwner();
  if (!owner) return Response.json({ error: "请先登录。" }, { status: 401 });
  return Response.json(await listCardDefinitions(owner.userId));
}
export async function POST(request: Request) {
  const owner = await getOwner();
  if (!owner) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    const text = await request.text();
    if (text.length > 64000)
      return Response.json(
        { error: "插件包不能超过 64 KB。" },
        { status: 413 },
      );
    const input = JSON.parse(text) as { manifest: unknown; revision: number };
    return Response.json(
      await saveCardDefinition(owner.userId, input.manifest, input.revision),
    );
  } catch (e) {
    const message = (e as Error).message;
    return Response.json(
      {
        error:
          message === "CARD_CONFLICT"
            ? "卡片配置已更新或超过数量限制，请刷新后重试。"
            : message,
      },
      { status: message === "CARD_CONFLICT" ? 409 : 400 },
    );
  }
}
