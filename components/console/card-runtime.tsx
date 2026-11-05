"use client";
import { useEffect, useState } from "react";
import {
  Activity,
  Bell,
  Calendar,
  CheckSquare,
  Clock,
  Database,
  Globe,
  LayoutGrid,
  Link as LinkIcon,
  Server,
  Star,
  StickyNote,
  Trash2,
} from "lucide-react";
import {
  createCardId,
  parseCardValues,
  type CardDefinition,
  type CardState,
  type CardIconName,
} from "@/lib/card-package";
import type { Widget } from "@/lib/workspace-model";
import { consoleRequest } from "./resource-manager";
export const cardIconMap = {
  layout: LayoutGrid,
  server: Server,
  activity: Activity,
  link: LinkIcon,
  note: StickyNote,
  bell: Bell,
  clock: Clock,
  calendar: Calendar,
  check: CheckSquare,
  database: Database,
  globe: Globe,
  star: Star,
};
export function CardIcon({
  name,
  size = 18,
}: {
  name?: string;
  size?: number;
}) {
  const Icon = cardIconMap[name as CardIconName] || LayoutGrid;
  return <Icon size={size} />;
}
export function CardFields({
  definition,
  values,
  onChange,
}: {
  definition: CardDefinition;
  values: Record<string, string | number | boolean>;
  onChange: (values: Record<string, string | number | boolean>) => void;
}) {
  return (
    <>
      {definition.fields.map((f) => {
        const v = values[f.key] ?? f.default;
        const set = (value: string | number | boolean) =>
          onChange({ ...values, [f.key]: value });
        return (
          <label key={f.key}>
            {f.label}
            {f.required ? " *" : ""}
            {f.type === "boolean" ? (
              <input
                type="checkbox"
                checked={Boolean(v)}
                onChange={(e) => set(e.target.checked)}
              />
            ) : f.type === "textarea" ? (
              <textarea
                maxLength={4000}
                required={f.required}
                value={String(v)}
                onChange={(e) => set(e.target.value)}
              />
            ) : f.type === "date" ? (
              <input
                type="datetime-local"
                required={f.required}
                value={
                  v
                    ? (() => {
                        const d = new Date(String(v));
                        return new Date(
                          d.getTime() - d.getTimezoneOffset() * 60000,
                        )
                          .toISOString()
                          .slice(0, 16);
                      })()
                    : ""
                }
                onChange={(e) =>
                  set(
                    e.target.value
                      ? new Date(e.target.value).toISOString()
                      : "",
                  )
                }
              />
            ) : (
              <input
                type={f.type === "number" ? "number" : "text"}
                required={f.required}
                maxLength={240}
                value={String(v)}
                placeholder={
                  f.type === "timezone" ? "Asia/Shanghai" : undefined
                }
                onChange={(e) =>
                  set(
                    f.type === "number"
                      ? Number(e.target.value)
                      : e.target.value,
                  )
                }
              />
            )}
          </label>
        );
      })}
    </>
  );
}
export default function EnhancedCard({
  widget,
  definition,
  boardId,
  editing = false,
}: {
  widget: Widget;
  definition?: CardDefinition;
  boardId: string;
  editing?: boolean;
}) {
  const [now, setNow] = useState<number | null>(null),
    [saved, setSaved] = useState<{ state: CardState; revision: number } | null>(
      null,
    ),
    [memo, setMemo] = useState(""),
    [item, setItem] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    if (!definition || !["clock", "countdown"].includes(definition.renderer))
      return;
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [definition]);
  const interactive =
    definition && ["memo", "todo"].includes(definition.renderer);
  const path = `/api/dashboards/${encodeURIComponent(boardId)}/widgets/${encodeURIComponent(widget.id)}/state`;
  const initialText = String(
    widget.values?.text ??
      definition?.fields.find((f) => f.key === "text")?.default ??
      "",
  );
  useEffect(() => {
    let alive = true;
    if (!interactive || editing) return;
    const timer = window.setTimeout(() => {
      setSaved(null);
      setError("");
      void consoleRequest<{ state: CardState; revision: number }>(path)
        .then((r) => {
          if (alive) {
            setSaved(r);
            setMemo(r.state.text ?? initialText);
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [path, interactive, editing, initialText]);
  async function persist(state: CardState) {
    if (!saved || busy) return false;
    setBusy(true);
    setError("");
    try {
      const next = await consoleRequest<{ state: CardState; revision: number }>(
        path,
        "PUT",
        { state, revision: saved.revision },
      );
      setSaved(next);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (!definition)
    return <p className="ws-empty">卡片插件未安装，请前往插件管理。</p>;
  let values: Record<string, string | number | boolean>;
  try {
    values = parseCardValues(definition, widget.values || {}, false);
  } catch {
    return <p className="ui-warning">卡片字段已变更，请重新配置。</p>;
  }
  if (definition.renderer === "clock")
    return (
      <div className="card-clock">
        <strong>
          {now === null
            ? "—"
            : new Intl.DateTimeFormat("zh-CN", {
                timeZone: String(values.timezone || "Asia/Shanghai"),
                hour: "2-digit",
                minute: "2-digit",
                ...(values.seconds ? { second: "2-digit" } : {}),
                hour12: false,
              }).format(now)}
        </strong>
        <span>
          {now === null
            ? ""
            : new Intl.DateTimeFormat("zh-CN", {
                timeZone: String(values.timezone || "Asia/Shanghai"),
                dateStyle: "full",
              }).format(now)}
        </span>
        <small>{String(values.timezone || "Asia/Shanghai")}</small>
      </div>
    );
  if (definition.renderer === "countdown") {
    const target = Date.parse(String(values.target));
    if (!Number.isFinite(target))
      return <p className="ws-empty">请选择目标时间</p>;
    const delta = now === null ? null : target - now;
    return (
      <div className="card-countdown">
        <small>{String(values.caption || "距离目标日期")}</small>
        <strong>
          {delta === null ? "—" : Math.ceil(Math.abs(delta) / 86400000)}
          <span>天{delta !== null && delta < 0 ? "前" : ""}</span>
        </strong>
        <span>
          {new Date(target).toLocaleString("zh-CN", {
            hour12: false,
            timeZone: "Asia/Shanghai",
          })}
        </span>
        {delta !== null && delta >= 0 && (
          <small>
            {Math.floor(delta / 3600000) % 24} 小时{" "}
            {Math.floor(delta / 60000) % 60} 分钟{" "}
            {Math.floor(delta / 1000) % 60} 秒
          </small>
        )}
      </div>
    );
  }
  if (interactive) {
    const initialItems = String(values.items || "")
      .split("\n")
      .filter(Boolean)
      .slice(0, 100)
      .map((text, i) => ({
        id: "initial-" + i,
        text: text.slice(0, 240),
        done: false,
      }));
    const items = saved?.state.items ?? initialItems;
    return (
      <div className="card-interactive">
        {error && (
          <div className="ui-warning" role="alert">
            {error}
            <button
              onClick={() => {
                setError("");
                setBusy(true);
                consoleRequest<{ state: CardState; revision: number }>(path)
                  .then((r) => {
                    setSaved(r);
                    setMemo(r.state.text ?? initialText);
                  })
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              重新载入
            </button>
          </div>
        )}
        {editing ? (
          <p className="ws-empty">保存面板后可编辑内容。</p>
        ) : definition.renderer === "memo" ? (
          <>
            <textarea
              aria-label="备忘内容"
              maxLength={4000}
              disabled={!saved || busy}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
            <button
              className="ws-text-link"
              disabled={
                !saved || busy || memo === (saved.state.text ?? initialText)
              }
              onClick={() => void persist({ text: memo })}
            >
              {busy ? "保存中…" : "保存内容"}
            </button>
          </>
        ) : (
          <>
            <ul className="card-todos">
              {items.map((i) => (
                <li key={i.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={i.done}
                      disabled={!saved || busy}
                      onChange={() =>
                        void persist({
                          items: items.map((t) =>
                            t.id === i.id ? { ...t, done: !t.done } : t,
                          ),
                        })
                      }
                    />
                    <span className={i.done ? "completed" : ""}>{i.text}</span>
                  </label>
                  <button
                    className="ws-icon-button"
                    aria-label={`删除待办 ${i.text}`}
                    disabled={!saved || busy}
                    onClick={() =>
                      void persist({
                        items: items.filter((t) => t.id !== i.id),
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
            {!items.length && <p className="ui-muted">还没有待办</p>}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (item.trim() && items.length < 100)
                  void persist({
                    items: [
                      ...items,
                      { id: createCardId(), text: item.trim(), done: false },
                    ],
                  }).then((ok) => {
                    if (ok) setItem("");
                  });
              }}
            >
              <input
                aria-label="新待办"
                maxLength={240}
                value={item}
                onChange={(e) => setItem(e.target.value)}
                disabled={!saved || busy || items.length >= 100}
                placeholder="添加事项"
              />
              <button
                disabled={!saved || busy || !item.trim() || items.length >= 100}
              >
                添加
              </button>
            </form>
          </>
        )}
      </div>
    );
  }
  return (
    <dl className="card-fields">
      {definition.fields.map((f) => (
        <div key={f.key}>
          <dt>{f.label}</dt>
          <dd>
            {typeof values[f.key] === "boolean"
              ? values[f.key]
                ? "是"
                : "否"
              : String(values[f.key] === "" ? "—" : values[f.key])}
          </dd>
        </div>
      ))}
    </dl>
  );
}
