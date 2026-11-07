"use client";
import { databaseServices, type DatabaseConnection } from "@/lib/database-connection";
import { resourceOpenUrl } from "@/lib/resource-address";
import SiteIcon from "@/components/console/site-icon";
import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Server,
  Database,
  Globe,
  Layers,
  Wrench,
  MoreHorizontal,
  Star,
  ArrowUpRight,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import type {
  Preferences,
  Resource,
  ResourceKind,
  ResourceWrite,
} from "@/db/resources";
import type { Board } from "@/lib/workspace-model";
export const resourceKinds = {
  server: { label: "服务器", icon: Server },
  site: { label: "站点", icon: Globe },
  tool: { label: "工具", icon: Wrench },
  database: { label: "数据库", icon: Database },
  middleware: { label: "中间件", icon: Layers },
};
export const dialogTheme = (p: Preferences) =>
  `ws-dialog ws-${p.theme} ws-accent-${p.accent}`;
export async function consoleRequest<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    ...(body !== undefined
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const payload =
    response.status === 204
      ? null
      : ((await response.json()) as { error?: string });
  if (!response.ok) throw new Error(payload?.error || "请求失败。");
  return payload as T;
}
const empty: ResourceWrite = {
  kind: "server",
  name: "",
  url: "",
  description: "",
  category: "其他",
  status: "unknown",
  note: "",
  pinned: false,
  cpuUsage: 0,
  temperature: 0,
  memoryUsage: 0,
  diskUsage: 0,
  agentUrl: "",
};
export function ResourceEditor({
  resource,
  preferences,
  boards,
  onClose,
  onSaved,
  onDeleted,
  categories = [],
}: {
  categories?: string[];
  resource: Resource | null;
  preferences: Preferences;
  boards: Board[];
  onClose: () => void;
  onSaved: (r: Resource) => void;
  onDeleted: (id: string) => void;
}) {
  const [draft, setDraft] = useState<ResourceWrite>(
    resource
      ? {
          kind: resource.kind,
          name: resource.name,
          url: resource.url,
          siteIcon: resource.siteIcon,
          siteIconSource: resource.siteIconSource,
          database: resource.database,
          description: resource.description,
          category: resource.category,
          status: resource.status,
          note: resource.note,
          pinned: resource.pinned,
          cpuUsage: resource.cpuUsage,
          temperature: resource.temperature,
          memoryUsage: resource.memoryUsage,
          diskUsage: resource.diskUsage,
          agentUrl: resource.agentUrl,
        }
      : { ...empty },
  );
  const [token, setToken] = useState(""),
    [clearToken, setClearToken] = useState(false),
    [typeClear, setTypeClear] = useState(false),
    [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState(false);
  const [databasePassword, setDatabasePassword] = useState("");
  const [clearDatabasePassword, setClearDatabasePassword] = useState(false);
  const database: DatabaseConnection = draft.database || {service:"mysql",host:"",port:3306,username:"",database:"",purpose:""};
  const updateDatabase = (value: Partial<DatabaseConnection>) => setDraft(current=>({...current,database:{...(current.database || database),...value}}));
  const [iconBusy, setIconBusy] = useState(false);
  const [iconMessage, setIconMessage] = useState("");
  const [iconRefresh, setIconRefresh] = useState(0);
  useEffect(() => {
    if (draft.kind !== "site") return;
    const url = draft.url.trim();
    const iconSource = draft.siteIconSource;
    try { if (!["http:", "https:"].includes(new URL(url).protocol)) return; } catch { return; }
    if (!iconRefresh && resource?.url === url && resource?.siteIconSource === iconSource && resource?.siteIcon) return;
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(async () => {
      setIconBusy(true);
      setIconMessage("");
      try {
        const response = await fetch("/api/site-icon", {
          method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, iconSource }),
        });
        const result = await response.json() as { siteIcon: string };
        if (!response.ok) throw new Error();
        if (active) {
          setDraft((current) => current.kind === "site" && current.url.trim() === url && current.siteIconSource === iconSource ? { ...current, siteIcon: result.siteIcon } : current);
          setIconMessage(result.siteIcon ? "已采集站点图标" : "未找到可用图标，将使用默认图标。");
        }
      } catch {
        if (active) setIconMessage("图标采集失败，将使用默认图标，可稍后重试。");
      } finally { if (active) setIconBusy(false); }
    }, 500);
    return () => { active = false; clearTimeout(timer); controller.abort(); setIconBusy(false); };
  }, [draft.kind, draft.url, draft.siteIconSource, iconRefresh, resource?.url, resource?.siteIcon, resource?.siteIconSource]);
  const references = boards.reduce(
    (count, b) =>
      count + b.widgets.filter((w) => w.resourceId === resource?.id).length,
    0,
  );
  const changesCredentialType = !!resource?.credentialConfigured && ["server","database"].includes(resource.kind) && draft.kind !== resource.kind;
  async function save() {
    if (iconBusy) return;
    setBusy(true);
    try {
      const r = await consoleRequest<Resource>(
        resource ? `/api/resources/${resource.id}` : "/api/resources",
        resource ? "PATCH" : "POST",
        {
          ...draft,
          ...(draft.kind === "database" ? { database, databasePassword: databasePassword || undefined, clearDatabasePassword } : {}),
          ...(draft.kind === "server"
            ? { agentToken: token || undefined, clearAgentToken: clearToken }
            : {}),
        },
      );
      setToken("");
      setDatabasePassword("");
      onSaved(r);
      onClose();
      toast.success("资源已保存");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!resource) return;
    setBusy(true);
    try {
      await consoleRequest(`/api/resources/${resource.id}`, "DELETE");
      onDeleted(resource.id);
      setDeleting(false);
      onClose();
      toast.success("资源已删除");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) onClose();
        }}
      >
        <DialogContent className={dialogTheme(preferences)}>
          <DialogHeader>
            <DialogTitle>{resource ? "编辑资源" : "添加资源"}</DialogTitle>
            <DialogDescription>名称、地址和连接配置。</DialogDescription>
          </DialogHeader>
          <form
            className="ws-config"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <datalist id="resource-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <div className="ui-form-grid">
              <label>
                类型
                <select
                  value={draft.kind}
                  onChange={(e) =>
                    setDraft({ ...draft, kind: e.target.value as ResourceKind, ...(e.target.value === "database" && !draft.database ? {database} : {}) })
                  }
                >
                  {Object.entries(resourceKinds).map(([kind, meta]) => (
                    <option key={kind} value={kind}>
                      {meta.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                分类
                <input
                  list="resource-categories"
                  maxLength={40}
                  value={draft.category}
                  onChange={(e) =>
                    setDraft({ ...draft, category: e.target.value })
                  }
                />
              </label>
            </div>
            {draft.kind !== "site" && <p className="ui-muted">
              状态由连接器自动上报；未接入上报的资源显示未检查。
            </p>}
            <label>
              名称
              <input
                required
                maxLength={80}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            {draft.kind !== "database" && <label>
              地址
              <input
                required
                type={draft.kind === "server" ? "text" : "url"}
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value, siteIcon: "" })}
                placeholder={draft.kind === "server" ? "192.168.1.10 或 IPv6 地址" : "https://"}
              />
            </label>}
            {draft.kind === "site" && <label>业务图标地址（可选）<input type="url" value={draft.siteIconSource || ""} onChange={e=>setDraft({...draft,siteIconSource:e.target.value,siteIcon:""})} placeholder="业务系统的真实 favicon 地址"/><small>经过 SSO 跳转时使用此地址采集业务图标，不使用登录中心图标。</small></label>}
            {draft.kind === "database" && <fieldset><legend>数据库连接</legend>
              <div className="ui-form-grid"><label>服务<select value={database.service} onChange={e=>{const service=e.target.value as DatabaseConnection["service"];updateDatabase({service,port:databaseServices[service].port});}}>{Object.entries(databaseServices).map(([key,value])=><option value={key} key={key}>{value.label}</option>)}</select></label><label>端口<input type="number" min={1} max={65535} required value={database.port} onChange={e=>updateDatabase({port:Number(e.target.value)})}/></label></div>
              <label>主机 / IP<input required value={database.host} onChange={e=>updateDatabase({host:e.target.value})} placeholder="192.168.1.10"/></label>
              <div className="ui-form-grid"><label>用户<input value={database.username} maxLength={128} onChange={e=>updateDatabase({username:e.target.value})}/></label><label>默认库 / DB<input value={database.database} maxLength={128} onChange={e=>updateDatabase({database:e.target.value})}/></label></div>
              <label>用途<input value={database.purpose} maxLength={240} onChange={e=>updateDatabase({purpose:e.target.value})}/></label>
              <label>密码<input type="password" autoComplete="new-password" value={databasePassword} disabled={clearDatabasePassword} onChange={e=>setDatabasePassword(e.target.value)} placeholder={resource?.kind === "database" && resource.credentialConfigured ? "留空以保留已配置密码" : "输入数据库密码"}/></label>
              <small>密码仅写入加密存储，不回显或导出到 JSON 备份。连接信息保存不代表已建立数据库监控。</small>
              {resource?.kind === "database" && resource.credentialConfigured && <label className="ui-check"><input type="checkbox" checked={clearDatabasePassword} onChange={e=>{setClearDatabasePassword(e.target.checked);setDatabasePassword("");}}/>清除已保存密码</label>}
            </fieldset>}
            {draft.kind === "site" && (
              <div className="site-icon-setting">
                <span className="ws-cardicon"><SiteIcon icon={draft.siteIcon} size={24} /></span>
                <div><strong>站点图标</strong><p aria-live="polite">{iconBusy ? "正在采集图标…" : iconMessage || (draft.siteIcon ? "已保存站点图标" : "输入站点地址后自动采集")}</p></div>
                <button type="button" disabled={iconBusy || busy || !draft.url} onClick={() => setIconRefresh((n) => n + 1)}>重新采集</button>
              </div>
            )}
            <label>
              说明
              <input
                maxLength={180}
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
            </label>
            {draft.kind === "server" && (
              <fieldset>
                <legend>SMA Agent</legend>
                <label>
                  Agent 地址
                  <input
                    type="url"
                    value={draft.agentUrl}
                    onChange={(e) =>
                      setDraft({ ...draft, agentUrl: e.target.value })
                    }
                    placeholder="http://192.168.1.10:9108"
                  />
                </label>
                <label>
                  Bearer Token
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={token}
                    disabled={clearToken}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={
                      resource?.kind === "server" && resource.credentialConfigured
                        ? "留空保留现有 Token"
                        : "输入 Token"
                    }
                  />
                </label>
                {resource?.kind === "server" && resource.credentialConfigured && (
                  <label className="ui-check">
                    <input
                      type="checkbox"
                      checked={clearToken}
                      onChange={(e) => {
                        setClearToken(e.target.checked);
                        setToken("");
                      }}
                    />
                    清除已保存的 Token
                  </label>
                )}
                <small>
                  Token 仅在服务端加密保存，不会回显或包含在 JSON 备份中。
                </small>
              </fieldset>
            )}
            {changesCredentialType && (
              <label className="ui-check ui-warning">
                <input
                  type="checkbox"
                  required
                  checked={typeClear}
                  onChange={(e) => setTypeClear(e.target.checked)}
                />
                确认更改类型并清除原连接凭据
              </label>
            )}
            <label>
              备注
              <textarea
                rows={3}
                maxLength={240}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </label>
            <label className="ui-check">
              <input
                type="checkbox"
                checked={draft.pinned}
                onChange={(e) =>
                  setDraft({ ...draft, pinned: e.target.checked })
                }
              />
              收藏
            </label>
            <div className="ws-actions">
              {resource && (
                <button
                  type="button"
                  className="ui-danger"
                  disabled={busy}
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 size={14} />
                  删除资源
                </button>
              )}
              <span className="ws-spacer" />
              <button type="button" onClick={onClose} disabled={busy}>
                取消
              </button>
              <button
                className="ws-primary"
                type="submit"
                disabled={busy || iconBusy || (changesCredentialType && !typeClear)}
              >
                {busy ? "保存中…" : "保存资源"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent className={dialogTheme(preferences)}>
          <AlertDialogHeader>
            <AlertDialogTitle>删除资源？</AlertDialogTitle>
            <AlertDialogDescription>
              会移除其连接凭据和监控历史，{references}{" "}
              张关联卡片将显示资源不存在。对应服务器或站点不会被删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={remove}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
export default function ResourceManager({
  open,
  onOpenChange,
  resources,
  preferences,
  boards,
  onChange,
  onInspect,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resources: Resource[];
  preferences: Preferences;
  boards: Board[];
  onChange: (r: Resource[]) => void;
  onInspect: (r: Resource) => void;
  onAdd: (r: Resource) => void;
}) {
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState("all"),
    [editor, setEditor] = useState<Resource | null | undefined>(undefined);
  const visible = useMemo(
    () =>
      resources.filter(
        (r) =>
          (kind === "all" || kind === r.kind) &&
          (!query ||
            [r.name, r.category, r.description, r.url]
              .join(" ")
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [resources, kind, query],
  );
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={`${dialogTheme(preferences)} ui-wide-dialog`}>
          <DialogHeader>
            <DialogTitle>资源</DialogTitle>
            <DialogDescription>{resources.length} 项资源</DialogDescription>
          </DialogHeader>
          <div className="ui-toolbar">
            <label className="ui-search">
              <Search size={15} />
              <input
                aria-label="搜索资源"
                placeholder="搜索名称、分类或地址"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <button className="ws-primary" onClick={() => setEditor(null)}>
              <Plus size={15} />
              添加资源
            </button>
          </div>
          <div className="ui-tabs" role="group" aria-label="资源类型">
            {[
              ["all", "全部"],
              ...Object.entries(resourceKinds).map(([k, m]) => [k, m.label]),
            ].map(([k, label]) => (
              <button
                key={k}
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="ui-resource-list">
            {visible.map((r) => {
              const Icon = resourceKinds[r.kind].icon;
              return (
                <article key={r.id}>
                  <span className="ws-cardicon">
                    {r.kind === "site" ? <SiteIcon icon={r.siteIcon} url={r.url} iconSource={r.siteIconSource} size={17} /> : <Icon size={17} />}
                  </span>
                  <button
                    className="ui-resource-name"
                    onClick={() => {
                      onOpenChange(false);
                      onInspect(r);
                    }}
                  >
                    <strong>{r.name}</strong>
                    <small>
                      {r.category} ·{" "}
                      {r.kind === "server"
                        ? r.agentUrl
                          ? "SMA 已配置"
                          : "未配置 Agent"
                        : resourceKinds[r.kind].label}
                    </small>
                  </button>
                  <button
                    className="ws-icon-button"
                    aria-label={`添加 ${r.name} 到面板`}
                    onClick={() => onAdd(r)}
                  >
                    <Plus size={16} />
                  </button>
                  {r.pinned && <Star size={13} className="ui-muted" />}
                  <a
                    href={resourceOpenUrl(r)}
                    aria-label={`打开 ${r.name}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ArrowUpRight size={16} />
                  </a>
                  <button
                    className="ws-icon-button"
                    aria-label={`编辑 ${r.name}`}
                    onClick={() => setEditor(r)}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </article>
              );
            })}
            {!visible.length && <p className="ws-empty">没有匹配的资源</p>}
          </div>
        </DialogContent>
      </Dialog>
      {editor !== undefined && (
        <ResourceEditor
          key={editor?.id || "new"}
          resource={editor}
          preferences={preferences}
          boards={boards}
          onClose={() => setEditor(undefined)}
          onSaved={(r) =>
            onChange(
              resources.some((item) => item.id === r.id)
                ? resources.map((item) => (item.id === r.id ? r : item))
                : [r, ...resources],
            )
          }
          onDeleted={(id) => onChange(resources.filter((r) => r.id !== id))}
        />
      )}
    </>
  );
}
