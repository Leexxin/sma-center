"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ConsoleShell from "./shell";
import {
  ResourceEditor,
  resourceKinds,
  consoleRequest,
} from "./resource-manager";
import type { ConsoleContext } from "@/lib/console-context";
import type { Resource } from "@/db/resources";
import { reportedStatus } from "@/lib/resource-status";
export default function ResourcesPage({
  context,
  initialResources,
}: {
  context: ConsoleContext;
  initialResources: Resource[];
}) {
  const [resources, setResources] = useState(initialResources),
    [kind, setKind] = useState("all"),
    [category, setCategory] = useState("all"),
    [query, setQuery] = useState(""),
    [editor, setEditor] = useState<Resource | null | undefined>(undefined),
    [samples, setSamples] = useState<
      { resourceId: string; quality: string; timestamp: number }[]
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () =>
      consoleRequest<{ samples: typeof samples }>("/api/observability")
        .then((r) => {
          if (active) {
            setSamples(r.samples);
            setError("");
          }
        })
        .catch(() => {
          if (active) setError("状态上报暂时无法读取。");
        });
    void load();
    const t = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);
  const inKind = useMemo(
    () => resources.filter((r) => kind === "all" || r.kind === kind),
    [resources, kind],
  );
  const categories = Array.from(new Set(inKind.map((r) => r.category))).sort(
    (a, b) => a.localeCompare(b, "zh-CN"),
  );
  const visible = inKind.filter(
    (r) =>
      (category === "all" || r.category === category) &&
      (!query ||
        [r.name, r.category, r.description, r.url]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  return (
    <ConsoleShell
      context={{ ...context, resourceCount: resources.length }}
      current="resources"
      breadcrumb="资源"
    >
      <header className="ui-page-heading">
        <div>
          <h1>资源</h1>
          <p>{resources.length} 项资源 · 按类型与分类管理</p>
        </div>
        <button className="ws-primary" onClick={() => setEditor(null)}>
          添加资源
        </button>
      </header>
      <section className="ui-panel">
        <div className="ui-toolbar">
          <input
            aria-label="搜索资源"
            placeholder="搜索名称、分类或地址"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="ui-tabs" role="group" aria-label="资源类型">
          {[
            ["all", "全部"],
            ...Object.entries(resourceKinds).map(([k, m]) => [k, m.label]),
          ].map(([k, name]) => (
            <button
              key={k}
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
                setCategory("all");
              }}
            >
              {name}
              <small>
                {resources.filter((r) => k === "all" || r.kind === k).length}
              </small>
            </button>
          ))}
        </div>
        <div className="ui-category-tabs" role="group" aria-label="资源分类">
          <button
            aria-pressed={category === "all"}
            onClick={() => setCategory("all")}
          >
            所有分类
          </button>
          {categories.map((c) => (
            <button
              key={c}
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {c} <small>{inKind.filter((r) => r.category === c).length}</small>
            </button>
          ))}
        </div>
        {error && <p className="ui-warning">{error}</p>}
        <div className="resources-grid">
          {visible.map((r) => {
            const Icon = resourceKinds[r.kind].icon;
            const status = reportedStatus(
              r,
              samples.find((s) => s.resourceId === r.id),
            );
            return (
              <article key={r.id} className="resource-tile">
                <div className="card-type-title">
                  <span className="ws-cardicon">
                    <Icon size={18} />
                  </span>
                  <div>
                    <h3>{r.name}</h3>
                    <small>
                      {resourceKinds[r.kind].label} · {r.category}
                    </small>
                  </div>
                </div>
                <p>{r.description || r.url}</p>
                <span
                  className={`resource-report ${error ? "warning" : status.tone}`}
                >
                  {error ? "上报状态读取失败" : status.label}
                </span>
                <div className="ui-toolbar">
                  <button
                    aria-label={`编辑 ${r.name}`}
                    onClick={() => setEditor(r)}
                  >
                    编辑
                  </button>
                  <Link href={`/?resource=${encodeURIComponent(r.id)}`}>
                    加入总览
                  </Link>
                  {r.kind === "server" && r.agentUrl && (
                    <Link href={`/servers/${r.id}`}>主机详情</Link>
                  )}
                  <a href={r.url} target="_blank" rel="noreferrer">
                    打开 ↗
                  </a>
                </div>
              </article>
            );
          })}
        </div>
        {!visible.length && <p className="ws-empty">没有匹配的资源</p>}
      </section>
      {editor !== undefined && (
        <ResourceEditor
          key={editor?.id || "new"}
          resource={editor}
          preferences={context.preferences}
          boards={context.boards}
          categories={categories}
          onClose={() => setEditor(undefined)}
          onSaved={(r) =>
            setResources((rs) =>
              rs.some((v) => v.id === r.id)
                ? rs.map((v) => (v.id === r.id ? r : v))
                : [r, ...rs],
            )
          }
          onDeleted={(id) =>
            setResources((rs) => rs.filter((r) => r.id !== id))
          }
        />
      )}
    </ConsoleShell>
  );
}
