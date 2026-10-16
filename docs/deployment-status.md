# 部署核对记录

最近核对日期：2026-10-16（北京时间）。这是人工核对快照，不是自动同步服务。历史基线保留在下方。

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
