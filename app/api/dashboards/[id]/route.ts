import { getOwner } from "@/app/auth";
import { writeBoard, removeBoard } from "@/db/dashboards";
import { parseBoardWrite } from "@/lib/workspace-model";
export const dynamic = "force-dynamic";
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const owner = await getOwner();
  if (!owner) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    const text = await request.text();
    if (text.length > 300_000)
      return Response.json({ error: "面板过大。" }, { status: 413 });
    return Response.json(
      await writeBoard(
        owner.userId,
        (await context.params).id,
        parseBoardWrite(JSON.parse(text)),
      ),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return Response.json(
      {
        error:
          code === "BOARD_CONFLICT"
            ? "面板已在其他页面更新，请重新载入后再保存。"
            : "面板配置无效。",
      },
      { status: code === "BOARD_CONFLICT" ? 409 : 400 },
    );
  }
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const owner = await getOwner();
  if (!owner) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    const { revision } = (await request.json()) as { revision: number };
    if (!Number.isSafeInteger(revision)) throw new Error();
    await removeBoard(owner.userId, (await context.params).id, revision);
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "删除失败，请刷新重试。至少保留一个面板。" },
      { status: 409 },
    );
  }
}
