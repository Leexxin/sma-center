# 其他业务系统接入 sma-center SSO

更新日期：2026-11-04。面向业务系统开发者，可直接转发。本次使用内网 HTTP IP，不要求 HTTPS、域名或证书。中心公开发现接口已在该日期核验；各业务系统须分别完成客户端注册和回调验收。

## 1. 固定配置

| 配置 | 值 |
| --- | --- |
| Issuer（不带末尾斜杠） | `http://192.168.33.124:8080` |
| Discovery | `http://192.168.33.124:8080/.well-known/openid-configuration` |
| 授权接口 | `http://192.168.33.124:8080/oidc/authorize` |
| 令牌接口 | `http://192.168.33.124:8080/oidc/token` |
| 公钥 JWKS | `http://192.168.33.124:8080/oidc/jwks` |
| 用户信息 | `http://192.168.33.124:8080/oidc/userinfo` |
| 令牌内省 | `http://192.168.33.124:8080/oidc/introspect` |
| 令牌撤销 | `http://192.168.33.124:8080/oidc/revoke` |
| 统一应用目录 | `http://192.168.33.124:8080/applications` |
| 登录模式 | OIDC `authorization_code`，`response_type=code` |
| Scope / PKCE / 签名 | `openid profile` / 强制 `S256` / `RS256` |
| 客户端认证 | 推荐 `client_secret_basic`，也支持 `client_secret_post`，二选一 |
| HTTP Cookie | `HttpOnly=true`、`SameSite=Lax`、`Secure=false`、不设置共享 Domain |

每个应用的 client_id、secret 和精确回调地址都独立注册。客户端库若默认禁止 HTTP，须允许上述固定 HTTP issuer 和本应用 IP，不要关闭协议校验来兼容。

## 2. 向中心管理员提供接入资料

```text
应用名称：<业务系统名称>
client_id：<唯一英文ID，例如 inventory>
应用 origin：http://<业务IP>:<端口>
登录启动入口：http://<业务IP>:<端口>/login
精确回调地址：http://<业务IP>:<端口>/auth/callback
```

回调路径由业务系统实际实现决定，注册后必须逐字一致，含协议、IP、端口、路径、尾部斜杠和查询参数；不支持通配符。登录入口应启动 OIDC 流程，与至少一个回调同源。

中心管理员在 **sma-center 服务器** 注册（已有客户端不要重复 add 或擅自 rotate）：

```sh
cd /opt/sma-center
docker compose exec -T sma-center node deploy/sso-client.mjs add inventory "库存系统" \
  http://<业务IP>:<端口>/login \
  http://<业务IP>:<端口>/auth/callback
```

工具输出受限密钥交付文件的路径。管理员通过受保护渠道将原始 secret 交付给该应用后端，用后删除交付文件。不要把摘要当成 secret，也不要复用其他应用的密钥。客户端配置热加载，无需重启中心。详细运维见 [完整手册](sso-integration.md)。

业务后端配置示意（这里是配置含义，环境变量名称由各应用决定）：

```text
issuer = http://192.168.33.124:8080
client_id = <管理员分配的唯一ID>
client_secret_file = <业务后端可读的受限密钥文件>
app_origin = http://<业务IP>:<端口>
redirect_uri = http://<业务IP>:<端口>/auth/callback
scope = openid profile
response_type = code
pkce = S256
secure_cookie = false
```

## 3. 必须实现的登录链路

1. 所有受保护业务页面/API 在后端检查本应用会话；未登录时页面转到登录启动入口，API 返回明确的未登录响应。用户直接输入业务 URL 也必须受到保护。
2. 每次登录在后端生成随机 state、nonce、code_verifier，并存入绑定浏览器的短期事务，建议 5 分钟。推荐各使用 32 字节随机数的无填充 base64url；verifier 长度必须 43～128，nonce 要求 16～256 位 base64url。challenge = base64url(SHA256(verifier))。
3. 浏览器顶层跳转授权接口，传递 client_id、redirect_uri、response_type=code、scope、state、nonce、code_challenge、code_challenge_method=S256。不要用跨域 AJAX 或 iframe 代替顶层跳转。
4. 中心无会话时要求 TOTP；已有中心会话时直接显示应用授权确认，不重复输入 TOTP。用户确认后回调带 code、原 state 和 iss；取消/失败带 error。
5. 回调先校验绑定事务、唯一 state、iss 等于固定 issuer，拒绝过期事务、重复参数和 error，然后一次性消费事务。由后端携带 secret、原始 redirect_uri 和 verifier 换令牌。
6. 使用可信 JWKS 验证 ID Token 的 RS256 签名及 kid，再校验 iss、aud=本 client_id、exp、iat、原 nonce；不能只解码 JWT。未知 kid 最多刷新一次 JWKS，仍失败就拒绝。
7. 将已验证的 `(iss, sub)` 映射到本地账号和明确的权限，创建本应用随机会话并轮换会话 ID；回调后跳转到不带 code 的干净 URL。浏览器只持有本应用 Cookie，令牌和密钥留在后端。

Token 接口只接受 `application/x-www-form-urlencoded`，body 为：

```text
grant_type=authorization_code&code=<code>&redirect_uri=<编码后的原始回调>&code_verifier=<原verifier>
```

Basic 认证为 `Authorization: Basic base64(formEncode(client_id)+":"+formEncode(client_secret))`。若使用表单认证，则 body 增加 client_id/client_secret 且不再发送 Basic。请求体上限 8 KiB，拒绝重复参数。

返回包含 access_token（不透明令牌）、token_type=Bearer、expires_in、scope、id_token。授权码最长 60 秒且只能兑换一次；令牌最长 300 秒，不超过签发时中心会话剩余时长。没有 refresh token，到期重新发起授权。

## 4. 身份、权限与退出

- 当前中心为单用户 TOTP，主体 `sub=selfhost:admin`，profile scope 额外提供 name。没有 email、roles、groups 或 tenant 声明。必须先验签和校验 issuer/audience，再按 `(iss, sub)` 映射本地权限；不能仅匹配 sub 字符串就授予管理员。
- UserInfo 使用 GET 和 `Authorization: Bearer <access_token>`。中心登录不是业务授权，具体角色、接口及资源权限由业务系统管理。
- 如要求中心退出后业务访问立即被拒绝，每次受保护请求在后端调用 introspect：使用本应用客户端认证，表单 `token=<access_token>`，检查 active=true、sub 与本地会话一致、client_id 与本应用一致。建议同时匹配返回的 iss/aud，中心不可用时拒绝受保护访问。
- 若缓存内省结果，缓存时长就是撤销延迟，建议最多 30 秒。本地会话不得超过令牌 exp；离线 JWT 验签无法即时感知中心退出。
- 本应用退出使用同源 POST，撤销 access token 并销毁本地会话。revoke 使用本应用客户端认证和表单 token；本应用退出不自动退出中心及其他应用。
- 用户在中心安全设置退出，会撤销所有旧中心会话和中心访问令牌；各业务系统通过内省停止访问。当前无标准跨应用退出通知或跨域 Cookie 清除接口，不要从业务系统跨域 POST 中心 /logout。

## 5. 兼容范围与验收

适合服务端 Web/BFF。纯 SPA 需增加 BFF，中心不开放 CORS；不支持 refresh_token、client_credentials、动态客户端注册。只支持 code/query 响应；不要发送 prompt=login、max_age、claims、offline_access 等未支持选项。prompt=none 不会跳过授权确认，会返回 login_required 或 consent_required。

验收至少覆盖：直接访问业务 URL 受保护、从中心目录进入、无会话 TOTP 登录、有会话授权确认、取消授权、错误 state/nonce/签名/aud/issuer、错误 verifier、授权码重放/过期、令牌到期、本地退出、中心退出后的业务拒绝、中心不可用时拒绝访问。日志不得记录密钥、令牌、Cookie 或完整回调查询串。

可参考 [可运行 Node BFF](../examples/sso/client.mjs)。该程序演示登录、验签、会话、逐请求内省和退出；实际项目仍需自己的持久会话和业务权限。完整协议、错误码、注册轮换及运维详见 [SSO 完整手册](sso-integration.md)。
