import { redirect } from "next/navigation";
import { listCardDefinitions } from "@/db/card-definitions";
import Workspace from "./workspace";
import { requireOwner } from "./auth";
import { getPreferences, listResources, recordUser } from "@/db/resources";
import { listBoards } from "@/db/dashboards";

export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    board?: string;
    add?: string;
    resource?: string;
  }>;
}) {
  const navigation = await searchParams;
  if (navigation.view === "events") redirect("/events");
  if (navigation.view === "resources") redirect("/resources");
  if (navigation.view === "gallery") redirect("/cards");
  const user = await requireOwner();
  await recordUser(user);
  const [resources, preferences] = await Promise.all([
    listResources(user.userId),
    getPreferences(user.userId),
  ]);
  const boards = await listBoards(user.userId, resources);
  return (
    <Workspace
      key={`${navigation.view || "overview"}:${navigation.board || ""}:${navigation.add || ""}:${navigation.resource || ""}`}
      initialDefinitions={await listCardDefinitions(user.userId)}
      initialAdd={navigation.add}
      initialResource={navigation.resource}
      initialBoards={boards}
      initialView={navigation.view}
      initialBoard={navigation.board}
      resources={resources}
      initialPreferences={preferences}
    />
  );
}
