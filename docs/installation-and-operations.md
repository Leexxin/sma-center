# sma-center 全流程安装与运维手册

适用版本：2026-10-15 的单用户 TOTP 自托管实现。变更时按[维护约定](maintenance.md)同步更新；当前部署快照见[部署核对记录](deployment-status.md)。

## 1. 项目是什么

sma-center 是个人工具、站点与服务器导航工作台，支持收藏置顶、分类、菜单布局、明暗主题、主页设置，以及 SMA 服务器指标和服务自动发现。它不是纯前端：浏览器界面由 Next.js/React 提供，Node.js 网关负责认证，服务端使用 SQLite 保存资源和设置，并代理 SMA 请求。

当前只有一个使用者，强制绑定 TOTP 验证器；不再提供账号密码、注册、多租户或第三方登录。数据库中的用户字段仅用于兼容历史存储，不代表可登录账号。

请求路径：浏览器 → 主机 8080 端口 → 容器 3000 端口的认证网关 → 页面/API → SQLite 或 SMA 服务。SMA Token 在服务端加密保存，不应交付给浏览器。

## 2. 当前环境与重要路径

| 用途 | 路径或配置 |
| --- | --- |
| GitHub 源码 | https://github.com/Leexxin/sma-center |
| 本地仓库 | /Users/lixin/dev/projects/MyProjects/sma-center |
| 生产服务器 | root@192.168.33.124，主机名 sma-center |
| 生产源码 | /opt/sma-center（当前通过源码交付，不含 .git） |
| 访问入口 | http://192.168.33.124:8080 |
| Compose 定义 | /opt/sma-center/compose.yaml |
| 服务/容器/镜像 | sma-center / sma-center / sma-center:latest |
| 生产数据 | Docker 外部卷 sma-center-data，挂载容器 /data |
| 完整备份 | /root/sma-center-backups/ |
| 本地开发数据 | 项目内 .sma-center-data/（Git 忽略） |

旧路径 `/Users/lixin/dev/projects/工具开发`、旧项目名 atlas-personal-hub、旧登录入口均不是当前安装方式。不要以浏览器历史地址或旧目录判断当前部署。

## 3. 安装前准备

- 本地开发：Node.js 22.13 或以上兼容版本，建议使用项目已验证的 Node 22；npm 和 Git。
- Docker 部署：Linux、Docker Engine、Compose v2、Buildx；主机可拉取 Node 基础镜像并访问 npm。
- 配置准确的服务器和手机时间。TOTP 依赖时间同步。
- 当前主机约 1.6 GiB RAM，配置 2 GiB swap；构建可能持续数分钟，需预留源码、依赖、镜像及备份空间。不是对所有环境的最低资源保证。
- 仅将服务开放给可信内网/VPN。目前入口为 HTTP，不能视为适合直接暴露公网的安全部署。

先检查，不要重复覆盖已有网络和 Docker 配置：

```sh
hostnamectl
ip -br address
ip route
timedatectl status
free -h
swapon --show
df -h
docker version
docker compose version
docker buildx version
systemctl is-enabled docker
```

### 3.1 新服务器的主机名和静态 IP

当前生产主机已经配置完成，无需再次执行。新主机可用 `hostnamectl set-hostname sma-center` 永久设置主机名；检查 `/etc/hosts` 本机名映射，以及 cloud-init 是否会在下次启动恢复旧名。

静态网络应按实际网卡、网段、网关、DNS 和 MAC 制定 Netplan 配置，不能直接复制生产网卡名。修改前保存 `/etc/netplan` 到独立备份目录，具备控制台访问能力；先 `netplan generate`，再 `netplan try` 确认连通后生效。远程改 IP 可能中断 SSH，必须从新地址重新连接验证；避免两台设备占用同一 IP。当前原始配置备份在 `/root/sma-center-backup/`。

### 3.2 新服务器安装 Docker

以下包名适用于当前 Ubuntu 26.04 环境；其他发行版/版本先确认仓库包名，不要混装已有 Docker 官方包和发行版包：

```sh
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 docker-buildx git ca-certificates
sudo systemctl enable --now docker
sudo docker info
sudo docker compose version
sudo docker buildx version
```

当前运维命令以 root 执行。其他用户可使用 sudo；加入 docker 组相当于授予接近 root 的权限。镜像加速由管理员按网络情况配置；先备份并审查 `/etc/docker/daemon.json`，不要用示例覆盖现有配置。重启 Docker 会影响其他业务，需维护窗口。拉取失败分别检查 DNS、代理、镜像仓库和 npm 连接，不能因为已配置镜像加速就认为 npm 同样可用。

## 4. 本地开发和生产模式运行

```sh
cd /Users/lixin/dev/projects/MyProjects/sma-center
# 使用 nvm 时先执行 nvm use 22；确保 node 实际不是系统旧版本。
node --version
npm ci
npm run dev
```

默认访问 http://localhost:3000 。新开发环境读取授权码：

```sh
cd /Users/lixin/dev/projects/MyProjects/sma-center
cat .sma-center-data/setup-code.txt
```

按第 6 节完成绑定。开发环境与生产环境数据独立，不要为方便测试拷贝生产密钥。首次绑定后授权码文件被删除，这是正常行为。

生产模式本地验证：先停止 dev，再执行以下命令，避免争用端口和构建目录：

```sh
npm run build
npm start
```

需要改端口可用 `PORT=5173 npm run dev`；当前默认不是历史 Vite 的 5173。`npm start` 前必须有成功的生产构建。开发/构建启动脚本会设置自托管所需配置；不要绕开脚本直接以旧 Node 或旧认证方式启动。

## 5. 首次 Docker 部署

以下步骤用于**新安装**。已有 `/opt/sma-center` 的生产主机走第 9 节升级，不要覆盖目录或重新绑定。

```sh
# 以 root 执行；目标目录应尚不存在。
git clone https://github.com/Leexxin/sma-center.git /opt/sma-center
cd /opt/sma-center
git rev-parse HEAD
```

先编辑 `compose.yaml` 的端口：仓库当前绑定 `192.168.33.124:8080:3000`，换服务器必须改为该机实际 IP；只供本机代理可绑定 127.0.0.1，但 HTTPS 另有第 12 节限制。不要无意改为对全部网卡开放。

```sh
cd /opt/sma-center
docker volume create sma-center-data
docker compose config
docker compose build sma-center
docker compose up -d
docker compose ps
docker compose logs --tail=100 sma-center
curl -fsS http://192.168.33.124:8080/healthz
```

最后一条返回 `ok`。新机器使用其实际地址。外部卷必须先创建，`external: true` 表示 Compose 不代为创建。不要执行 `docker volume rm sma-center-data` 或清卷命令解决启动问题。

容器以 node 用户运行，镜像内端口为 3000。健康检查在容器内访问 `127.0.0.1:3000/healthz`；主机端口只绑定指定 LAN IP，因此主机上 `127.0.0.1:8080` 不通不一定是故障。

## 6. 首次绑定、登录和会话

1. 浏览器打开站点，未绑定时进入 `/setup`。
2. 运维人员在服务器读取一次性授权码，私下交给站点使用者：

   ```sh
   cd /opt/sma-center
   docker compose exec -T sma-center cat /data/setup-code.txt
   ```

3. 在页面输入授权码，进入二维码页面。在同一个浏览器中于 10 分钟内完成操作；过期重新授权。
4. 用支持 TOTP 的验证器扫描二维码，或手动输入页面密钥。配置为 6 位、30 秒、SHA1。
5. 输入验证器动态码确认绑定，完成后才可访问面板。只扫描二维码不算完成绑定。

二维码由本机生成，不发送外部二维码服务。授权码只能启动绑定流程，不能代替动态码；确认后授权码文件删除。禁止将真实授权码、二维码或密钥写入 Git、文档、日志或公开截图。

绑定后访问 `/login`，只输入动态码，无用户名和密码。动态码不可重放，已使用的码应等待下一轮再试；允许小范围时钟偏差但不替代 NTP。认证连续失败 10 次后会暂时锁定 10 分钟，不要持续重试。

侧栏“安全设置”对应 `/security`：默认有效期 12 小时，可设 5 分钟至 30 天；这是会话绝对有效期，不是随每次点击自动续期。保存设置会刷新当前会话；缩短有效期同时约束旧会话，延长不会自动延长其他旧会话。“退出登录”会撤销所有已登录设备，不只是当前浏览器。

旧账号密码、旧 Cookie、伪造身份请求头均不能登录；旧 URL 兼容跳转不意味着恢复旧认证方式。

## 7. 面板与 SMA 日常配置

- 添加工具、站点和服务器资源，填写名称、地址、分类等实际字段；资源可点亮星标收藏并在顶部展示。
- 子页直接显示对应资源集合，可用分类快速筛选；主页、主题、菜单收缩/排序等状态通过页面设置维护。
- 在服务器资源中配置 SMA 服务地址及其 Bearer Token。主机地址和 SMA API 地址是不同概念，按 SMA 实际监听端口填写；不得把面板的 8080 当成所有 SMA 的端口。
- 连通后卡片显示主要指标，如 CPU 使用率、温度、内存和磁盘使用率，详细信息在卡片详情中查看。指标缺失可能是 SMA 未提供或采集不支持，不应把缺失值当作 0。
- 配置并成功连接 SMA 的服务器可进入详情页，使用服务发现能力。能力列表、发现执行与结果由 SMA API 决定；无权限、版本不支持或 Agent 不在线应先排查 SMA，而非重置面板认证。

由服务器/容器访问 SMA，不要求浏览器直接请求 Agent。检查容器到目标地址的路由、端口、防火墙和 Token 权限。容器中的 localhost 是容器自身，不是宿主机或其他服务器。不要关闭凭据保护来绕过连通问题。

## 8. 数据与配置

| 配置 | 作用 |
| --- | --- |
| SMA_CENTER_DATA_DIR | 数据目录；Docker 为 /data，本地默认 .sma-center-data |
| PORT | Node 监听端口，默认 3000；主机外部端口由 Compose 映射 |
| NODE_ENV | production 或 development，开发脚本自动设置 |
| SMA_CENTER_SELF_HOSTED | 自托管模式，由开发/构建脚本和镜像设置 |
| SMA_CENTER_SECURE_COOKIES | true 时 Cookie 增加 Secure；HTTP 下不要启用，HTTPS 限制见第 12 节 |
| NEXT_TELEMETRY_DISABLED | 镜像和脚本关闭 Next 遥测 |
| NODE_OPTIONS | 镜像构建限制 Node 堆为 1536 MiB，不等于容器总内存上限 |

SMA_CREDENTIAL_KEY 由网关从 secrets.json 注入，不能随意设置一个新值替换已有密钥。历史账号或第三方认证变量不再作为当前登录配置。

数据卷包含：

- `sma-center.sqlite`：资源、偏好设置、加密 SMA 凭据等；WAL 模式还可能有 `-wal`、`-shm` 文件。
- `secrets.json`：会话签名和凭据加密所需密钥，必须和数据一起备份。
- `totp-auth.json`：加密 TOTP 种子、会话代次、登录时长及认证状态。
- `setup-code.txt`：仅未绑定或重置后存在的一次性绑定授权码。

SQLite 启动时自动应用 `drizzle/` 中迁移；旧 atlas 数据文件/迁移记录有兼容迁移逻辑。历史内部存储标识和加密上下文不可随意改名。不要手工删用户字段、迁移记录或单独替换密钥。迁移不是自动可逆的，升级前必须备份。

## 9. 版本核对与升级

### 9.1 先确认 Git 状态

在本地仓库执行：

```sh
git status --short --branch
git remote -v
git fetch origin main
git rev-parse HEAD origin/main
git rev-list --left-right --count HEAD...origin/main
git log -5 --oneline
```

计数为 `0 0` 且工作区干净才表示本地已提交代码与远程一致；这不能证明服务器已部署。存在未提交修改应先审查；分叉时审查差异，不使用强推或硬重置覆盖。

### 9.2 当前服务器的源码交付方式

生产 `/opt/sma-center` 当前没有 `.git`。推荐从已提交版本生成归档，将代码交付与生产数据分离。以下本地命令创建临时交付包：

```sh
cd /Users/lixin/dev/projects/MyProjects/sma-center
git status --short
# 确认工作区干净且所需提交已推送后继续。
release_id=$(git rev-parse --short=12 HEAD)
release_dir=$(mktemp -d /tmp/sma-center-release.XXXXXX)
git archive --format=tar.gz --output="$release_dir/sma-center-$release_id.tar.gz" HEAD
scp "$release_dir/sma-center-$release_id.tar.gz" root@192.168.33.124:/root/
```

该包只包含 Git 已跟踪文件，不包含生产数据。首次交付到新机器时单独核对主机密钥；已有设备若旧 IP 的 known_hosts 记录导致提示，核对指纹后处理，不能关闭主机密钥验证。

以下在生产服务器 root 下执行；将归档名占位值换为本次真实提交号：

```sh
cd /opt/sma-center
sh deploy/backup.sh
release_stamp=$(date +%Y%m%d-%H%M%S)
docker image tag sma-center:latest "sma-center:rollback-$release_stamp"
tar -czf "/root/sma-center-backups/source-$release_stamp.tar.gz" \
  --exclude='./.git' --exclude='./node_modules' --exclude='./.next' \
  --exclude='./.sma-center-data' .
chmod 600 "/root/sma-center-backups/source-$release_stamp.tar.gz"
# 先检查可信归档文件列表，不能含绝对路径或 ../ 越界路径。
tar -tzf /root/sma-center-REPLACE_WITH_COMMIT.tar.gz
tar -xzf /root/sma-center-REPLACE_WITH_COMMIT.tar.gz -C /opt/sma-center
docker compose config
docker compose build sma-center
docker compose up -d
docker compose ps
docker compose logs --tail=100 sma-center
curl -fsS http://192.168.33.124:8080/healthz
```

归档覆盖不会删除新版本已移除的旧文件。发布前审查 `git diff --name-status 旧版本..新版本`，对删除/重命名文件逐项处理；不能用目录级清空或无保护 rsync --delete 处理生产目录。若更新包含配置路径、Compose 卷名或端口变化，先按现场配置调整；不能把恢复覆盖配置丢掉。

构建失败时旧容器通常仍运行，先检查日志，不反复清卷。构建成功并启动后还要浏览器验证登录、原数据、收藏、设置和 SMA。保存本次提交号、旧镜像标签及完整备份路径。

新安装如果采用 git clone，且 `/opt/sma-center/.git` 确实存在，可在备份并核对工作区后使用 `git fetch`、审查差异、`git pull --ff-only origin main` 代替归档覆盖，再执行构建启动。不要对当前无 .git 的生产目录直接执行 git pull。

### 9.3 回滚

只回滚代码不一定能回滚数据库。先判断是否运行了不兼容迁移或改变认证/加密格式；若有，必须恢复该版本兼容的完整数据备份，按第 11 节操作，且会丢失备份之后的修改。

已确认数据向后兼容时，在维护窗口将第 9.2 节保留的**准确旧镜像标签**重新标为 `sma-center:latest`，恢复对应源码/Compose 配置，再 `docker compose up -d`，不要附带 --build 覆盖旧镜像。检查健康和业务。保留失败现场供排查，不盲目退回已废弃的密码认证版本。

## 10. 备份策略

### 10.1 页面 JSON 备份

适合迁移或恢复导航资源和页面设置，不是整站灾难恢复：不包含 TOTP、会话签名密钥或 SMA 服务端凭据。通过面板执行导入导出，导入前先备份并确认界面提示的覆盖行为。历史 atlas JSON 格式有兼容支持，但不要据此恢复旧认证。

合并模式按记录标识更新/插入；替换模式会先删除现有资源、设置、用户元数据和 SMA 凭据，再导入 JSON。由于 JSON 不含 Token，替换后必须重新配置 SMA 凭据。JSON 中可能含历史用户元数据，但不会恢复这些用户的登录能力。导入失败不能假定已自动完整回滚，重要恢复优先使用完整卷备份。

### 10.2 完整数据卷备份

在当前生产主机执行：

```sh
cd /opt/sma-center
sh deploy/backup.sh
ls -lh /root/sma-center-backups/
```

脚本要求 root、当前服务容器存在、Linux 本机 Docker 数据卷；它从容器实际 `/data` 挂载点确定卷路径，短暂停止服务后打包整个卷，再通过退出 trap 启动服务。文件权限 600，包含认证与加密密钥，必须按机密资料保管。

检查命令退出码及输出的备份文件，再用 `tar -tzf /root/sma-center-backups/实际文件名.tar.gz` 检查可读性，并记录 SHA-256。服务器时区当前 UTC，文件名时间与北京时间差 8 小时。

要求整卷一致备份，不要在线只复制 SQLite 主文件，不要只备份数据库而遗漏密钥。目前没有自动定时、异地复制或保留清理；应按可接受的数据损失窗口制定频率，并在每次升级前执行。离机备份需加密传输/存储，定期在隔离环境做恢复演练；备份成功不等于已验证可恢复。不要将完整备份放在 GitHub 仓库。

## 11. 完整恢复与验证器恢复

### 11.1 完整恢复：新卷恢复，保留旧卷

仅在明确需要恢复时执行。先通知停机、备份当前状态，选定可信备份与兼容镜像；先在隔离环境演练。以下固定示例新卷名不得已被使用，使用前确认并改成自己的恢复批次。

```sh
cd /opt/sma-center
sh deploy/backup.sh
docker compose stop sma-center
docker volume inspect sma-center-data
# 确认以下新卷不存在；若已存在，不要复用或清空。
docker volume create sma-center-data-restored-20261015
```

将所选备份复制为独立恢复工作目录中的 `data.tar.gz`（不要覆盖原备份），以下示例约定目录为 `/root/sma-center-restore-20261015`。检查归档只含相对路径、无越界路径，不使用未知来源归档。然后提取到新卷：

```sh
docker run --rm --user 0 --entrypoint sh \
  -v sma-center-data-restored-20261015:/restore \
  -v /root/sma-center-restore-20261015:/backup:ro \
  sma-center:latest \
  -c 'tar -tzf /backup/data.tar.gz && tar --numeric-owner -xzpf /backup/data.tar.gz -C /restore'
```

该命令以 root 保留归档 UID/GID 和权限；官方镜像使用 node 用户 UID 1000。自定义镜像先确认 UID，避免所有文件改成 root 后应用无法读写。不要对整个数据目录 chmod 777。

在恢复工作目录创建 `restore.override.yaml`：

```yaml
volumes:
  data:
    name: sma-center-data-restored-20261015
    external: true
```

再使用**同一组配置**验证并启动：

```sh
cd /opt/sma-center
docker compose -f compose.yaml -f /root/sma-center-restore-20261015/restore.override.yaml config
docker compose -f compose.yaml -f /root/sma-center-restore-20261015/restore.override.yaml up -d
docker inspect sma-center --format '{{json .Mounts}}'
curl -fsS http://192.168.33.124:8080/healthz
```

确认实际挂载新卷，再验证原 TOTP、导航、设置和 SMA 解密。旧卷保留用于回退，不删除。将覆盖文件路径写入现场运维记录，**以后所有 up/build 等重建操作必须继续带上该覆盖文件**，否则会挂回旧卷造成“数据丢失”的假象。恢复验收后再决定是否将新卷名纳入正式部署配置，并更新文档。

恢复可能恢复旧的会话代次和认证状态；涉及安全事件时不能仅恢复旧备份，需评估撤销会话并重新绑定。若备份未绑定，按第 6 节操作。绝不能单独恢复 secrets.json 或将不同时间的密钥与认证文件拼接。

### 11.2 丢失验证器：管理员离线重置绑定

只有服务器管理员可执行；这不是网络登录后门。先完整备份，再停止主进程，防止它继续使用内存中的旧认证状态：

```sh
cd /opt/sma-center
sh deploy/backup.sh
docker compose stop sma-center
docker compose run --rm --no-deps sma-center node deploy/server.mjs reset-2fa
docker compose up -d
docker compose exec -T sma-center cat /data/setup-code.txt
```

若采用恢复覆盖文件，上述所有 Compose 命令都要加同样的 -f 参数。重置撤销旧会话、取消旧绑定并生成新授权码；原资源、设置和 SMA 凭据保留。重新完成绑定前不能访问面板。不要手工把 bound 改为 true，不要删除 secrets.json。

## 12. 网络、代理与安全边界

当前网关按 `http://` 加请求 Host（包含端口）计算可信来源，并严格校验写请求 Origin；拒绝空、null 和跨域来源。Referrer-Policy 必须保留 same-origin，以便原生表单提供正确来源。

**当前不能仅在前面加 HTTPS 代理并开启 Secure Cookie 就认为部署完成。** 浏览器发送 https Origin 时，现有网关仍计算 http Origin，会导致写请求 403。启用 HTTPS 前需实现并测试可信外部来源/代理协议配置，限制可信代理、保留正确 Host，且不能信任客户端任意伪造的转发头。本手册不提供声称已验证的 HTTPS 代理配置。

现阶段仅在可信内网/VPN 使用 HTTP，限制防火墙入口，控制服务器 SSH 权限。HTTP Cookie 无传输加密，TOTP 不能防止同网段监听盗取会话。不要公开 /data、备份目录或 Docker socket；未认证 /healthz 只返回存活状态，不代表可绕过登录。

## 13. 日常巡检与排障

```sh
cd /opt/sma-center
docker compose ps
docker compose logs --tail=100 sma-center
docker inspect sma-center --format '{{json .State.Health}}'
curl -fsS http://192.168.33.124:8080/healthz
df -h
free -h
timedatectl status
ls -lh /root/sma-center-backups/
```

Compose 日志已设置 json-file 轮转，单文件 10 MiB、最多 3 个；这不等于备份保留策略。不要把包含敏感信息的诊断输出直接公开。

| 现象 | 排查与处理 |
| --- | --- |
| 输入授权码直接 Forbidden/403 | 重新打开 /setup，不要刷新 POST 错误页；确认实际运行版本含 request-origin 修复、Referrer-Policy 为 same-origin、Origin 和 Host/端口一致；HTTPS 见第 12 节。不能允许 Origin:null 来绕过 |
| 授权码文件不存在 | 已完成绑定时正常；访问 /login。确认没有挂错卷。只有丢失令牌时才按流程离线重置 |
| 动态码无效 | 检查手机与服务器 NTP、是否用错绑定、是否已用过该轮码；等下一轮。连续失败锁定后等 10 分钟，不暴力重试 |
| 登录后又回登录页 | 检查会话到期、是否其他设备退出导致全局撤销、HTTP 下是否误启用 Secure Cookie、浏览器是否拒绝 Cookie |
| 健康但浏览器无数据 | healthy 只检查 /healthz；检查登录状态、API 错误和实际数据卷，勿创建空卷替代旧卷 |
| 宿主机 localhost:8080 不通 | 当前端口只绑定 192.168.33.124，用 LAN IP；容器内才使用 127.0.0.1:3000 |
| SQLite/SMA 解密失败 | 检查 /data 写权限、磁盘容量、secrets.json 与数据库是否同套，切勿生成新密钥“修复” |
| Docker 构建失败 | 检查镜像/npm 网络、磁盘、RAM/swap、日志；当前低内存主机构建耗时较长，不清卷重试 |
| 本地 node:sqlite/Next 报错 | node --version，实际应使用 Node 22.13+；系统旧 Node 16 不支持 |
| SMA 无指标/发现能力 | 检查 Agent 在线、API 地址、Token、能力和容器网络，未提供指标不等于零；不要重置面板登录 |
| 重启后认证/数据变化 | 核对 Compose 项目、覆盖文件与真实 Mounts，确认恢复卷名与数据路径没变 |

## 14. 验证、发布验收和未实现项

本地代码检查：

```sh
npm test
npm run lint
npm run build
```

默认测试包含 TOTP 标准向量、强制绑定、重放、过期、撤销、持久化、迁移与来源校验；真实浏览器测试默认跳过。装有 Chrome 的测试机可执行：

```sh
SMA_CENTER_BROWSER_TEST=1 npm test
# 非 macOS 默认安装路径时再通过 CHROME_BIN 指定 Chrome/Chromium 可执行文件。
```

认证相关变更必须验证浏览器原生表单完整流程，不能只用手工补 Origin 的 fetch 冒充真实验证。`deploy/smoke.mjs` 只用于明确启用 SMA_CENTER_AUTH_TEST=1 的一次性 QA 环境，禁止对生产卷执行测试绑定。

发布验收：容器健康、实际入口可达、未认证被拦截、原验证器可登录、旧数据保留、资源/收藏/主题可保存、SMA 可连接、备份可读、部署源码与发布版本一致。恢复和破坏性测试只在隔离副本验证。

当前未实现/未配置：多用户/多租户、密码登录、自动 Git 同步部署、定时异地备份及清理、持续监控告警、完整 HTTPS 反向代理支持。后续新增能力必须修改本节及维护约定中的相关操作说明。
