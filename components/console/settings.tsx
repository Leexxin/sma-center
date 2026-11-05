"use client";
import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Preferences, Resource } from "@/db/resources";
import { consoleRequest, dialogTheme } from "./resource-manager";
export default function ConsoleSettings({
  open,
  onOpenChange,
  preferences,
  onPreferencesChange,
  onRestored,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preferences: Preferences;
  onPreferencesChange: (p: Preferences) => void;
  onRestored: (r: Resource[], p: Preferences) => Promise<void>;
  editing: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<{
      data: unknown;
      name: string;
      resources: number;
      boards: number;
      definitions: number;
      states: number;
    } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  async function update(p: Preferences) {
    setBusy(true);
    try {
      onPreferencesChange(
        await consoleRequest<Preferences>("/api/preferences", "PUT", p),
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setBusy(true);
    try {
      const response = await fetch("/api/backup", { cache: "no-store" });
      if (!response.ok) throw new Error("备份导出失败。");
      const blob = await response.blob(),
        url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sma-center-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function choose(file?: File) {
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error("备份不能超过 5 MB。");
      const data = JSON.parse(await file.text());
      if (
        !["sma-center-backup-v1", "atlas-backup-v1"].includes(data?.format) ||
        !Array.isArray(data.resources) ||
        !Array.isArray(data.users) ||
        !Array.isArray(data.preferences)
      )
        throw new Error("备份格式无效。");
      setPreview({
        data,
        name: file.name,
        resources: data.resources.length,
        boards: Array.isArray(data.dashboards) ? data.dashboards.length : 0,
        definitions: Array.isArray(data.cardDefinitions)
          ? data.cardDefinitions.length
          : 0,
        states: Array.isArray(data.cardStates) ? data.cardStates.length : 0,
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function restore(mode: "merge" | "replace") {
    if (!preview) return;
    if (
      !window.confirm(
        mode === "replace"
          ? "覆盖全部资源、面板和设置，并清除现有 SMA 凭据？此 JSON 不包含 Token。"
          : "合并此备份中的资源、面板和设置？",
      )
    )
      return;
    setBusy(true);
    try {
      const result = await consoleRequest<{
        resources: Resource[];
        preferences: Preferences;
      }>("/api/backup", "POST", { backup: preview.data, mode });
      await onRestored(result.resources, result.preferences);
      setPreview(null);
      toast.success("备份已还原");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogTheme(preferences)}>
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>全站外观与备份。</DialogDescription>
        </DialogHeader>
        <section className="ui-settings">
          <h2>外观</h2>
          <label>
            主题
            <select
              aria-label="全站主题"
              disabled={busy}
              value={preferences.theme}
              onChange={(e) =>
                void update({
                  ...preferences,
                  theme: e.target.value as Preferences["theme"],
                })
              }
            >
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <label>
            强调色
            <select
              aria-label="全站强调色"
              disabled={busy}
              value={preferences.accent}
              onChange={(e) =>
                void update({
                  ...preferences,
                  accent: e.target.value as Preferences["accent"],
                })
              }
            >
              <option value="cyan">蓝色</option>
              <option value="violet">紫色</option>
              <option value="orange">橙色</option>
            </select>
          </label>
          <label>
            密度
            <select
              aria-label="信息密度"
              disabled={busy}
              value={preferences.density}
              onChange={(e) =>
                void update({
                  ...preferences,
                  density: e.target.value as Preferences["density"],
                })
              }
            >
              <option value="comfortable">舒适</option>
              <option value="compact">紧凑</option>
            </select>
          </label>
          <h2>备份</h2>
          <p>
            JSON 包含资源、面板和设置，不包含
            Token、验证器、监控历史或事件。完整恢复使用数据卷备份。
          </p>
          <div className="ws-actions">
            <button disabled={busy} onClick={download}>
              <Download size={14} />
              导出 JSON
            </button>
            <button
              disabled={busy || editing}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={14} />
              导入 JSON
            </button>
          </div>
          {editing && <small>保存或取消面板编辑后可导入备份。</small>}
          <input
            hidden
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            onChange={(e) => void choose(e.target.files?.[0])}
          />
          {preview && (
            <div className="ui-backup-preview">
              <strong>{preview.name}</strong>
              <p>
                {preview.resources} 项资源 · {preview.boards} 个面板 ·{" "}
                {preview.definitions} 份卡片定义 · {preview.states} 份卡片内容
              </p>
              <p>
                覆盖还原会删除现有资源与面板，并清除 SMA 凭据，需要重新配置
                Token。
              </p>
              <div className="ws-actions">
                <button disabled={busy} onClick={() => setPreview(null)}>
                  取消
                </button>
                <button
                  disabled={busy || editing}
                  onClick={() => void restore("merge")}
                >
                  合并还原
                </button>
                <button
                  className="ui-danger"
                  disabled={busy || editing}
                  onClick={() => void restore("replace")}
                >
                  覆盖还原
                </button>
              </div>
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
