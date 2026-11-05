import Link from "next/link";
import ConsoleShell from "@/components/console/shell";
import { getConsoleContext } from "@/lib/console-context";
export default async function NotFound() {
  return (
    <ConsoleShell context={await getConsoleContext()} breadcrumb="页面未找到">
      <header className="ui-page-heading">
        <h1>页面未找到</h1>
      </header>
      <section className="ui-panel">
        <p className="ui-lead">页面或资源不存在。</p>
        <Link href="/">返回总览</Link>
      </section>
    </ConsoleShell>
  );
}
