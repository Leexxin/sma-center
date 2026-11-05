import { getRawDb } from "./index";
import {
  builtinCards,
  parseCardPackage,
  type CardDefinition,
} from "../lib/card-package";
export async function listCardDefinitions(
  userId: string,
): Promise<CardDefinition[]> {
  const rows = await getRawDb()
    .prepare(
      "SELECT manifest,revision FROM card_definitions WHERE user_id=? ORDER BY updated_at,id",
    )
    .bind(userId)
    .all<{ manifest: string; revision: number }>();
  const overrides = rows.results.map((r) => ({
    ...parseCardPackage(JSON.parse(r.manifest)),
    revision: r.revision,
    builtin: builtinCards.some((b) => b.id === JSON.parse(r.manifest).id),
  }));
  return [
    ...builtinCards.map((b) => overrides.find((o) => o.id === b.id) || b),
    ...overrides.filter((o) => !o.builtin),
  ];
}
export async function saveCardDefinition(
  userId: string,
  manifest: unknown,
  revision: number,
) {
  const p = parseCardPackage(manifest);
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error("INVALID_REVISION");
  const reserved = builtinCards.find((b) => b.id === p.id);
  if (p.id.startsWith("sma.") && !reserved)
    throw new Error("sma. 前缀为系统保留。");
  if (reserved && p.renderer !== reserved.renderer)
    throw new Error("系统卡片不能更换呈现类型，请另建插件。");
  const db = getRawDb();
  const result = await db
    .prepare(
      `INSERT INTO card_definitions(user_id,id,manifest,revision,updated_at) SELECT ?,?,?,1,? WHERE ?=0 AND (SELECT COUNT(*) FROM card_definitions WHERE user_id=?)<100
 ON CONFLICT(user_id,id) DO UPDATE SET manifest=excluded.manifest,revision=card_definitions.revision+1,updated_at=excluded.updated_at WHERE card_definitions.revision=?`,
    )
    .bind(
      userId,
      p.id,
      JSON.stringify(p),
      Date.now(),
      revision,
      userId,
      revision,
    )
    .run();
  // An existing row needs UPDATE when the insert's SELECT is deliberately empty.
  if (!result.meta.changes && revision > 0) {
    const r = await db
      .prepare(
        "UPDATE card_definitions SET manifest=?,revision=revision+1,updated_at=? WHERE user_id=? AND id=? AND revision=?",
      )
      .bind(JSON.stringify(p), Date.now(), userId, p.id, revision)
      .run();
    if (!r.meta.changes) throw new Error("CARD_CONFLICT");
  } else if (!result.meta.changes) throw new Error("CARD_CONFLICT");
  return (await listCardDefinitions(userId)).find((d) => d.id === p.id)!;
}
export async function deleteCardDefinition(
  userId: string,
  id: string,
  revision: number,
) {
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new Error("INVALID_REVISION");
  const db = getRawDb();
  if (!builtinCards.some((b) => b.id === id)) {
    const boards = await db
      .prepare("SELECT widgets FROM dashboards WHERE user_id=?")
      .bind(userId)
      .all<{ widgets: string }>();
    if (
      boards.results.some((b) =>
        (JSON.parse(b.widgets) as { pluginId?: string }[]).some(
          (w) => w.pluginId === id,
        ),
      )
    )
      throw new Error("卡片仍被面板引用，请先移除相关卡片。");
  }
  const result = await db
    .prepare(
      "DELETE FROM card_definitions WHERE user_id=? AND id=? AND revision=? AND (id LIKE 'sma.%' OR NOT EXISTS(SELECT 1 FROM dashboards b,json_each(b.widgets) w WHERE b.user_id=card_definitions.user_id AND json_extract(w.value,'$.pluginId')=card_definitions.id))",
    )
    .bind(userId, id, revision)
    .run();
  if (!result.meta.changes) throw new Error("CARD_CONFLICT");
}
