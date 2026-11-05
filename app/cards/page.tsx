import { getConsoleContext } from "@/lib/console-context";
import { requireOwner } from "@/app/auth";
import { listCardDefinitions } from "@/db/card-definitions";
import CardManager from "@/components/console/card-manager";
export const dynamic = "force-dynamic";
export default async function Cards() {
  const owner = await requireOwner();
  return (
    <CardManager
      context={await getConsoleContext()}
      initialDefinitions={await listCardDefinitions(owner.userId)}
    />
  );
}
