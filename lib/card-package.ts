export const cardRenderers = [
  "clock",
  "countdown",
  "memo",
  "todo",
  "fields",
] as const;
export type CardRenderer = (typeof cardRenderers)[number];
export const cardIcons = [
  "layout",
  "server",
  "activity",
  "link",
  "note",
  "bell",
  "clock",
  "calendar",
  "check",
  "database",
  "globe",
  "star",
] as const;
export type CardIconName = (typeof cardIcons)[number];
export type CardField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "timezone" | "boolean";
  required: boolean;
  default: string | number | boolean;
};
export type CardPackage = {
  format: "sma-card-package-v1";
  id: string;
  name: string;
  version: string;
  description: string;
  icon: CardIconName;
  renderer: CardRenderer;
  size: "small" | "medium" | "wide" | "full";
  fields: CardField[];
};
export type CardDefinition = CardPackage & {
  revision: number;
  builtin?: boolean;
};
const keyPattern = /^[a-z][a-z0-9_]{0,39}$/;
export function parseCardPackage(value: unknown): CardPackage {
  if (!value || typeof value !== "object")
    throw new Error("插件包必须是 JSON 对象。");
  const p = value as Record<string, unknown>;
  const allowed = [
    "format",
    "id",
    "name",
    "version",
    "description",
    "icon",
    "renderer",
    "size",
    "fields",
  ];
  if (Object.keys(p).some((k) => !allowed.includes(k)))
    throw new Error("包含不支持的包字段；不允许脚本、网络权限或远程资源。");
  if (
    p.format !== "sma-card-package-v1" ||
    typeof p.id !== "string" ||
    !/^[a-z][a-z0-9.-]{2,79}$/.test(p.id) ||
    !/^\d+\.\d+\.\d+$/.test(String(p.version)) ||
    typeof p.name !== "string" ||
    !p.name.trim() ||
    p.name.length > 40 ||
    typeof p.description !== "string" ||
    p.description.length > 180 ||
    !cardIcons.includes(p.icon as CardIconName) ||
    !cardRenderers.includes(p.renderer as CardRenderer) ||
    !["small", "medium", "wide", "full"].includes(String(p.size)) ||
    !Array.isArray(p.fields) ||
    p.fields.length > 20
  )
    throw new Error("插件标识、版本、图标、呈现类型或字段无效。");
  if (
    p.id.startsWith("sma.") &&
    !builtinCards.some((b) => b.id === p.id && b.renderer === p.renderer)
  )
    throw new Error("系统标识或呈现类型无效。");
  const keys = new Set<string>();
  const fields: CardField[] = p.fields.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("字段无效。");
    const f = raw as CardField;
    if (
      Object.keys(f).some(
        (k) => !["key", "label", "type", "required", "default"].includes(k),
      ) ||
      !keyPattern.test(f.key) ||
      keys.has(f.key) ||
      ["__proto__", "constructor", "prototype"].includes(f.key) ||
      typeof f.label !== "string" ||
      !f.label.trim() ||
      f.label.length > 40 ||
      !["text", "textarea", "number", "date", "timezone", "boolean"].includes(
        f.type,
      ) ||
      typeof f.required !== "boolean"
    )
      throw new Error("字段标识重复或定义无效。");
    keys.add(f.key);
    validateField(f, f.default, false);
    return {
      key: f.key,
      label: f.label.trim(),
      type: f.type,
      required: f.required,
      default: f.default,
    };
  });
  const required: Partial<
    Record<CardRenderer, Record<string, CardField["type"]>>
  > = {
    clock: { timezone: "timezone", seconds: "boolean" },
    countdown: { target: "date" },
    memo: { text: "textarea" },
    todo: { items: "textarea" },
  };
  for (const [key, type] of Object.entries(
    required[p.renderer as CardRenderer] || {},
  ))
    if (!fields.some((f) => f.key === key && f.type === type))
      throw new Error(`此呈现类型需要 ${key}（${type}）字段。`);
  return {
    format: "sma-card-package-v1",
    id: p.id,
    name: p.name.trim(),
    version: String(p.version),
    description: p.description,
    icon: p.icon as CardIconName,
    renderer: p.renderer as CardRenderer,
    size: p.size as CardPackage["size"],
    fields,
  };
}
function validateField(
  f: CardField,
  v: unknown,
  enforce = true,
): asserts v is string | number | boolean {
  if (f.type === "number") {
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1e12)
      throw new Error(`${f.label}需要有效数字。`);
    return;
  }
  if (f.type === "boolean") {
    if (typeof v !== "boolean") throw new Error(`${f.label}需要开关值。`);
    return;
  }
  if (
    typeof v !== "string" ||
    v.length > (f.type === "textarea" ? 4000 : 240) ||
    (enforce && f.required && !v.trim())
  )
    throw new Error(`请填写${f.label}。`);
  if (
    v &&
    f.type === "date" &&
    (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(v) ||
      !Number.isFinite(Date.parse(v)))
  )
    throw new Error("日期需要包含时区。");
  if (v && f.type === "timezone") {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
    } catch {
      throw new Error("时区无效。");
    }
  }
}
export function parseCardValues(
  def: CardPackage,
  value: unknown,
  enforce = true,
): Record<string, string | number | boolean> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !def.fields.some((f) => f.key === k))
  )
    throw new Error("卡片配置字段无效。");
  const raw = value as Record<string, unknown>;
  return Object.fromEntries(
    def.fields.map((f) => {
      const v = raw[f.key] ?? f.default;
      validateField(f, v, enforce);
      return [f.key, v];
    }),
  );
}
export function editableCardValues(
  def: CardPackage,
  raw: unknown,
): Record<string, string | number | boolean> {
  const values =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    def.fields.map((f) => {
      const value = values[f.key] ?? f.default;
      try {
        validateField(f, value, false);
        return [f.key, value];
      } catch {
        return [f.key, f.default];
      }
    }),
  );
}
const field = (
  key: string,
  label: string,
  type: CardField["type"],
  value: CardField["default"],
  required = false,
): CardField => ({ key, label, type, default: value, required });
export const builtinCards: CardDefinition[] = [
  {
    id: "sma.clock",
    name: "时钟",
    description: "指定时区的时间与日期",
    icon: "clock",
    renderer: "clock",
    fields: [
      field("timezone", "时区", "timezone", "Asia/Shanghai", true),
      field("seconds", "显示秒", "boolean", true),
    ],
  },
  {
    id: "sma.countdown",
    name: "倒数日",
    description: "纪念日、截止日期与倒计时",
    icon: "calendar",
    renderer: "countdown",
    fields: [
      field("target", "目标时间", "date", "", true),
      field("caption", "说明", "text", "距离目标日期"),
    ],
  },
  {
    id: "sma.memo",
    name: "备忘录",
    description: "可直接编辑并保存的便签",
    icon: "note",
    renderer: "memo",
    fields: [field("text", "初始内容", "textarea", "")],
  },
  {
    id: "sma.todo",
    name: "待办",
    description: "勾选完成、添加和删除事项",
    icon: "check",
    renderer: "todo",
    fields: [field("items", "初始事项（每行一项）", "textarea", "")],
  },
  {
    id: "sma.fields",
    name: "自定义信息",
    description: "独立设计字段与展示内容",
    icon: "layout",
    renderer: "fields",
    fields: [field("content", "内容", "textarea", "")],
  },
].map(
  (p) =>
    ({
      ...p,
      format: "sma-card-package-v1",
      version: "1.0.0",
      size: "medium",
      revision: 0,
      builtin: true,
    }) as CardDefinition,
);
export function packageOnly(p: CardPackage): CardPackage {
  return {
    format: p.format,
    id: p.id,
    name: p.name,
    version: p.version,
    description: p.description,
    icon: p.icon,
    renderer: p.renderer,
    size: p.size,
    fields: p.fields.map((f) => ({ ...f })),
  };
}
export function createCardId() {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const s = Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
export type CardState = {
  text?: string;
  items?: { id: string; text: string; done: boolean }[];
};
export function parseCardState(raw: unknown): CardState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("INVALID_STATE");
  const p = raw as CardState;
  if (
    Object.keys(p).some((k) => !["text", "items"].includes(k)) ||
    (p.text !== undefined &&
      (typeof p.text !== "string" || p.text.length > 4000))
  )
    throw new Error("INVALID_STATE");
  if (p.items !== undefined) {
    if (!Array.isArray(p.items) || p.items.length > 100)
      throw new Error("INVALID_STATE");
    const ids = new Set<string>();
    for (const item of p.items) {
      if (
        !item ||
        typeof item.id !== "string" ||
        !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) ||
        ids.has(item.id) ||
        typeof item.text !== "string" ||
        !item.text.trim() ||
        item.text.length > 240 ||
        typeof item.done !== "boolean" ||
        Object.keys(item).some((k) => !["id", "text", "done"].includes(k))
      )
        throw new Error("INVALID_STATE");
      ids.add(item.id);
    }
  }
  return {
    ...(p.text !== undefined ? { text: p.text } : {}),
    ...(p.items !== undefined
      ? {
          items: p.items.map((i) => ({ id: i.id, text: i.text, done: i.done })),
        }
      : {}),
  };
}
