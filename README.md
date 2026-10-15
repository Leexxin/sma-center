# sma-center

单用户个人工具、站点与服务器导航工作台，支持 SMA 指标与服务发现、收藏、分类、亮暗主题、主页自定义和备份还原。

只支持 TOTP 验证器动态码登录。不使用用户名、密码或第三方身份认证。首次部署必须完成验证器绑定，否则页面和 API 均不可访问。

## 本地运行

使用 Node.js 22.13 或更新版本：

```sh
npm ci
npm run dev
```

默认访问 `http://localhost:3000`。从 `.sma-center-data/setup-code.txt` 读取一次性绑定授权码，在页面中输入后扫描二维码，并输入验证器的 6 位动态码完成绑定。

本地数据、验证器配置和密钥保存在忽略 Git 的 `.sma-center-data/`。不要提交或公开该目录。

```sh
npm test
npm run lint
npm run build
npm start
```

## Docker 部署

见 [部署与恢复说明](deploy/README.md)。当前安装路径 `/opt/sma-center`，访问地址 `http://192.168.33.124:8080`。

绑定后从侧栏“安全设置”调整登录有效期，范围 5 分钟到 30 天，默认 12 小时。缩短时长会同时约束旧会话；退出登录会撤销所有已登录设备的会话。

## 数据与凭据

SQLite 自动应用 `drizzle/` 迁移。保留原站点的内部存储标识以兼容现有导航、设置、备份和 SMA 加密凭据，数据库中的内部用户字段不再代表可登录账号。

SMA Bearer Token 以 AES-256-GCM 加密并仅在服务端使用。TOTP 种子也加密保存。JSON 页面备份不包含验证器、会话密钥或 SMA 凭据；灾难恢复应使用完整数据卷备份。
