import { getRawDb } from "./index";

export const BACKUP_FORMAT = "sma-center-backup-v1";

type BackupUser = {
  userId: string;
  email: string;
  displayName: string;
  firstSeenAt: number;
  lastSeenAt: number;
};

type BackupPreference = {
  userId: string;
  pageName: string;
  greeting: string;
  accent: "cyan" | "violet" | "orange";
  density: "comfortable" | "compact";
  theme: "dark" | "light";
  sidebarCollapsed: boolean;
  navOrder: Array<"tool" | "site" | "server">;
  updatedAt: number;
};

type BackupResource = {
  id: string;
  userId: string;
  kind: "tool" | "site" | "server";
  name: string;
  url: string;
  description: string;
  category: string;
  status: "online" | "warning" | "offline" | "unknown";
  note: string;
  pinned: boolean;
  cpuUsage: number;
  temperature: number;
  memoryUsage: number;
  diskUsage: number;
  agentUrl: string;
  createdAt: number;
  updatedAt: number;
};

export type SmaCenterBackup = {
  format: typeof BACKUP_FORMAT;
  exportedAt: string;
  users: BackupUser[];
  preferences: BackupPreference[];
  resources: BackupResource[];
};

export async function createFullBackup(): Promise<SmaCenterBackup> {
  const db = getRawDb();
  const [usersResult, preferencesResult, resourcesResult] = await Promise.all([
    db.prepare(`SELECT user_id AS userId, email, display_name AS displayName,
      first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt FROM users ORDER BY first_seen_at`).all<BackupUser>(),
    db.prepare(`SELECT user_id AS userId, page_name AS pageName, greeting, accent, density, theme,
      sidebar_collapsed AS sidebarCollapsed, nav_order AS navOrder, updated_at AS updatedAt
      FROM user_preferences ORDER BY user_id`).all<Omit<BackupPreference, "sidebarCollapsed" | "navOrder"> & { sidebarCollapsed: number; navOrder: string }>(),
    db.prepare(`SELECT id, user_id AS userId, kind, name, url, description, category, status, note,
      pinned, cpu_usage AS cpuUsage, temperature, memory_usage AS memoryUsage, disk_usage AS diskUsage,
      agent_url AS agentUrl, created_at AS createdAt, updated_at AS updatedAt FROM resources
      ORDER BY user_id, created_at`).all<Omit<BackupResource, "pinned"> & { pinned: number }>(),
  ]);

  return {
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    users: usersResult.results,
    preferences: preferencesResult.results.map((item) => ({
      ...item,
      sidebarCollapsed: Boolean(item.sidebarCollapsed),
      navOrder: parseNavOrder(item.navOrder),
    })),
    resources: resourcesResult.results.map((item) => ({ ...item, pinned: Boolean(item.pinned) })),
  };
}

export function parseBackup(value: unknown): SmaCenterBackup {
  if (!value || typeof value !== "object") throw new Error("INVALID_BACKUP");
  const input = value as Record<string, unknown>;
  if (![BACKUP_FORMAT, "atlas-backup-v1"].includes(String(input.format)) || !Array.isArray(input.users) || !Array.isArray(input.preferences) || !Array.isArray(input.resources)) {
    throw new Error("INVALID_BACKUP");
  }
  if (input.users.length > 1000 || input.preferences.length > 1000 || input.resources.length > 10000) throw new Error("BACKUP_TOO_LARGE");

  const users = input.users.map(parseUser);
  const userIds = new Set(users.map((item) => item.userId));
  const preferences = input.preferences.map(parsePreference);
  const resources = input.resources.map(parseResource);
  if ([...preferences, ...resources].some((item) => !userIds.has(item.userId))) throw new Error("INVALID_BACKUP");

  return {
    format: BACKUP_FORMAT,
    exportedAt: typeof input.exportedAt === "string" ? input.exportedAt.slice(0, 40) : new Date().toISOString(),
    users,
    preferences,
    resources,
  };
}

export async function restoreFullBackup(backup: SmaCenterBackup, mode: "merge" | "replace") {
  const db = getRawDb();
  if (mode === "replace") {
    await db.batch([
      db.prepare("DELETE FROM agent_credentials"),
      db.prepare("DELETE FROM resources"),
      db.prepare("DELETE FROM user_preferences"),
      db.prepare("DELETE FROM users"),
    ]);
  }

  const statements = [
    ...backup.users.map((item) => db.prepare(`INSERT INTO users (user_id, email, display_name, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email = excluded.email,
      display_name = excluded.display_name, first_seen_at = excluded.first_seen_at, last_seen_at = excluded.last_seen_at`)
      .bind(item.userId, item.email, item.displayName, item.firstSeenAt, item.lastSeenAt)),
    ...backup.preferences.map((item) => db.prepare(`INSERT INTO user_preferences
      (user_id, page_name, greeting, accent, density, theme, sidebar_collapsed, nav_order, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET page_name = excluded.page_name,
      greeting = excluded.greeting, accent = excluded.accent, density = excluded.density, theme = excluded.theme,
      sidebar_collapsed = excluded.sidebar_collapsed, nav_order = excluded.nav_order, updated_at = excluded.updated_at`)
      .bind(item.userId, item.pageName, item.greeting, item.accent, item.density, item.theme, item.sidebarCollapsed ? 1 : 0, JSON.stringify(item.navOrder), item.updatedAt)),
    ...backup.resources.map((item) => db.prepare(`INSERT INTO resources
      (id, user_id, kind, name, url, description, category, status, note, pinned, cpu_usage, temperature,
       memory_usage, disk_usage, agent_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, kind = excluded.kind, name = excluded.name,
      url = excluded.url, description = excluded.description, category = excluded.category, status = excluded.status,
      note = excluded.note, pinned = excluded.pinned, cpu_usage = excluded.cpu_usage, temperature = excluded.temperature,
      memory_usage = excluded.memory_usage, disk_usage = excluded.disk_usage, agent_url = excluded.agent_url,
      created_at = excluded.created_at, updated_at = excluded.updated_at`)
      .bind(item.id, item.userId, item.kind, item.name, item.url, item.description, item.category, item.status,
        item.note, item.pinned ? 1 : 0, item.cpuUsage, item.temperature, item.memoryUsage, item.diskUsage,
        item.agentUrl, item.createdAt, item.updatedAt)),
  ];

  for (let offset = 0; offset < statements.length; offset += 50) {
    await db.batch(statements.slice(offset, offset + 50));
  }

  return { users: backup.users.length, preferences: backup.preferences.length, resources: backup.resources.length, mode };
}

function requiredString(value: unknown, max: number) {
  if (typeof value !== "string" || !value.trim()) throw new Error("INVALID_BACKUP");
  return value.trim().slice(0, max);
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error("INVALID_BACKUP");
  return Math.floor(number);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error("INVALID_BACKUP");
  return value as T;
}

function parseNavOrder(value: unknown): BackupPreference["navOrder"] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value) as unknown; } catch { throw new Error("INVALID_BACKUP"); }
  }
  if (!Array.isArray(parsed) || parsed.length !== 3 || !["tool", "site", "server"].every((kind) => parsed.includes(kind))) throw new Error("INVALID_BACKUP");
  return parsed as BackupPreference["navOrder"];
}

function parseUser(value: unknown): BackupUser {
  const item = value as Record<string, unknown>;
  return { userId: requiredString(item.userId, 160), email: requiredString(item.email, 254).toLowerCase(), displayName: requiredString(item.displayName, 120), firstSeenAt: finiteNumber(item.firstSeenAt), lastSeenAt: finiteNumber(item.lastSeenAt) };
}

function parsePreference(value: unknown): BackupPreference {
  const item = value as Record<string, unknown>;
  return {
    userId: requiredString(item.userId, 160), pageName: requiredString(item.pageName, 32), greeting: requiredString(item.greeting, 80),
    accent: enumValue(item.accent, ["cyan", "violet", "orange"]), density: enumValue(item.density, ["comfortable", "compact"]),
    theme: enumValue(item.theme, ["dark", "light"]), sidebarCollapsed: Boolean(item.sidebarCollapsed), navOrder: parseNavOrder(item.navOrder), updatedAt: finiteNumber(item.updatedAt),
  };
}

function parseResource(value: unknown): BackupResource {
  const item = value as Record<string, unknown>;
  const url = requiredString(item.url, 2048);
  try { new URL(url); } catch { throw new Error("INVALID_BACKUP"); }
  return {
    id: requiredString(item.id, 160), userId: requiredString(item.userId, 160), kind: enumValue(item.kind, ["tool", "site", "server"]),
    name: requiredString(item.name, 80), url, description: String(item.description ?? "").slice(0, 180), category: requiredString(item.category, 40),
    status: enumValue(item.status, ["online", "warning", "offline", "unknown"]), note: String(item.note ?? "").slice(0, 240), pinned: Boolean(item.pinned),
    cpuUsage: finiteNumber(item.cpuUsage), temperature: finiteNumber(item.temperature), memoryUsage: finiteNumber(item.memoryUsage), diskUsage: finiteNumber(item.diskUsage),
    agentUrl: String(item.agentUrl ?? "").slice(0, 240), createdAt: finiteNumber(item.createdAt), updatedAt: finiteNumber(item.updatedAt),
  };
}
