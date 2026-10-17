# SMA 指标口径

本实现对齐 SMA 项目的 `docs/sma-center-version-metrics.md`（2026-10-17），适用于 JSON 协议 `v1`。Token 仅在后端解密并用于快照请求，不发送给浏览器。采集结果是当前快照，不是 Agent 推送的实时流。

## 版本与采集

- 优先显示快照顶层 `agentVersion`，缺失或无效时请求公开的 `/version.version`；失败显示“未知”。`schemaVersion` 单独标为协议版本，不能充当 Agent 版本。
- `/v1/snapshot` 由服务端按需采集，页面每 30 秒请求一次。相同用户、Agent 地址的并发请求合并；成功与失败均缓存 30 秒，避免高频重试。修改 Token 后重新采样；不跟随重定向。
- 快照最多 1 MB、超时 5 秒；版本响应最多 16 KiB、超时 3 秒。快照校验类型、协议和时间，数值必须有限、非负，且不超出 JS 安全整数范围。白名单字段返回前端，不透传上游错误正文。
- 保存 Agent `timestamp` 和本地 `receivedAt`；差分使用前者。基线仅在当前服务进程内保存，最多缓存 500 个 Agent；90 秒未采集、进程重启、断连、来源/版本/启动时间改变时重新建立基线。
- 当前不是独立后台采集服务：关闭所有页面后不持续采集，不持久保存指标历史，不进行 readiness 健康判定。`/healthz` 只表示存活，`/readyz` 才表示核心采集就绪，均可从后端环境单独排障；不以 HTTP 200 代表所有采集器成功。

## 卡片与详情

| 展示 | 口径 |
| --- | --- |
| CPU | 两次有效采样中所有相同 CPU/mode 的差分：`100 × (1 - Δidle / Δtotal)`；iowait 算非 idle；支持 Windows `total` 键，不乘核心数 |
| 内存 | `100 × (1 - availableBytes / totalBytes)`，总量必须大于 0 |
| 系统盘 | 精确匹配 `host.systemMountpoint`（旧版缺失时 `/`），计算 `100 × (1 - availableBytes / sizeBytes)`；不用 freeBytes，不回退到首个挂载点 |
| 负载 | 1 分钟原始负载值，不是百分比，不使用百分比进度条；详情含 1/5/15 分钟 |
| 文件系统详情 | 每个挂载点分别列出可用/总容量，不合计可能重复挂载的容量；空数组显示“无数据” |
| 磁盘 I/O 详情 | 同设备累计 readBytes/writtenBytes/readsCompleted/writesCompleted 差分除以快照时间差，显示吞吐每秒和读写 IOPS；ioInProgress 直接显示当前值，不合计设备与分区 |

所有百分比夹在 0～100。容量使用 B/KiB/MiB/GiB/TiB，真实零容量显示 `0 B`。首次 CPU/I/O、重复或倒退时间、计数器下降、CPU 核数/键/mode 改变均显示“—”并建立新基线。设备消失后重新出现也需要两次采样。

`errors[].collector` 对应的指标视为异常，不展示可能残留的旧数值，详情显示采集器与错误码；其他采集器数据继续使用。Windows 的 load 不支持；`host.unsupportedMetrics` 中标记的占位数值剔除并列出不支持字段，不按 0 解读。没有温度字段，不虚构温度。

## 验证与边界

自动回归覆盖版本回退、Linux/Windows 根盘、首次采样、CPU 键/mode/核心数变化、时间倒退、升级、重启、计数器回退、空值、部分失败、超安全整数、并发请求、缓存与 Token 更换。运行 `npm test`、`npm run lint`、`npm run build`。

2026-10-17 本地验证：全套测试 50 项通过、1 项按现有条件跳过；Lint 与生产构建通过。新增 7 组指标回归均通过。未执行浏览器视觉回归、真实 Linux/Windows Agent 联调、Git 推送或生产部署。

本次对齐不涉及认证、数据库迁移、生产部署或持久指标历史；接入真实 Linux/Windows Agent 后仍须核对两轮采样及实际平台支持字段。服务端多副本共享基线、长期历史和独立 Worker 属于后续架构改造范围。
