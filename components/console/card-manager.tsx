"use client";
import { useState, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import ConsoleShell from "./shell";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { consoleRequest, dialogTheme } from "./resource-manager";
import { CardIcon } from "./card-runtime";
import type { ConsoleContext } from "@/lib/console-context";
import {
  createCardId,
  builtinCards,
  cardIcons,
  cardRenderers,
  packageOnly,
  parseCardPackage,
  type CardDefinition,
  type CardPackage,
  type CardField,
} from "@/lib/card-package";
import { widgetMeta, widgetTypes } from "@/lib/workspace-model";
function download(p: CardPackage) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = p.id + ".sma-card.json";
  a.click();
  URL.revokeObjectURL(url);
}
export default function CardManager({
  context,
  initialDefinitions,
  plugins = false,
}: {
  context: ConsoleContext;
  initialDefinitions: CardDefinition[];
  plugins?: boolean;
}) {
  const [definitions, setDefinitions] = useState(initialDefinitions),
    [editor, setEditor] = useState<CardDefinition | null>(null),
    [preview, setPreview] = useState<CardPackage | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function reload() {
    setDefinitions(
      await consoleRequest<CardDefinition[]>("/api/card-definitions"),
    );
  }
  async function save(p: CardPackage, revision: number) {
    setBusy(true);
    setError("");
    try {
      await consoleRequest("/api/card-definitions", "POST", {
        manifest: parseCardPackage(p),
        revision,
      });
      await reload();
      setEditor(null);
      setPreview(null);
      toast.success("卡片配置已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const visible = plugins ? definitions.filter((d) => !d.builtin) : definitions;
  return (
    <ConsoleShell
      context={context}
      current={plugins ? "plugins" : "cards"}
      breadcrumb={plugins ? "插件" : "卡片管理"}
    >
      <header className="ui-page-heading">
        <div>
          <h1>{plugins ? "插件" : "卡片管理"}</h1>
          <p>
            {plugins
              ? "导入、导出和维护卡片插件包。"
              : "配置卡片类型；添加到面板时再填写具体内容。"}
          </p>
        </div>
        <div className="ui-toolbar">
          <button
            className="ws-secondary"
            onClick={() => input.current?.click()}
          >
            导入插件包
          </button>
          <button
            className="ws-primary"
            onClick={() => {
              setError("");
              setEditor({
                format: "sma-card-package-v1",
                id: "custom.card." + createCardId(),
                name: "新卡片",
                version: "1.0.0",
                description: "",
                icon: "layout",
                renderer: "fields",
                size: "medium",
                fields: [
                  {
                    key: "content",
                    label: "内容",
                    type: "textarea",
                    required: false,
                    default: "",
                  },
                ],
                revision: 0,
              });
            }}
          >
            新建类型
          </button>
          <input
            ref={input}
            type="file"
            hidden
            accept=".json,.sma-card.json,application/json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                if (file.size > 64000)
                  throw new Error("插件包不能超过 64 KB。");
                setPreview(parseCardPackage(JSON.parse(await file.text())));
                setError("");
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                e.target.value = "";
              }
            }}
          />
        </div>
      </header>
      {!plugins && (
        <>
          <h2 className="ui-section-title">系统卡片</h2>
          <div className="card-type-grid">
            {widgetTypes
              .filter((t) => t !== "plugin")
              .map((type) => (
                <article className="ui-panel" key={type}>
                  <h3>{widgetMeta[type].name}</h3>
                  <p>{widgetMeta[type].description}</p>
                  <small>
                    {
                      {
                        resource: "关联资源",
                        metric: "关联服务器 · 指标 · 阈值",
                        timeseries: "关联服务器 · 趋势指标",
                        links: "收藏资源集合",
                        note: "文本内容",
                        events: "采集异常与告警",
                      }[type]
                    }
                  </small>
                  <Link href={`/?add=${type}`}>添加到总览 ↗</Link>
                </article>
              ))}
          </div>
          <h2 className="ui-section-title">增强卡片</h2>
        </>
      )}
      <div className="card-type-grid">
        {visible.map((d) => (
          <article className="ui-panel" key={d.id}>
            <div className="card-type-title">
              <span className="ws-cardicon">
                <CardIcon name={d.icon} />
              </span>
              <h3>{d.name}</h3>
            </div>
            <p>{d.description || d.renderer}</p>
            <small>
              {d.id} · {d.version} · {d.fields.length} 个字段
              {d.builtin ? " · 内置" : ""}
            </small>
            <div className="ui-toolbar">
              <button
                onClick={() => {
                  setEditor(structuredClone(d));
                  setError("");
                }}
              >
                配置
              </button>
              <button onClick={() => download(d)}>导出</button>
              <Link href={`/?add=${encodeURIComponent(d.id)}`}>
                添加到总览 ↗
              </Link>
            </div>
          </article>
        ))}
      </div>
      {!visible.length && (
        <section className="ui-panel ws-empty">
          尚未导入插件。支持时钟、倒数日、备忘录、待办与自定义字段卡片。
        </section>
      )}
      <p className="ui-footnote">
        插件格式：sma-card-package-v1（JSON）。包内不执行脚本，不提供网络、Token
        或文件系统访问。
      </p>
      {editor && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setEditor(null);
          }}
        >
          <DialogContent
            className={`${dialogTheme(context.preferences)} ui-wide-dialog`}
          >
            <DialogHeader>
              <DialogTitle>配置卡片类型</DialogTitle>
              <DialogDescription>
                字段标识用于保存内容，已使用的字段不建议改名。修改默认值不会覆盖已有卡片值。
              </DialogDescription>
            </DialogHeader>
            <form
              className="ws-config"
              onSubmit={(e) => {
                e.preventDefault();
                void save(packageOnly(editor), editor.revision);
              }}
            >
              {error && (
                <p className="ui-warning" role="alert">
                  {error}
                </p>
              )}
              <div className="ui-form-grid">
                <label>
                  名称
                  <input
                    required
                    maxLength={40}
                    value={editor.name}
                    onChange={(e) =>
                      setEditor({ ...editor, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  标识
                  <input
                    required
                    disabled={editor.revision > 0 || editor.builtin}
                    value={editor.id}
                    onChange={(e) =>
                      setEditor({ ...editor, id: e.target.value })
                    }
                  />
                </label>
                <label>
                  图标
                  <select
                    value={editor.icon}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        icon: e.target.value as CardPackage["icon"],
                      })
                    }
                  >
                    {cardIcons.map((i) => (
                      <option key={i}>{i}</option>
                    ))}
                  </select>
                </label>
                <label>
                  呈现类型
                  <select
                    disabled={editor.builtin}
                    value={editor.renderer}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        renderer: e.target.value as CardPackage["renderer"],
                        fields: builtinCards
                          .find((d) => d.renderer === e.target.value)!
                          .fields.map((f) => ({ ...f })),
                      })
                    }
                  >
                    {cardRenderers.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <label>
                  版本
                  <input
                    required
                    value={editor.version}
                    onChange={(e) =>
                      setEditor({ ...editor, version: e.target.value })
                    }
                  />
                </label>
                <label>
                  默认尺寸
                  <select
                    value={editor.size}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        size: e.target.value as CardPackage["size"],
                      })
                    }
                  >
                    {["small", "medium", "wide", "full"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                说明
                <input
                  maxLength={180}
                  value={editor.description}
                  onChange={(e) =>
                    setEditor({ ...editor, description: e.target.value })
                  }
                />
              </label>
              <h3>字段</h3>
              {editor.fields.map((f, index) => {
                const update = (next: CardField) =>
                  setEditor({
                    ...editor,
                    fields: editor.fields.map((v, i) =>
                      i === index ? next : v,
                    ),
                  });
                return (
                  <fieldset className="card-field-editor" key={index}>
                    <div className="ui-form-grid">
                      <label>
                        字段标识
                        <input
                          required
                          value={f.key}
                          onChange={(e) =>
                            update({ ...f, key: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        显示名称
                        <input
                          required
                          maxLength={40}
                          value={f.label}
                          onChange={(e) =>
                            update({ ...f, label: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        字段类型
                        <select
                          value={f.type}
                          onChange={(e) => {
                            const type = e.target.value as CardField["type"];
                            update({
                              ...f,
                              type,
                              default:
                                type === "boolean"
                                  ? false
                                  : type === "number"
                                    ? 0
                                    : "",
                            });
                          }}
                        >
                          {[
                            "text",
                            "textarea",
                            "number",
                            "date",
                            "timezone",
                            "boolean",
                          ].map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        默认值
                        {f.type === "boolean" ? (
                          <input
                            type="checkbox"
                            checked={Boolean(f.default)}
                            onChange={(e) =>
                              update({ ...f, default: e.target.checked })
                            }
                          />
                        ) : (
                          <input
                            value={String(f.default)}
                            onChange={(e) =>
                              update({
                                ...f,
                                default:
                                  f.type === "number"
                                    ? Number(e.target.value)
                                    : e.target.value,
                              })
                            }
                            placeholder={
                              f.type === "date"
                                ? "2027-01-01T00:00:00+08:00"
                                : ""
                            }
                          />
                        )}
                      </label>
                    </div>
                    <label className="ui-check">
                      <input
                        type="checkbox"
                        checked={f.required}
                        onChange={(e) =>
                          update({ ...f, required: e.target.checked })
                        }
                      />
                      必填
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setEditor({
                          ...editor,
                          fields: editor.fields.filter((_, i) => i !== index),
                        })
                      }
                    >
                      移除字段
                    </button>
                  </fieldset>
                );
              })}
              <button
                type="button"
                disabled={editor.fields.length >= 20}
                onClick={() =>
                  setEditor({
                    ...editor,
                    fields: [
                      ...editor.fields,
                      {
                        key: "field_" + (editor.fields.length + 1),
                        label: "新字段",
                        type: "text",
                        required: false,
                        default: "",
                      },
                    ],
                  })
                }
              >
                添加字段
              </button>
              <div className="ws-actions">
                {editor.revision > 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          editor.builtin
                            ? "恢复此类型的内置默认配置？"
                            : "删除插件？已被面板使用时不能删除。",
                        )
                      )
                        return;
                      setBusy(true);
                      try {
                        await consoleRequest(
                          "/api/card-definitions/" +
                            encodeURIComponent(editor.id),
                          "DELETE",
                          { revision: editor.revision },
                        );
                        await reload();
                        setEditor(null);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {editor.builtin ? "恢复默认" : "删除插件"}
                  </button>
                )}
                <span className="ws-spacer" />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditor(null)}
                >
                  取消
                </button>
                <button className="ws-primary" disabled={busy}>
                  保存类型
                </button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {preview && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setPreview(null);
          }}
        >
          <DialogContent className={dialogTheme(context.preferences)}>
            <DialogHeader>
              <DialogTitle>导入 {preview.name}</DialogTitle>
              <DialogDescription>
                {preview.id} · {preview.version} · {preview.renderer}
              </DialogDescription>
            </DialogHeader>
            <p>{preview.description}</p>
            <ul>
              {preview.fields.map((f) => (
                <li key={f.key}>
                  {f.label} · {f.type}
                  {f.required ? " · 必填" : ""}
                </li>
              ))}
            </ul>
            {definitions.some((d) => d.id === preview.id) && (
              <p className="ui-warning">
                同标识类型已存在，确认后更新定义；已有卡片的值保留。
              </p>
            )}
            {error && (
              <p role="alert" className="ui-warning">
                {error}
              </p>
            )}
            <button
              className="ws-primary"
              disabled={busy}
              onClick={() =>
                void save(
                  preview,
                  definitions.find((d) => d.id === preview.id)?.revision || 0,
                )
              }
            >
              确认导入
            </button>
          </DialogContent>
        </Dialog>
      )}
    </ConsoleShell>
  );
}
