"use client";
import { resourceOpenUrl } from "@/lib/resource-address";
import SiteIcon from "@/components/console/site-icon";
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
import CollectionStatus from "./collection-status";
import { reportedStatus } from "@/lib/resource-status";
type Application = { id: string; name: string; url: string };
type Sample = {
  resourceId: string;
  quality: string;
  timestamp: number;
  payload?: { errors?: { collector: string; code: string }[] };
};

export default function ResourcesPage({
  context,
  initialResources,
  initialKind = "all",
}: {
  initialKind?: string;
  context: ConsoleContext;
  initialResources: Resource[];
}) {
  const [resources, setResources] = useState(initialResources),
    [kind, setKind] = useState(initialKind),
    [category, setCategory] = useState("all"),
    [query, setQuery] = useState(""),
    [editor, setEditor] = useState<Resource | null | undefined>(undefined),
    [samples, setSamples] = useState<Sample[]>([]),
    [error, setError] = useState("");
  const [applications, setApplications] = useState<Application[]>([]);
  const [applicationError, setApplicationError] = useState("");
  const [ssoEnabled, setSsoEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    consoleRequest<{ enabled: boolean; applications: typeof applications }>("/api/applications")
      .then((result) => {
        if (active) {
          setApplications(result.applications);
          setSsoEnabled(result.enabled);
        }
      })
      .catch(() => {
        if (active) setApplicationError("业务应用暂时无法读取，请刷新重试。");
      });
    return () => {
      active = false;
    };
  }, []);
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
  const visibleApplications = (kind === "all" || kind === "application") && category === "all"
    ? applications.filter((a) => !query.trim() || `${a.name} ${a.url}`.toLowerCase().includes(query.trim().toLowerCase()))
    : [];
  return (
    <ConsoleShell
      context={{ ...context, resourceCount: resources.length }}
      current="resources"
      breadcrumb="资源"
    >
      <header className="ui-page-heading">
        <div>
          <h1>资源</h1>
          <p>{resources.length} 项资源 · {applications.length} 项业务应用</p>
        </div>
        <button className="ws-primary" onClick={() => setEditor(null)}>
          添加资源
        </button>
      </header>
      <section className="ui-panel resources-panel">
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
            ["application", "业务应用"],
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
                {k === "application" ? applications.length : resources.filter((r) => k === "all" || r.kind === k).length + (k === "all" ? applications.length : 0)}
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
        {(kind === "all" || kind === "application") && applicationError && <p className="ui-warning" role="alert">{applicationError}</p>}
        {kind === "application" && ssoEnabled === false && <p className="ui-muted">尚未启用统一登录，请按 SSO 接入文档配置。</p>}
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
                    {r.kind === "site" ? <SiteIcon icon={r.siteIcon} url={r.url} iconSource={r.siteIconSource} /> : <Icon size={18} />}
                  </span>
                  <div>
                    <h3>{r.name}</h3>
                    <small>
                      {resourceKinds[r.kind].label} · {r.category}
                    </small>
                  </div>
                </div>
                <p>{r.description || r.url}</p>
                {r.kind === "database" && r.database && <dl className="database-summary"><div><dt>连接</dt><dd>{r.database.host}:{r.database.port}</dd></div><div><dt>用户</dt><dd>{r.database.username || "—"}</dd></div><div><dt>默认库 / DB</dt><dd>{r.database.database || "—"}</dd></div><div><dt>用途</dt><dd>{r.database.purpose || "—"}</dd></div><div><dt>密码</dt><dd>{r.credentialConfigured?"已配置":"未配置"}</dd></div></dl>}
                {r.kind !== "site" && <CollectionStatus
                  className={`resource-report ${error ? "warning" : status.tone}`}
                  tone={error ? "warning" : status.tone}
                  label={error ? "上报状态读取失败" : status.label}
                  errors={samples.find((s) => s.resourceId === r.id)?.payload?.errors}
                />}
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
                  {resourceOpenUrl(r) && <a href={resourceOpenUrl(r)} target="_blank" rel="noreferrer">打开 ↗</a>}
                </div>
              </article>
            );
          })}
          {visibleApplications.map((a) => (
            <article key={`application:${a.id}`} className="resource-tile">
              <div className="card-type-title"><h3>{a.name}</h3></div>
              <small>业务应用 · 统一登录</small>
              <p>{a.url}</p>
              <a href={a.url} rel="noreferrer">打开应用 ↗</a>
            </article>
          ))}
        </div>
        {!visible.length && !visibleApplications.length && <p className="ws-empty">没有匹配的资源</p>}
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
