import { getRawDb } from "./index";
import type { Owner } from "@/app/auth";
import { credentialMutationStatement, prepareCredentialMutation } from "./agent-credentials";

export type ResourceKind = "tool" | "site" | "server";
export type ResourceStatus = "online" | "warning" | "offline" | "unknown";
export type Density = "comfortable" | "compact";
export type Accent = "cyan" | "violet" | "orange";
export type Theme = "dark" | "light";

export type Resource = {
  id: string;
  kind: ResourceKind;
  name: string;
  url: string;
  description: string;
  category: string;
  status: ResourceStatus;
  note: string;
  pinned: boolean;
  cpuUsage: number;
  temperature: number;
  memoryUsage: number;
  diskUsage: number;
  agentUrl: string;
  credentialConfigured: boolean;
  createdAt: number;
  updatedAt: number;
};

export type Preferences = {
  pageName: string;
  greeting: string;
  accent: Accent;
  density: Density;
  theme: Theme;
  sidebarCollapsed: boolean;
  navOrder: ResourceKind[];
};

export type ResourceWrite = Omit<Resource, "id" | "credentialConfigured" | "createdAt" | "updatedAt">;
export type CredentialWrite = { token?: string; clear?: boolean };

type ResourceRow = Omit<Resource, "pinned" | "credentialConfigured" | "createdAt" | "updatedAt"> & {
  pinned: number;
  credential_configured: number;
  created_at: number;
  updated_at: number;
  cpu_usage: number;
  memory_usage: number;
  disk_usage: number;
};

const starterResources = [
  ["tool", "ChatGPT", "https://chatgpt.com", "日常思考与创作助手", "AI 工具", "online", "", 1, 0, 0, 0, 0, ""],
  ["tool", "GitHub", "https://github.com", "代码仓库与协作", "开发", "online", "", 1, 0, 0, 0, 0, ""],
  ["site", "个人博客", "https://example.com", "内容发布站点", "内容", "online", "示例数据，可随时编辑", 0, 0, 0, 0, 0, ""],
  ["site", "服务监控", "https://status.example.com", "对外服务状态页", "运维", "warning", "替换为你的真实地址", 0, 0, 0, 0, 0, ""],
  ["server", "生产服务器", "https://server.example.com", "核心应用节点", "云服务器", "online", "4C / 8G · 上海", 1, 34, 52, 68, 42, ""],
  ["server", "备份节点", "https://backup.example.com", "文件与数据库备份", "存储", "unknown", "每周检查一次", 0, 12, 39, 31, 76, ""],
] as const;

export async function recordUser(user: Owner) {
  const now = Date.now();
  await getRawDb().prepare(`INSERT INTO users (user_id, email, display_name, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email = excluded.email,
    display_name = excluded.display_name, last_seen_at = excluded.last_seen_at`)
    .bind(user.userId, user.email, user.displayName, now, now).run();
}

function mapRow(row: ResourceRow): Resource {
  const { created_at, updated_at, cpu_usage, memory_usage, disk_usage, credential_configured, ...resource } = row;
  return { ...resource, pinned: Boolean(row.pinned), credentialConfigured: Boolean(credential_configured), cpuUsage: cpu_usage, memoryUsage: memory_usage, diskUsage: disk_usage, createdAt: created_at, updatedAt: updated_at };
}

export async function listResources(userId: string): Promise<Resource[]> {
  const db = getRawDb();
  const count = await db.prepare("SELECT COUNT(*) AS total FROM resources WHERE user_id = ?").bind(userId).first<{ total: number }>();
  if (!count?.total) {
    const now = Date.now();
    await db.batch(
      starterResources.map((item, index) =>
        db.prepare(`INSERT INTO resources
          (id, user_id, kind, name, url, description, category, status, note, pinned, cpu_usage, temperature, memory_usage, disk_usage, agent_url, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), userId, ...item, now + index, now + index),
      ),
    );
  }
  const result = await db.prepare(`SELECT r.id, r.kind, r.name, r.url, r.description, r.category, r.status, r.note, r.pinned,
    r.cpu_usage, r.temperature, r.memory_usage, r.disk_usage, r.agent_url AS agentUrl, r.created_at, r.updated_at,
    EXISTS(SELECT 1 FROM agent_credentials c WHERE c.resource_id = r.id AND c.user_id = r.user_id) AS credential_configured
    FROM resources r WHERE r.user_id = ? ORDER BY r.pinned DESC, r.updated_at DESC`).bind(userId).all<ResourceRow>();
  return result.results.map(mapRow);
}

export async function getResource(userId: string, id: string): Promise<Resource | null> {
  const row = await getRawDb().prepare(`SELECT r.id, r.kind, r.name, r.url, r.description, r.category, r.status, r.note, r.pinned,
    r.cpu_usage, r.temperature, r.memory_usage, r.disk_usage, r.agent_url AS agentUrl, r.created_at, r.updated_at,
    EXISTS(SELECT 1 FROM agent_credentials c WHERE c.resource_id = r.id AND c.user_id = r.user_id) AS credential_configured
    FROM resources r WHERE r.id = ? AND r.user_id = ?`).bind(id, userId).first<ResourceRow>();
  return row ? mapRow(row) : null;
}

export async function createResource(userId: string, input: ResourceWrite, credential: CredentialWrite = {}): Promise<Resource> {
  const db = getRawDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  const mutation = await prepareCredentialMutation(userId, id, input.kind === "server" ? credential : { clear: true });
  const insert = db.prepare(`INSERT INTO resources
    (id, user_id, kind, name, url, description, category, status, note, pinned, cpu_usage, temperature, memory_usage, disk_usage, agent_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, userId, input.kind, input.name, input.url, input.description, input.category, input.status, input.note, input.pinned ? 1 : 0, input.cpuUsage, input.temperature, input.memoryUsage, input.diskUsage, input.agentUrl, now, now);
  const credentialStatement = credentialMutationStatement(userId, id, mutation);
  await db.batch([insert, ...(credentialStatement ? [credentialStatement] : [])]);
  return { id, ...input, credentialConfigured: mutation.type === "set", createdAt: now, updatedAt: now };
}

export async function updateResource(userId: string, id: string, input: ResourceWrite, credential: CredentialWrite = {}): Promise<Resource | null> {
  const db = getRawDb();
  const existing = await getResource(userId, id);
  if (!existing) return null;
  const now = Date.now();
  const mutation = await prepareCredentialMutation(userId, id, input.kind === "server" ? credential : { clear: true });
  const update = db.prepare(`UPDATE resources SET kind = ?, name = ?, url = ?, description = ?, category = ?,
    status = ?, note = ?, pinned = ?, cpu_usage = ?, temperature = ?, memory_usage = ?, disk_usage = ?, agent_url = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .bind(input.kind, input.name, input.url, input.description, input.category, input.status, input.note, input.pinned ? 1 : 0, input.cpuUsage, input.temperature, input.memoryUsage, input.diskUsage, input.agentUrl, now, id, userId);
  const credentialStatement = credentialMutationStatement(userId, id, mutation);
  await db.batch([update, ...(credentialStatement ? [credentialStatement] : [])]);
  const credentialConfigured = mutation.type === "preserve" ? existing.credentialConfigured : mutation.type === "set";
  return { id, ...input, credentialConfigured, createdAt: existing.createdAt, updatedAt: now };
}

export async function deleteResource(userId: string, id: string) {
  const db = getRawDb();
  const existing = await db.prepare("SELECT id FROM resources WHERE id = ? AND user_id = ?").bind(id, userId).first<{ id: string }>();
  if (!existing) return false;
  await db.batch([
    db.prepare("DELETE FROM agent_credentials WHERE resource_id = ? AND user_id = ?").bind(id, userId),
    db.prepare("DELETE FROM resources WHERE id = ? AND user_id = ?").bind(id, userId),
  ]);
  return true;
}

export async function getPreferences(userId: string): Promise<Preferences> {
  const db = getRawDb();
  const row = await db.prepare("SELECT page_name, greeting, accent, density, theme, sidebar_collapsed, nav_order FROM user_preferences WHERE user_id = ?")
    .bind(userId).first<{ page_name: string; greeting: string; accent: Accent; density: Density; theme: Theme; sidebar_collapsed: number; nav_order: string }>();
  if (row) {
    let navOrder: ResourceKind[] = ["tool", "site", "server"];
    try {
      const parsed = JSON.parse(row.nav_order) as ResourceKind[];
      if (parsed.length === 3 && (["tool", "site", "server"] as ResourceKind[]).every((kind) => parsed.includes(kind))) navOrder = parsed;
    } catch { /* Preserve safe defaults for malformed legacy preferences. */ }
    return { pageName: row.page_name, greeting: row.greeting, accent: row.accent, density: row.density, theme: row.theme, sidebarCollapsed: Boolean(row.sidebar_collapsed), navOrder };
  }
  const defaults: Preferences = { pageName: "我的工具站", greeting: "今天想从哪里开始？", accent: "cyan", density: "comfortable", theme: "dark", sidebarCollapsed: false, navOrder: ["tool", "site", "server"] };
  await db.prepare("INSERT INTO user_preferences (user_id, page_name, greeting, accent, density, theme, sidebar_collapsed, nav_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(userId, defaults.pageName, defaults.greeting, defaults.accent, defaults.density, defaults.theme, 0, JSON.stringify(defaults.navOrder), Date.now()).run();
  return defaults;
}

export async function savePreferences(userId: string, input: Preferences): Promise<Preferences> {
  await getRawDb().prepare(`INSERT INTO user_preferences (user_id, page_name, greeting, accent, density, theme, sidebar_collapsed, nav_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET page_name = excluded.page_name,
    greeting = excluded.greeting, accent = excluded.accent, density = excluded.density, theme = excluded.theme,
    sidebar_collapsed = excluded.sidebar_collapsed, nav_order = excluded.nav_order, updated_at = excluded.updated_at`)
    .bind(userId, input.pageName, input.greeting, input.accent, input.density, input.theme, input.sidebarCollapsed ? 1 : 0, JSON.stringify(input.navOrder), Date.now()).run();
  return input;
}
