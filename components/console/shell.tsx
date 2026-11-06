"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Activity,
  Bell,
  ChevronRight,
  Download,
  LayoutGrid,
  Layers,
  Menu,
  Moon,
  Plus,
  Settings,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import type { Preferences } from "@/db/resources";
import type { ConsoleContext } from "@/lib/console-context";
export type ConsoleView =
  | "resources"
  | "events"
  | "sources"
  | "gallery"
  | "settings";
export default function ConsoleShell({
  context,
  children,
  current = "overview",
  breadcrumb,
  activeId,
  editing = false,
  onSelectBoard,
  onNewBoard,
  onView,
  onPreferencesChange,
  toolbar,
}: {
  context: ConsoleContext;
  children: ReactNode;
  current?: string;
  breadcrumb: string;
  activeId?: string;
  editing?: boolean;
  onSelectBoard?: (id: string) => void;
  onNewBoard?: () => void;
  onView?: (view: ConsoleView) => void;
  onPreferencesChange?: (value: Preferences) => void;
  toolbar?: ReactNode;
}) {
  const [local, setLocal] = useState(context.preferences);
  const preferences = onPreferencesChange ? context.preferences : local;
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.dataset.accent = preferences.accent;
    document.documentElement.style.colorScheme = preferences.theme;
  }, [preferences.theme, preferences.accent]);
  async function toggleTheme() {
    const next: Preferences = {
      ...preferences,
      theme: preferences.theme === "light" ? "dark" : "light",
    };
    try {
      const response = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error();
      setLocal(next);
      onPreferencesChange?.(next);
    } catch {
      toast.error("主题保存失败。");
    }
  }
  const viewLink = (view: ConsoleView, label: string, icon: ReactNode) =>
    view === "resources" || view === "gallery" ? (
      <Link
        key={view}
        href={view === "resources" ? "/resources" : "/cards"}
        aria-current={
          current === (view === "resources" ? "resources" : "cards")
            ? "page"
            : undefined
        }
      >
        {icon}
        {label}
      </Link>
    ) : onView ? (
      <button key={view} onClick={() => onView(view)}>
        {icon}
        {label}
      </button>
    ) : (
      <Link key={view} href={`/?view=${view}`}>
        {icon}
        {label}
      </Link>
    );
  const boards = context.boards.map((board) =>
    onSelectBoard ? (
      <button
        key={board.id}
        aria-current={board.id === activeId ? "page" : undefined}
        disabled={editing}
        onClick={() => onSelectBoard(board.id)}
      >
        <LayoutGrid size={17} />
        <span>{board.name}</span>
      </button>
    ) : (
      <Link key={board.id} href={`/?board=${encodeURIComponent(board.id)}`}>
        <LayoutGrid size={17} />
        <span>{board.name}</span>
      </Link>
    ),
  );
  return (
    <>
      <Toaster position="top-right" />
      <div
        onClickCapture={(event) => {
          const link = (event.target as Element).closest("a");
          if (
            editing &&
            link?.getAttribute("href") &&
            !window.confirm("放弃未保存的面板布局并离开？")
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        className={`workspace ws-${preferences.theme} ws-${preferences.density} ws-accent-${preferences.accent}`}
      >
        <aside className="ws-sidebar">
          <Link className="ws-brand" href="/">
            <Image
              unoptimized
              src="/sma-icon.png"
              width={34}
              height={34}
              alt=""
            />
            <strong>SMA Center</strong>
          </Link>
          <div className="ws-navcaption">
            面板
            {onNewBoard ? (
              <button
                aria-label="新建面板"
                onClick={onNewBoard}
                disabled={editing || context.boards.length >= 12}
              >
                <Plus size={15} />
              </button>
            ) : (
              <Link aria-label="新建面板" href="/?view=new-board">
                <Plus size={15} />
              </Link>
            )}
          </div>
          <nav aria-label="面板">{boards}</nav>
          <div className="ws-navcaption">管理</div>
          <nav aria-label="管理">
            {viewLink("resources", "资源", <Layers size={17} />)}
            {viewLink("events", "事件", <Bell size={17} />)}
            {viewLink("sources", "数据连接", <Activity size={17} />)}
            {viewLink("gallery", "卡片管理", <LayoutGrid size={17} />)}
            <Link
              href="/plugins"
              aria-current={current === "plugins" ? "page" : undefined}
            >
              <Layers size={17} />
              插件
            </Link>
          </nav>
          <div className="ws-sidebar-bottom">
            <Link
              aria-current={current === "releases" ? "page" : undefined}
              href="/sma/releases"
            >
              <Download size={16} />
              版本中心
            </Link>
            <a
              aria-current={current === "security" ? "page" : undefined}
              href="/security"
            >
              <ShieldCheck size={16} />
              安全设置
            </a>
            {onView ? (
              <button onClick={() => onView("settings")}>
                <Settings size={16} />
                设置
              </button>
            ) : (
              <Link href="/?view=settings">
                <Settings size={16} />
                设置
              </Link>
            )}
          </div>
        </aside>
        <main className="ws-main">
          <div className="ws-top">
            <div className="ws-breadcrumb">
              <Link href="/">总览</Link>
              {breadcrumb !== "总览" && (
                <>
                  <ChevronRight size={13} />
                  <span>{breadcrumb}</span>
                </>
              )}
            </div>
            <div className="ws-top-actions">
              {toolbar}
              <button
                className="ws-icon-button"
                aria-label={
                  preferences.theme === "dark" ? "切换浅色" : "切换深色"
                }
                onClick={toggleTheme}
              >
                {preferences.theme === "dark" ? (
                  <Sun size={18} />
                ) : (
                  <Moon size={18} />
                )}
              </button>
              <details
                className="ws-mobile-menu"
                onClick={(event) => {
                  if ((event.target as Element).closest("a,button"))
                    event.currentTarget.open = false;
                }}
              >
                <summary aria-label="导航">
                  <Menu size={18} />
                </summary>
                <div>
                  {boards}
                  {onNewBoard ? (
                    <button onClick={onNewBoard} disabled={editing}>
                      新建面板
                    </button>
                  ) : (
                    <Link href="/?view=new-board">新建面板</Link>
                  )}
                  {viewLink("resources", "资源", <Layers size={15} />)}
                  {viewLink("events", "事件", <Bell size={15} />)}
                  {viewLink("sources", "数据连接", <Activity size={15} />)}
                  {viewLink("gallery", "卡片管理", <LayoutGrid size={15} />)}
                  <Link href="/plugins">插件</Link>
                  <Link href="/sma/releases">版本中心</Link>
                  <a href="/security">安全设置</a>
                  {viewLink("settings", "设置", <Settings size={15} />)}
                </div>
              </details>
            </div>
          </div>
          {children}
        </main>
      </div>
    </>
  );
}
