import { getOwner } from "@/app/auth";
import { deleteCardDefinition } from "@/db/card-definitions";
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const owner = await getOwner();
  if (!owner) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    await deleteCardDefinition(
      owner.userId,
      (await params).id,
      ((await request.json()) as { revision: number }).revision,
    );
    return new Response(null, { status: 204 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }
}
