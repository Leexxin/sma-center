# Docker 自部署

项目名称、Compose 服务和容器名称统一为 `sma-center`；数据卷为 `sma-center-data`，SQLite 文件为 `/data/sma-center.sqlite`。旧登录链接、会话和 JSON 备份仍兼容，旧数据库首次启动时自动迁移。

该部署使用 Next.js 生产构建、Node 22 和持久化 SQLite，不依赖 Sites 的身份头注入。原 Vinext / Sites 构建入口仍可使用。

## 当前服务器

- 主机名：`sma-center`
- 地址：`192.168.33.124/24`，网关与 DNS：`192.168.33.1`
- 项目目录：`/opt/sma-center`
- 访问地址：`http://192.168.33.124:8080`

```sh
cd /opt/sma-center
docker volume create sma-center-data
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 sma-center
```

默认账号为 `admin`，随机初始密码仅保存在数据卷 `/data/bootstrap-admin.txt`，不会输出到日志或写入源码：

```sh
docker compose exec sma-center cat /data/bootstrap-admin.txt
```

每个账号拥有独立用户 ID。新增用户时密码从标准输入读取，至少 16 字符：

```sh
read -s -p 'New password: ' SMA_CENTER_NEW_PASSWORD
printf '%s' "$SMA_CENTER_NEW_PASSWORD" | docker compose exec -T sma-center node deploy/server.mjs add-user alice alice@example.com
unset SMA_CENTER_NEW_PASSWORD
```

会话通过签名 HttpOnly Cookie 认证，写操作检查 Origin，外部提供的身份头会被删除。管理备份权限通过 Compose 中的 `SMA_CENTER_ADMIN_EMAILS` 配置。

内网 IP 部署使用 HTTP。需要公网访问时，使用 HTTPS 反向代理并补充 Secure Cookie 配置。

## 持久化与备份

`sma-center-data` 卷包含 SQLite 数据库、账号密码哈希、会话密钥和 SMA 凭据密钥。保留该卷；切勿执行 `docker compose down -v`。
首次部署初始化新数据库，不会自动导入 Sites 云端或本机数据。迁移原站点时需导入 JSON 备份，并处理原用户 ID 与自部署账号的关联；SMA 凭据需要重新配置。

页面 JSON 备份不含自部署密码哈希和 SMA 密钥。完整恢复必须备份整个数据卷。使用以下脚本产生权限为 600 的完整备份，会短暂停止服务，随后自动恢复：

```sh
sh deploy/backup.sh
```

恢复时先停止服务，再将可信的完整备份解压到原数据卷目录后启动服务。备份包含密钥和账户哈希，应作为私密文件保管。

## 网络

`/etc/netplan/00-installer-config.yaml` 配置静态 IP；原配置保存在 `/root/sma-center-backup/`。
Cloud-init 设置 `preserve_hostname: true`，Docker 服务已设置开机启动，Compose 使用 `restart: unless-stopped`。
