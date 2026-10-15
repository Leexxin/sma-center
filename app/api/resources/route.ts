import { getOwner } from "@/app/auth";
import { createResource, listResources } from "@/db/resources";
import { parseResourceInput } from "@/lib/resource-input";
import { SmaCredentialConfigurationError } from "@/db/agent-credentials";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getOwner();
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    return Response.json(await listResources(user.userId));
  } catch (error) {
    console.error("Failed to load resources", error);
    return Response.json({ error: "暂时无法读取数据，请稍后重试。" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await getOwner();
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    const input = parseResourceInput(await request.json());
    return Response.json(await createResource(user.userId, input.resource, input.credential), { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (error instanceof SmaCredentialConfigurationError) return Response.json({ error: error.message, code: error.code }, { status: 503 });
    if (["INVALID_INPUT", "INVALID_URL", "INVALID_AGENT_URL", "INVALID_CREDENTIAL"].includes(code)) {
      const message = code === "INVALID_URL" ? "请输入完整有效的网址。" : code === "INVALID_AGENT_URL" ? "请输入有效的 SMA Agent 地址。" : code === "INVALID_CREDENTIAL" ? "SMA 凭据参数无效。" : "请填写名称和网址。";
      return Response.json({ error: message }, { status: 400 });
    }
    console.error("Failed to create resource", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "保存失败，请稍后重试。" }, { status: 503 });
  }
}
