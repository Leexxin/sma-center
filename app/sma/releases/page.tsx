import { getConsoleContext } from "@/lib/console-context";
import ReleaseCenter from "./release-center";
import "./releases.css";

export const dynamic = "force-dynamic";
export default async function ReleasesPage() {
  return <ReleaseCenter context={await getConsoleContext()} />;
}
