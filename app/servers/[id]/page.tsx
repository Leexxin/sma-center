import { notFound } from "next/navigation";
import { requireOwner } from "@/app/auth";
import { getPreferences, getResource, recordUser } from "@/db/resources";
import DiscoveryDashboard from "./discovery-dashboard";

export const dynamic = "force-dynamic";

export default async function ServerDiscoveryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOwner();
  const { id } = await params;
  await recordUser(user);
  const [server, preferences] = await Promise.all([getResource(user.userId, id), getPreferences(user.userId)]);
  if (!server || server.kind !== "server" || !server.agentUrl) notFound();
  return <DiscoveryDashboard server={server} preferences={preferences} />;
}
