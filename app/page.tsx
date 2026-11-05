import Workspace from "./workspace";
import { requireOwner } from "./auth";
import { getPreferences, listResources, recordUser } from "@/db/resources";
import { listBoards } from "@/db/dashboards";

export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; board?: string }>;
}) {
  const navigation = await searchParams;
  const user = await requireOwner();
  await recordUser(user);
  const [resources, preferences] = await Promise.all([
    listResources(user.userId),
    getPreferences(user.userId),
  ]);
  const boards = await listBoards(user.userId, resources);
  return (
    <Workspace
      initialBoards={boards}
      initialView={navigation.view}
      initialBoard={navigation.board}
      resources={resources}
      initialPreferences={preferences}
    />
  );
}
