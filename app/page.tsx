import Workspace from "./workspace";
import { requireOwner } from "./auth";
import { getPreferences, listResources, recordUser } from "@/db/resources";
import { listBoards } from "@/db/dashboards";
import "./workspace.css";
export const dynamic = "force-dynamic";
export default async function Home() {
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
      resources={resources}
      initialPreferences={preferences}
    />
  );
}
