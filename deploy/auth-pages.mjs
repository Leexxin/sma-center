import { nativePage, escapeHtml as escape } from "./console-pages.mjs";
const codeInput =
  '<label for="code">验证器动态码</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required autofocus class="otp"><p class="hint">输入验证器中的 6 位动态码。</p>';
const failure = (error) =>
  error ? `<div class="error" role="alert">${escape(error)}</div>` : "";
export const setupPage = (error, presentation = {}) =>
  nativePage(
    "绑定验证器",
    "首次使用需要部署授权码。",
    `${failure(error)}<div class="step">1 / 部署授权</div><form method="post" action="/setup/authorize"><label for="setupCode">一次性绑定授权码</label><input id="setupCode" name="setupCode" autocomplete="off" required autofocus><p class="hint">授权码仅用于首次绑定。</p><button>开始绑定</button></form>`,
    presentation,
  );
export const enrollPage = (secret, qr, error, presentation = {}) =>
  nativePage(
    "扫描二维码",
    "使用支持 TOTP 的验证器扫码。",
    `${failure(error)}<div class="step">2 / 验证</div><img class="qr" src="${qr}" alt="验证器绑定二维码"><details><summary>手动输入密钥</summary><code class="secret">${escape(secret)}</code><p class="hint">选择基于时间的动态码，勿分享密钥。</p></details><form method="post" action="/setup/confirm">${codeInput}<button>验证并进入</button></form>`,
    presentation,
  );
export const loginPage = (error, next = "/", presentation = {}) =>
  nativePage(
    "登录",
    "使用验证器动态码。",
    `${failure(error)}<form method="post" action="/login?next=${encodeURIComponent(next)}">${codeInput}<button>登录</button></form>`,
    presentation,
  );
export const securityPage = (
  minutes,
  expires,
  error,
  saved = false,
  presentation = {},
) =>
  nativePage(
    "安全设置",
    "验证器与登录有效期。",
    `${failure(error)}<div class="status">验证器已绑定</div>${saved ? '<p role="status">登录有效期已更新。</p>' : ""}<div class="row"><span>当前会话到期</span><strong>${escape(new Date(expires).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }))}</strong></div><form method="post" action="/security"><label for="ttlMinutes">登录有效期（分钟）</label><input id="ttlMinutes" name="ttlMinutes" type="number" min="5" max="43200" step="1" value="${minutes}" required><p class="hint">5 分钟至 30 天。缩短有效期会同时约束已有会话。</p><button>保存</button></form><form method="post" action="/logout"><button class="secondary">退出所有设备</button></form>`,
    { ...presentation, authenticated: true, current: "security" },
  );
