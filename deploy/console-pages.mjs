export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  grid: "M2 2h5v5H2zm9 0h5v5h-5zM2 11h5v5H2zm9 0h5v5h-5z",
  resources: "M2 4l7-3 7 3-7 3zm0 5l7 3 7-3M2 14l7 3 7-3",
  events: "M5 12V7a4 4 0 018 0v5l2 2H3l2-2zm2 4h4",
  signal: "M1 9h4l2-6 4 12 2-6h4",
  download: "M9 1v10m-4-4l4 4 4-4M2 12v5h14v-5",
  link: "M7 5l2-2a4 4 0 016 6l-2 2M11 13l-2 2a4 4 0 01-6-6l2-2m1 3l6-6",
  shield: "M9 1l7 3v5c0 4-7 8-7 8S2 13 2 9V4l7-3zm-3 8l2 2 4-4",
  settings:
    "M9 5a4 4 0 100 8 4 4 0 000-8zm0-4v2m0 12v2M1 9h2m12 0h2M3 3l2 2m8 8l2 2M3 15l2-2m8-8l2-2",
};
const icon = (name) =>
  `<svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.grid}"/></svg>`;
export function nativePage(title, subtitle, content, options = {}) {
  const theme = options.theme === "light" ? "light" : "dark",
    accent = ["cyan", "violet", "orange"].includes(options.accent)
      ? options.accent
      : "cyan";
  const brand =
    '<a class="ws-brand" href="/"><img src="/sma-icon.png" width="34" height="34" alt=""><strong>SMA Center</strong></a>';
  const boards = (
    options.boards?.length ? options.boards : [{ id: "", name: "总览" }]
  )
    .map(
      (b) =>
        `<a href="/?board=${encodeURIComponent(b.id)}">${icon("grid")}<span>${escapeHtml(b.name)}</span></a>`,
    )
    .join("");
  const management = [
    ["resources", "资源", "resources"],
    ["events", "事件", "events"],
    ["sources", "数据连接", "signal"],
    ["gallery", "卡片管理", "grid"],
    ["plugins", "插件", "resources"],
  ]
    .map(
      ([view, label, symbol]) =>
        `<a href="${view === "resources" ? "/resources" : view === "gallery" ? "/cards" : view === "plugins" ? "/plugins" : `/?view=${view}`}">${icon(symbol)}${label}</a>`,
    )
    .join("");
  const bottom = [
    ["/sma/releases", "版本中心", "download", "releases"],
    ["/applications", "业务应用", "link", "applications"],
    ["/security", "安全设置", "shield", "security"],
    ["/?view=settings", "设置", "settings", "settings"],
  ]
    .map(
      ([href, label, symbol, section]) =>
        `<a href="${href}" ${section === options.current ? 'aria-current="page"' : ""}>${icon(symbol)}${label}</a>`,
    )
    .join("");
  const heading = `<header class="ui-page-heading"><div><h1>${escapeHtml(title)}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}</div></header>`;
  const mobile = `<details class="ws-mobile-menu"><summary aria-label="导航">☰</summary><div>${boards}${management}${bottom}</div></details>`;
  const main = options.authenticated
    ? `<div class="workspace ws-${theme} ws-${options.density === "compact" ? "compact" : "comfortable"} ws-accent-${accent}"><aside class="ws-sidebar">${brand}<div class="ws-navcaption">面板<a href="/?view=new-board" aria-label="新建面板">＋</a></div><nav aria-label="面板">${boards}</nav><div class="ws-navcaption">管理</div><nav aria-label="管理">${management}</nav><div class="ws-sidebar-bottom">${bottom}</div></aside><main class="ws-main"><div class="ws-top"><div class="ws-breadcrumb"><a href="/">总览</a><span>›</span><span>${escapeHtml(title)}</span></div><div class="ws-top-actions">${mobile}</div></div>${heading}<section class="ui-panel native-content">${content}</section></main></div>`
    : `<div class="ui-auth"><main class="ui-auth-card">${brand}<h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p>${content}</main></div>`;
  return `<!doctype html><html lang="zh-CN" data-theme="${theme}" data-accent="${accent}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · SMA Center</title><link rel="icon" href="/favicon.png"><link rel="stylesheet" href="/console.css"></head><body>${main}</body></html>`;
}
