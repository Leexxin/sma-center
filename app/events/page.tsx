import { getConsoleContext } from "@/lib/console-context";
import EventsPage from "@/components/console/events-page";
export const dynamic="force-dynamic";
export default async function Events(){return <EventsPage context={await getConsoleContext()}/>;}
