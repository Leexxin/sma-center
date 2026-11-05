import { requireOwner } from "@/app/auth";
import { getConsoleContext } from "@/lib/console-context";
import { listResources } from "@/db/resources";
import ResourcesPage from "@/components/console/resources-page";
export const dynamic = "force-dynamic";
export default async function Resources() {
  const owner = await requireOwner();
  return (
    <ResourcesPage
      context={await getConsoleContext()}
      initialResources={await listResources(owner.userId)}
    />
  );
}
