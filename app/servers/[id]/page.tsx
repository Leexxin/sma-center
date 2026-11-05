import { notFound } from "next/navigation";
import { requireOwner } from "@/app/auth";
import { getResource, recordUser } from "@/db/resources";
import { getConsoleContext } from "@/lib/console-context";
import DiscoveryDashboard from "./discovery-dashboard";

export const dynamic = "force-dynamic";

export default async function ServerDiscoveryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireOwner();
  const { id } = await params;
  await recordUser(user);
  const [server, context] = await Promise.all([
    getResource(user.userId, id),
    getConsoleContext(),
  ]);
  if (!server || server.kind !== "server" || !server.agentUrl) notFound();
  return <DiscoveryDashboard server={server} context={context} />;
}
