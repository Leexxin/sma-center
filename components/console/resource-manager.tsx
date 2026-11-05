"use client";
import { useMemo, useState } from "react";
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
}: {
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
  const references = boards.reduce(
    (count, b) =>
      count + b.widgets.filter((w) => w.resourceId === resource?.id).length,
    0,
  );
  const changesCredentialType =
    resource?.kind === "server" &&
    resource.credentialConfigured &&
    draft.kind !== "server";
  async function save() {
    setBusy(true);
    try {
      const r = await consoleRequest<Resource>(
        resource ? `/api/resources/${resource.id}` : "/api/resources",
        resource ? "PATCH" : "POST",
        {
          ...draft,
          ...(draft.kind === "server"
            ? { agentToken: token || undefined, clearAgentToken: clearToken }
            : {}),
        },
      );
      setToken("");
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
            <div className="ui-form-grid">
              <label>
                类型
                <select
                  value={draft.kind}
                  onChange={(e) =>
                    setDraft({ ...draft, kind: e.target.value as ResourceKind })
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
                  maxLength={40}
                  value={draft.category}
                  onChange={(e) =>
                    setDraft({ ...draft, category: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              记录状态
              <select
                value={draft.status}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    status: e.target.value as ResourceWrite["status"],
                  })
                }
              >
                <option value="unknown">未检查</option>
                <option value="online">运行中（手动）</option>
                <option value="warning">需关注（手动）</option>
                <option value="offline">离线（手动）</option>
              </select>
            </label>
            <label>
              名称
              <input
                required
                maxLength={80}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              地址
              <input
                required
                type="url"
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                placeholder="https://"
              />
            </label>
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
                      resource?.credentialConfigured
                        ? "留空保留现有 Token"
                        : "输入 Token"
                    }
                  />
                </label>
                {resource?.credentialConfigured && (
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
                确认更改类型并清除原 Agent 凭据
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
                disabled={busy || (changesCredentialType && !typeClear)}
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
                    <Icon size={17} />
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
                    href={r.url}
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
