"use client";
import { useEffect, useState } from "react";
import type { LiveSnapshot } from "@/lib/sma-metrics";
import { consoleRequest } from "./resource-manager";
const bytes = (n: number | undefined | null) =>
  n == null
    ? "—"
    : n < 1024
      ? `${n} B`
      : n < 1024 ** 2
        ? `${(n / 1024).toFixed(1)} KiB`
        : n < 1024 ** 3
          ? `${(n / 1024 ** 2).toFixed(1)} MiB`
          : `${(n / 1024 ** 3).toFixed(1)} GiB`;
export default function ServerMetrics({ resourceId }: { resourceId: string }) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () =>
      consoleRequest<LiveSnapshot>(`/api/resources/${resourceId}/snapshot`)
        .then((s) => {
          if (active) {
            setSnapshot(s);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void load();
    const timer = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [resourceId]);
  if (error)
    return (
      <p className="ui-warning" role="alert">
        {error}
      </p>
    );
  if (!snapshot) return <p className="ws-empty">正在读取 Agent…</p>;
  return (
    <section className="ui-server-metrics">
      <dl className="ws-detail-list">
        <div>
          <dt>Agent / 协议</dt>
          <dd>
            {snapshot.agentVersion || "未知"} / {snapshot.schemaVersion}
          </dd>
        </div>
        <div>
          <dt>平台</dt>
          <dd>
            {snapshot.host.os} · {snapshot.host.architecture}
          </dd>
        </div>
      </dl>
      {snapshot.errors.length > 0 && (
        <div className="ui-warning">
          <strong>采集异常</strong>
          {snapshot.errors.map((e, i) => (
            <p key={i}>
              {e.collector} · {e.code}
            </p>
          ))}
        </div>
      )}
      {snapshot.host.unsupportedMetrics.length > 0 && (
        <p className="ui-muted">
          不支持：{snapshot.host.unsupportedMetrics.join("、")}
        </p>
      )}
      <details>
        <summary>文件系统</summary>
        {snapshot.filesystems.map((f, i) => (
          <div className="ui-detail-row" key={i}>
            <span>{f.mountpoint}</span>
            <span>
              {bytes(f.availableBytes)} / {bytes(f.sizeBytes)} 可用
            </span>
          </div>
        ))}
        {!snapshot.filesystems.length && <p>无数据</p>}
      </details>
      <details>
        <summary>磁盘 I/O</summary>
        {snapshot.metrics.diskRates.map((d) => (
          <div className="ui-detail-row" key={d.device}>
            <span>{d.device}</span>
            <span>
              读 {bytes(d.readBytesPerS)}/s · 写 {bytes(d.writeBytesPerS)}/s
              <br />
              {d.readIOPS?.toFixed(1) ?? "—"} / {d.writeIOPS?.toFixed(1) ?? "—"}{" "}
              IOPS
            </span>
          </div>
        ))}
      </details>
    </section>
  );
}
