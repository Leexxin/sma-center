# Docker 单用户部署

完整、持续维护的操作说明见 [全流程安装与运维手册](../docs/installation-and-operations.md)。本页仅保留常用命令；首次安装、升级和恢复前请先阅读完整手册。

项目目录 `/opt/sma-center`，容器与服务 `sma-center`，外部持久卷 `sma-center-data`，访问地址 `http://192.168.33.124:8080`。

```sh
cd /opt/sma-center
docker volume create sma-center-data
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 sma-center
```

## 必须绑定验证器

部署后浏览器自动进入 `/setup`。读取一次性绑定授权码：

```sh
docker compose exec -T sma-center cat /data/setup-code.txt
```

输入该码后才会显示二维码和手动绑定密钥。用 Google Authenticator、Microsoft Authenticator 或其他 TOTP 验证器扫描，输入 6 位动态码完成绑定。绑定码随后失效并从卷中删除。绑定确认前，所有面板页面与 API 都被阻止；仅打开二维码不算绑定成功。

之后仅使用验证器动态码登录，无账号密码、用户创建或第三方登录方式。验证码不能重放；连续 10 次失败会暂时锁定验证 10 分钟。原账号密码及旧 Cookie 全部失效，旧认证文件归档在服务器私密备份中。

验证器密钥和二维码始终由本机生成，不向外部二维码服务发送。TOTP 要求服务器和手机时间准确，服务器应保持 NTP 同步。

## 登录有效期

进入面板后点侧栏“安全设置”（`/security`），可设置 5 分钟到 30 天，默认 12 小时。保存后当前会话重新计时；缩短时长对已有会话同时生效。到期必须重新输入动态码。“退出登录”会撤销所有已有会话。

## 完整备份

```sh
sh deploy/backup.sh
```

备份位于 `/root/sma-center-backups/`，脚本短暂停止服务以一致地备份整个卷后恢复服务。卷内包含 `sma-center.sqlite`、`secrets.json` 和加密的 `totp-auth.json`，必须一起保留。JSON 页面备份不会备份验证器和服务端密钥。

恢复完整备份应先停止容器，再将可信备份解压到原数据卷后启动。不要删除数据卷或只恢复单个密钥文件。

## 验证器丢失时

没有可以绕过验证器进入面板的网络接口。只有服务器管理员可以离线重置绑定，原导航和 SMA 密钥保持不变：

```sh
cd /opt/sma-center
docker compose stop sma-center
docker compose run --rm --no-deps sma-center node deploy/server.mjs reset-2fa
docker compose up -d
docker compose exec -T sma-center cat /data/setup-code.txt
```

所有旧会话立即失效，必须使用新绑定码重新绑定并验证后才能进入面板。

## HTTPS

当前网关按 HTTP 和 Host 计算写请求来源，仅加 HTTPS 反向代理与 `SMA_CENTER_SECURE_COOKIES=true` 会造成来源不匹配，不能作为可用配置。HTTPS 需先实现并测试可信外部来源/代理支持，详见完整手册第 12 节。当前 HTTP 内网部署不要启用 Secure Cookie。

## 验证

`npm test` 包含 RFC 6238 标准向量、强制绑定、重放保护、会话过期、撤销、持久化及数据库迁移测试。`deploy/smoke.mjs` 仅允许在设置 `SMA_CENTER_AUTH_TEST=1` 的一次性 QA 容器执行，禁止在生产卷上绑定测试验证器。
