# 部署核对记录

最近核对日期：2026-11-04（北京时间）。这是人工核对快照，不是自动同步服务。历史基线保留在下方。

## 2026-11-04 PR #5 版本同步优化上线（当前部署）

- [PR #5](https://github.com/Leexxin/sma-center/pull/5) 已合并，生产业务源码为 `4d888f67545c082303fad4fd49c899de107bd1e6`。运行镜像 `sha256:a9831a90b3ce0cf50040c36a31f8107a3a6b6d4b3204bb89ddd00584f7ef55bf`，另标记 `sma-center:4d888f67545c`，容器 running/healthy。
- 按原 `/opt/sma-center/compose.yaml` 和 `compose.override.yaml` 构建并切换，端口 `192.168.33.124:8080`、外部数据卷 `sma-center-data` 和两个 Compose 文件摘要均保持不变。没有调整网关/网络、重置 TOTP、轮换 Token、修改 SSO 客户端或执行 Agent 安装。
- 备份前同步任务为 Windows v0.3.0-rc.1 completed；切换前再次确认没有运行中的任务。完整卷备份 `/root/sma-center-backups/sma-center-20261104-143756.tar.gz`，SHA-256 `ad8645b213456fe2e7aa5f691fc00123770492b74a3ae81fe7109fd1e4c7c739`；源码快照 `/root/sma-center-backups/source-before-pr5-4d888f67545c.tar.gz`，SHA-256 `66ce8b959bdb64bfcad1612731181e3b4e39721e93cec105bfa98c5823f1592c`。归档均检查可读，旧镜像保留为 `sma-center:before-pr5-4d888f67545c`。文件名使用服务器 UTC。
- 上线前后资源 12 条、用户偏好 1 条、用户记录 1 条、Agent 凭据 8 条，四张表的全部行内容摘要一致；8 条凭据均能成功解密。`secrets.json`、`totp-auth.json`、OIDC 签名私钥及客户端表字节摘要一致，TOTP 仍绑定；没有输出真实密钥、Token 或 Cookie。
- 同步状态文件在部署期间因随后执行的 v0.2.9、v0.2.8 只读核对产生正常变化，仅 comparison/job/history 改变；加密分享地址和 Release 列表保留，没有恢复旧状态覆盖新任务。新版服务实际完成 v0.2.9 核对，产生 14 个逐文件字节/耗时记录，全部镜像 SHA-256 通过；其余 6 个合集/摘要文件确实不在镜像目录，见[版本中心缺失附件说明](sma-release-center.md#验证与排障)。核对 completed 表示核对操作结束，不表示附件已全部同步。
- 生产构建与 TypeScript 检查通过。上线时对合并提交的全部 172 个 Git 跟踪文件逐项核对，服务器源码和运行容器均一致；此后部署记录为独立文档提交，不改变上述业务镜像快照。
- `/healthz` 为 200/ok；未认证版本 API 和资源 API 均为 401，版本页面为 303 至登录；SSO Discovery 为原 HTTP IP issuer，JWKS 为单个公钥且无私钥字段。已有浏览器会话可访问新版版本中心，独立任务区域可见。没有代替用户重新登录、绑定验证器或确认 SSO 授权。
- 本地此前 70/70 测试（含三组隔离 Chrome）、lint、生产构建通过；生产实际核对与凭据保留已验收。新版完整 GitHub 下载→正式附件上传→回读的生产页面联动未在本次部署中主动执行；上传兼容性在部署前已用临时状态/随机文件在同一容器环境验证并清理。没有自动补齐历史版本缺失文件，也未做生产断网、覆盖冲突或回滚演练。
- 本次没有数据库迁移或加密格式变更。需回退时使用保留的准确旧镜像及源码快照，沿用相同 Compose 配置和数据卷；先确认没有运行中同步任务，不删除或恢复空数据卷。回退只表示恢复旧同步体验，不能自动撤销用户后续已完成的附件同步。


## 2026-11-04 Software Vault 客户端接入补充

- 复用已上线的 HTTP IP SSO 中心，本次未重新构建、重启中心或更改其 Compose 覆盖文件、TOTP、外部数据卷、主密钥与签名私钥。
- 注册 `software-vault`（Software Vault），入口 `http://192.168.33.81:8096/login`，精确回调 `http://192.168.33.81:8096/auth/callback`。原空客户端表备份为 `/data/oidc-clients.before-software-vault.json`；注册表热加载生效。
- 密钥经 SSH 管道交付到 Vault 的 UID/GID 10001 受限文件；真实后端 Basic 认证内省探针通过后，已删除本次中心的一次性交付密钥。未输出任何密钥、Cookie、授权码或 TOTP。
- Vault 业务镜像为 `software-vault:59b54c0`，容器 healthy；其固定 issuer 为 `http://192.168.33.124:8080`，双方 Secure Cookie=false。真实 Discovery/JWKS、客户端认证、S256 授权跳转、无会话业务拒绝与伪造回调拒绝通过；Vault 原业务记录与加密密钥保留。
- 尚未使用真实 TOTP 完成生产浏览器授权与回调验收，没有替用户确认授权或绕过中心认证；此补充不更改上节中心上线时“空客户端表”的历史快照。

## 2026-11-04 HTTP IP SSO 上线（历史部署）

- 功能提交 `275b791`、HTTP IP 修正 `049016b`，经 [PR #1](https://github.com/Leexxin/sma-center/pull/1) 合并至 main；本次生产业务源码为合并提交 `0bf65bd9b17d3684a53da8050a52ab2716f9525c`。本节为后续部署记录，不改变业务镜像。
- 生产地址仍为 `http://192.168.33.124:8080`，不要求 HTTPS、域名或证书。明确配置的 `SMA_CENTER_SSO_ISSUER` 与此地址相同，`SMA_CENTER_SECURE_COOKIES=false`，客户端表路径 `/data/oidc-clients.json`。
- 原 Compose 配置和端口保留，新增现场文件 `/opt/sma-center/compose.override.yaml`，由普通 `docker compose` 自动加载；运行标签确认同时使用原 compose.yaml 和该覆盖文件。后续升级、备份与回滚需保留现场覆盖配置，不能只核对基础 compose.yaml。没有修改网卡、防火墙、外部卷名或 TOTP 绑定。
- 完整数据备份 `/root/sma-center-backups/sma-center-20261104-082343.tar.gz`，已检查归档可读；源码快照 `/root/sma-center-backups/source-before-sso-20261104-082342.tar.gz`；旧镜像保留为 `sma-center:before-sso-20261104-082342`。文件名使用服务器 UTC，北京时间为 2026-11-04 下午。备份时短暂停止并恢复服务，构建完成后再切换新容器。
- 在服务器成功完成 Docker/Next.js 生产构建；业务镜像另标记为 `sma-center:0bf65bd9b17d`，运行容器镜像标识为 `sha256:0c4a78dc128eb7e31db89770331a0838205ddddcad0479afcbdb3f8354079f9e`，状态 running/healthy。
- `/healthz` 返回 200/ok；`/.well-known/openid-configuration` 返回固定 HTTP IP issuer 和 S256；`/oidc/jwks` 返回一个 RS256 公钥，不含私钥字段。未登录 `/applications` 返回 303 至登录页、`/api/resources` 返回 401，伪造内部身份头仍为 401，伪造 Origin 的写请求返回 403。浏览器实际打开生产入口显示原 TOTP 动态码登录页。
- 升级前后均有 12 条资源、1 条用户偏好、7 条 SMA 凭据，7 条原 Agent 凭据均能成功解密。`secrets.json` 字节摘要保持一致，TOTP 加密种子、ownerId、会话代次与升级前备份一致；没有输出 Token、种子、Cookie 或备份内容，没有重新绑定/重置验证器，也未强制退出已有中心会话。
- 升级前版本同步任务为 completed，未在同步传输中途重启。数据仍来自同一独立外部卷 `sma-center-data`。启用 SSO 时创建空客户端表并由服务首次生成签名密钥，没有覆盖既有主密钥或数据库；验收时注册客户端数为 0，没有自动注册 Software Vault、量化平台或替业务系统轮换凭据。
- 交付后核对已合并版本的全部 170 个 Git 跟踪文件：服务器源码与运行容器均通过 SHA-256 对比。后续文档记录为独立提交，应区别于本次业务镜像所含文档快照。
- 本地 Node 22.22.0 完整测试 62/62 通过、无跳过，含两个不同 HTTP 主机的隔离浏览器登录/退出回归；lint 和本地生产构建通过。仓库未配置 GitHub Actions 工作流，本次没有声称远端 CI 通过。服务器已验证公开 SSO 接口及数据/鉴权保留，但尚未在生产注册实际业务客户端或完成 Software Vault 的真实回调联调；原有 Agent 网络可达性未重新逐台验收。
- 详细接入与注册步骤见 [SSO 手册](sso-integration.md)。回滚到旧业务镜像时，也需还原本次前的 Compose 配置（包括移除本次新增的 SSO 覆盖文件），保留数据卷；不要通过删除密钥或恢复空卷实现回滚。本次没有实际执行回滚或数据恢复演练。

## 2026-10-17 SMA 指标规范对齐（历史部署）

- 功能提交 `dba8952`，真实 Agent 联调修正提交 `54c0831`，均已推送 `Leexxin/sma-center` 的 main。最终生产业务镜像对应 `54c0831`；部署记录为后续文档提交，不改变业务镜像。
- 部署目录仍为 `/opt/sma-center`，通过 Git 归档交付、Docker Compose 构建和切换；没有数据库迁移、网络调整、认证重置或凭据轮换。独立外部卷仍为 `sma-center-data`。
- 最终运行镜像 `sha256:149e4fd900aaf4cc3d5a8f9e2c221bbd7c46b693861c181839e9828e3c5666ef`；容器 healthy，`/healthz` 返回 ok，未认证 `/api/resources` 返回 401。原有浏览器登录会话仍可正常访问页面。
- Agent 程序版本与协议分开展示；旧版通过 `/version` 回退。服务端按需采样、30 秒缓存/并发合并，首次 CPU/I/O 留空，第二轮才计算；系统盘按挂载点匹配，磁盘详情显示每秒吞吐及 IOPS。
- 联调发现 Linux 部分挂载点失败仍返回有效根盘，已修正为保留有效容量并同时提示采集器异常。Windows 推导启动时间有毫秒抖动，已允许非整数启动时间 1 秒内偏差，避免每轮误判重启；实际重启和计数器回退仍重置基线。
- 在最终容器中间隔 31 秒读取两轮真实 Agent：开发服务器 `v0.2.3`、OpenWrt `v0.2.7`、Windows `v0.3.1-rc.1` 首轮 CPU 均为 null，第二轮约为 0.33%、1.17%、16.21%；系统盘约为 75.72%、0.33%、14.25%。已验证读写吞吐、IOPS 的有效差分及真实零值，Linux filesystem 部分错误不再隐藏有效系统盘。
- Chrome 实际页面验证了 Linux/Windows 卡片、第二轮 CPU、系统盘、负载非百分比展示，以及 Windows 悬浮详情中的 Agent 版本、协议、平台、容量、吞吐、IOPS 和不支持字段。未执行手机布局和全套明暗主题回归，也没有在生产重新绑定验证器或修改用户设置。
- 采样时文件服务器、数据库服务器和 sma-center 对应的已配置 Agent 地址均返回 ECONNREFUSED，`/healthz` 和 `/version` 也不可达；其中后两者在部署前已报连接错误，文件服务器在本次联调早期曾可读、随后连接被拒绝。面板按不可达展示，不以虚构零值代替。本次没有修改这些 Agent 的安装、监听或防火墙配置，恢复 Agent 连通性属于后续排障。
- 前后均保留 8 条资源、1 条用户偏好、7 条 SMA 凭据；TOTP 仍绑定，版本同步任务状态仍为 completed，发布前没有运行中的同步任务。未读取或输出实际 Token、验证器种子和会话 Cookie。
- 本地全套测试 52 项通过、1 项按现有条件跳过，新增 9 组指标回归均通过；Lint、本地及服务器生产构建通过。
- 完整数据备份 `/root/sma-center-backups/sma-center-20261017-064245.tar.gz`（已检查归档可读），源码快照 `/root/sma-center-backups/source-before-metrics-20261017-064247.tar.gz`；回滚镜像 `sma-center:before-metrics-20261017-064247`。文件名使用服务器 UTC。两轮发布共用本次升级前完整备份，未删除旧镜像或旧备份。
- 指标口径和当前限制见 [SMA 指标说明](sma-metrics.md)。长期历史、独立 Worker、PostgreSQL/Redis 队列等架构规划尚未在本次部署实施。

## 2026-10-16 发起的版本目录改造（历史部署）

- 功能提交 `843168ae350b8ba5fa871420d5cbdc2ee7bd2b89`；后续半文件恢复回归测试提交 `9bf5502`，均已推送 GitHub。业务镜像以功能提交构建，后续测试/部署文档提交不改变业务代码。
- 新容器已上线且 healthy，实际运行镜像 `sha256:393b761b10b434534003dbe398336c6cec057954d53bb83b3ea08a1123d8a775`；访问入口仍为 `/sma/releases`，未登录 API 返回 401。
- 布局升级为 `version-folders-v1`：按 GitHub 标签在分享根目录建立 `/<tag>/`，核对和上传只操作对应版本目录，不写共享根目录，不跨版本覆盖。旧根目录核对结果已失效，旧任务标注为历史根目录记录。
- 用户提供的分享根目录在本次开始时确认为空。已实际从 GitHub 同步最新稳定版到 `v0.2.4/`：18/18 附件 SHA-256 全部一致。最终根目录仅有 v0.2.4 文件夹，根目录普通文件数为 0，版本目录文件数为 18。
- 其他 Release 保留可选择同步能力，本次没有自动填满所有历史版本，也没有建立跨版本 latest 别名。
- 修复空分享目录 upload → browse 的同分享跳转；取上传令牌时保留 Cookie，拒绝其他主机/分享及登录页跳转。
- 真实慢链路触发旧 60 秒限制，导致本次新建目录中安装包合集残留 12,764,223 字节半文件，完整发布大小为 22,902,709 字节。已核对其文件名、生成时间和大小，确认是本次上传产生；先备份到 `/data/release-sync-partial-backup-1792165941843.bin`（0600），再仅允许替换这一半文件，未覆盖其他冲突项。恢复后的完整附件已通过 GitHub 摘要和回读验证。
- 二进制传输超时调整为 10 分钟，元数据仍为 60 秒；已一致的 9 个附件在继续同步时跳过，只补齐剩余 9 个。失败及重试过程保留在任务历史中，没有伪装为一次无错误发布。
- 安装命令按版本直链与 GitHub 摘要生成。实际检查了 6 个 Linux 原生安装包命令，路径均为 `%2Fv0.2.4%2F…`，shell 语法全部有效；未执行安装。上游根目录自动安装/默认 upgrade 命令不适配新布局，页面已隐藏并提示改用原生包安装或升级。
- 本地 lint、生产构建通过，含真实 Chrome 原生认证回归的 44 项测试全部通过；隔离浏览器复验版本路径、覆盖确认、命令复制、明暗及手机布局，未发现运行异常。
- 升级前后均为 6 条资源、5 条 SMA 凭据，TOTP 已绑定。没有数据库迁移、凭据轮换或认证重置。
- 升级前数据备份 `/root/sma-center-backups/sma-center-20261016-154746.tar.gz`，源码备份 `/root/sma-center-backups/source-before-version-folders-20261016-154748.tar.gz`；回滚镜像 `sma-center:before-version-folders-20261016-154748`。这些文件名采用服务器 UTC，区别于北京时间。
- 回滚旧业务镜像会恢复旧根目录同步逻辑，回滚后不要使用旧同步按钮；已建立的版本目录不会被自动删除。重新上线版本目录模式后应重新核对。
- 同步传输在切换新容器前结束，未在任务中途重启；上线后读取持久化状态仍为 completed、目标 /v0.2.4、18/18 一致。全部 Git 跟踪源码及最新文档已与服务器交付文件逐项核对。

## 2026-10-16：SMA 版本中心上线

- 功能提交：`460f57e5dabfcf281d7a6b07791cfdaa39e1c887`，已推送 `Leexxin/sma-center` 的 main。
- 生产服务器已从交付源码重新构建 Docker 镜像并切换容器，状态 healthy；运行镜像标识 `sha256:aa827fafdf4db974097832997ee369044e5a80505ec8de86cdbd325b6b5894a8`。
- 页面入口：`http://192.168.33.124:8080/sma/releases`，工作台侧栏已加入“SMA 版本中心”。页面及 API 均存在于生产编译路由清单。
- 已加密保存用户指定的 SFTPGo 分享配置；状态文件权限 600，不在本记录中公开分享标识。
- 从新镜像实际读取 GitHub Release 和内网镜像，`v0.2.3` 的 18 个附件全部 SHA-256 一致；另外读取到 v0.2.2、Windows v0.3.0-rc.1、v0.2.0 发布条目。此为核对时的结果，不代表持续同步。
- 在服务器实际下载 `install-sma.sh` 并验证 GitHub SHA-256 成功；没有执行该脚本，没有上传或替换文件服务器上的文件。上传路径、失败中断和覆盖确认在隔离模拟服务中测试，未对生产镜像执行破坏性写入演练。
- 已确认同标签 Linux 安装文档和生命周期文档可读取；命令页按选择的标签和平台读取原文，不执行命令。
- 升级前后资源数均为 6，SMA 凭据数均为 5，TOTP 仍已绑定；没有数据库迁移或认证重置。
- 生产 `/healthz` 返回 ok，未登录访问新页面返回 303、新 API 返回 401。
- 本地 `npm run lint`、`npm run build` 通过；含真实 Chrome 原生表单回归的完整测试 33 项全部通过。隔离浏览器验证了新页面、明暗模式、手机无横向溢出、冲突确认、同标签命令、HTTP 复制降级、侧栏入口和身份/跨站拦截，未出现浏览器运行异常。
- 完整备份：`/root/sma-center-backups/sma-center-20261016-053221.tar.gz`；源码备份：`/root/sma-center-backups/source-before-release-center-20261016-053222.tar.gz`（文件名时间为服务器 UTC）。
- 回滚镜像：`sma-center:before-release-center-20261016-053222`。新功能状态单独保存在数据卷 release-sync.json，后续整卷备份将包含该文件。
- 交付后全部 Git 跟踪源码通过本地与服务器 SHA-256 核对。部署记录是后续文档提交，不改变上述运行中的业务镜像。

功能边界、冲突覆盖及非原子发布风险见 [SMA 版本中心说明](sma-release-center.md)。

## 2026-10-15 文档整理前的基线

- 本地：`/Users/lixin/dev/projects/MyProjects/sma-center`，分支 `main`，工作区干净。
- GitHub：`Leexxin/sma-center`，已执行 fetch；本地 HEAD 与 origin/main 均为 `4f22a1b5ed94162f8c580717d85c38d1e2965a31`。
- 服务器：`root@192.168.33.124`，源码 `/opt/sma-center`，不含 `.git`；不是可以直接 git pull 的工作副本。
- 对所有 Git 跟踪文件逐一进行 SHA-256 校验：服务器缺少 `tests/request-origin.test.mjs`，其余文件一致。本次交付补齐该测试文件，并同步新增文档及入口文件。
- 运行容器 `sma-center` 状态 healthy；容器内 `deploy/server.mjs` 与 `deploy/request-origin.mjs` 和本地 SHA-256 一致。
- 当前镜像未记录可独立校验的 OCI Git revision 标签，不能仅根据 `sma-center:latest` 推断完整镜像对应哪个提交。
- 本次交付后再次对 Git 跟踪文件及新增文档做 SHA-256 校验，确认本地与服务器源码一致；文档链接、代码块及差异空白检查通过。
- 本次为文档及源码补齐，不修改业务逻辑、不重建镜像、不重启服务、不重置现有验证器。

最终文档提交号由 Git 历史记录查询；不要为在文档中写入“本提交的提交号”而形成递归修改。

## 环境摘要

| 项目 | 实际配置 |
| --- | --- |
| 主机 | sma-center，Ubuntu 26.04 LTS，amd64 |
| 网络 | ens18，192.168.33.124/24，网关/DNS 192.168.33.1 |
| 网络配置 | /etc/netplan/00-installer-config.yaml，cloud-init 网络接管已禁用 |
| 容器端口 | 192.168.33.124:8080 → 3000 |
| Compose 项目/服务/容器 | sma-center |
| 数据卷 | sma-center-data，external |
| 备份目录 | /root/sma-center-backups/ |
| 认证 | 已完成单用户 TOTP 绑定；无账号密码登录 |
| 时钟 | 服务器使用 UTC，NTP 同步；手册展示日期按北京时间理解 |

尚未配置：自动异地备份、备份保留清理、持续同步监控、完整 HTTPS 代理支持。镜像加速由服务器管理员配置，具体地址不固化为通用安装默认值。
