# 部署核对记录

核对日期：2026-10-15（北京时间）。这是人工核对快照，不是自动同步服务。

## 本次文档整理前的基线

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
