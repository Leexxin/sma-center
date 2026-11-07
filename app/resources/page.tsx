import { requireOwner } from "@/app/auth";
import { getConsoleContext } from "@/lib/console-context";
import { listResources } from "@/db/resources";
import ResourcesPage from "@/components/console/resources-page";
export const dynamic = "force-dynamic";
export default async function Resources({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const navigation = await searchParams;
  const owner = await requireOwner();
  return (
    <ResourcesPage
      key={navigation.kind || "all"}
      initialKind={navigation.kind === "application" ? "application" : "all"}
      context={await getConsoleContext()}
      initialResources={await listResources(owner.userId)}
    />
  );
}
