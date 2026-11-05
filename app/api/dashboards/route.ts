import { getOwner } from "@/app/auth";
import { listBoards, writeBoard } from "@/db/dashboards";
import { listResources } from "@/db/resources";
import { parseBoardWrite } from "@/lib/workspace-model";
export const dynamic = "force-dynamic";
export async function GET() {
  const owner = await getOwner();
  if (!owner) return Response.json({ error: "请先登录。" }, { status: 401 });
  return Response.json(
    await listBoards(owner.userId, await listResources(owner.userId)),
  );
}
export async function POST(request: Request) {
  const owner = await getOwner();
  if (!owner) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    if (Number(request.headers.get("content-length")) > 300_000)
      return Response.json({ error: "面板过大。" }, { status: 413 });
    const text = await request.text();
    if (text.length > 300_000)
      return Response.json({ error: "面板过大。" }, { status: 413 });
    return Response.json(
      await writeBoard(owner.userId, null, parseBoardWrite(JSON.parse(text))),
      { status: 201 },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return Response.json(
      {
        error:
          code === "BOARD_LIMIT" ? "最多创建 12 个面板。" : "面板配置无效。",
      },
      { status: 400 },
    );
  }
}
