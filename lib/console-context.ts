import { requireOwner } from "@/app/auth";
import { getPreferences, listResources } from "@/db/resources";
import { listBoards } from "@/db/dashboards";
import type { Preferences } from "@/db/resources";
import type { Board } from "@/lib/workspace-model";
export type ConsoleContext = {
  preferences: Preferences;
  boards: Board[];
  resourceCount: number;
};
export async function getConsoleContext(): Promise<ConsoleContext> {
  const owner = await requireOwner();
  const [preferences, resources] = await Promise.all([
    getPreferences(owner.userId),
    listResources(owner.userId),
  ]);
  return {
    preferences,
    boards: await listBoards(owner.userId, resources),
    resourceCount: resources.length,
  };
}
