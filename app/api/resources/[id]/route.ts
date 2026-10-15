import { getOwner } from "@/app/auth";
import { deleteResource, updateResource } from "@/db/resources";
import { parseResourceInput } from "@/lib/resource-input";
import { SmaCredentialConfigurationError } from "@/db/agent-credentials";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getOwner();
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    const { id } = await context.params;
    const input = parseResourceInput(await request.json());
    const resource = await updateResource(user.userId, id, input.resource, input.credential);
    if (!resource) return Response.json({ error: "记录不存在。" }, { status: 404 });
    return Response.json(resource);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (error instanceof SmaCredentialConfigurationError) return Response.json({ error: error.message, code: error.code }, { status: 503 });
    if (["INVALID_INPUT", "INVALID_URL", "INVALID_AGENT_URL", "INVALID_CREDENTIAL"].includes(code)) return Response.json({ error: "请检查名称、网址和 SMA 凭据配置。" }, { status: 400 });
    console.error("Failed to update resource", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "更新失败，请稍后重试。" }, { status: 503 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getOwner();
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    const { id } = await context.params;
    if (!(await deleteResource(user.userId, id))) return Response.json({ error: "记录不存在。" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete resource", error);
    return Response.json({ error: "删除失败，请稍后重试。" }, { status: 503 });
  }
}
