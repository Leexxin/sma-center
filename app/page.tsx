import Dashboard from "./dashboard";
import { requireOwner } from "./auth";
import { getPreferences, listResources, recordUser } from "@/db/resources";
import { isBackupAdmin } from "@/lib/backup-admin";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireOwner();
  await recordUser(user);
  const [resources, preferences] = await Promise.all([
    listResources(user.userId),
    getPreferences(user.userId),
  ]);
  return <Dashboard initialResources={resources} initialPreferences={preferences} user={{ displayName: user.displayName, email: user.email }} canManageBackups={isBackupAdmin(user.email)} />;
}
