import { getRawDb } from "./index";
import {
  parseWidgets,
  starterWidgets,
  type Board,
  type Widget,
} from "../lib/workspace-model";
type Row = {
  id: string;
  name: string;
  revision: number;
  widgets: string;
  created_at: number;
  updated_at: number;
};
function map(row: Row): Board {
  return {
    id: row.id,
    name: row.name,
    revision: row.revision,
    widgets: parseWidgets(JSON.parse(row.widgets)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export async function listBoards(
  userId: string,
  resources: Array<{ id: string; kind: string }>,
): Promise<Board[]> {
  const db = getRawDb();
  // The stable default id and INSERT OR IGNORE make concurrent first requests safe.
  const now = Date.now();
  await db
    .prepare(
      `INSERT OR IGNORE INTO dashboards (id, user_id, name, revision, widgets, created_at, updated_at)
    SELECT ?, ?, '总览', 0, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM dashboards WHERE user_id = ?)`,
    )
    .bind(
      `default:${userId}`,
      userId,
      JSON.stringify(starterWidgets(resources)),
      now,
      now,
      userId,
    )
    .run();
  const result = await db
    .prepare(
      "SELECT * FROM dashboards WHERE user_id = ? ORDER BY created_at, id",
    )
    .bind(userId)
    .all<Row>();
  return result.results.map(map);
}
export async function writeBoard(
  userId: string,
  id: string | null,
  input: { name: string; revision: number; widgets: Widget[] },
) {
  const db = getRawDb();
  // Missing legacy bindings can be retained, but never accept another owner's resource.
  for (const resourceId of new Set(
    input.widgets.map((w) => w.resourceId).filter(Boolean),
  )) {
    const found = await db
      .prepare("SELECT user_id FROM resources WHERE id = ?")
      .bind(resourceId)
      .first<{ user_id: string }>();
    if (found && found.user_id !== userId) throw new Error("INVALID_RESOURCE");
    if (!found) {
      const previous = id
        ? await db
            .prepare(
              "SELECT widgets FROM dashboards WHERE id = ? AND user_id = ?",
            )
            .bind(id, userId)
            .first<{ widgets: string }>()
        : null;
      if (
        !previous ||
        !parseWidgets(JSON.parse(previous.widgets)).some(
          (w) => w.resourceId === resourceId,
        )
      )
        throw new Error("INVALID_RESOURCE");
    }
  }
  const now = Date.now();
  if (!id) {
    id = crypto.randomUUID();
    const result = await db
      .prepare(
        `INSERT INTO dashboards (id, user_id, name, revision, widgets, created_at, updated_at)
      SELECT ?, ?, ?, 0, ?, ?, ? WHERE (SELECT COUNT(*) FROM dashboards WHERE user_id = ?) < 12`,
      )
      .bind(
        id,
        userId,
        input.name,
        JSON.stringify(input.widgets),
        now,
        now,
        userId,
      )
      .run();
    if (!result.meta.changes) throw new Error("BOARD_LIMIT");
  } else {
    const result = await db
      .prepare(
        "UPDATE dashboards SET name = ?, widgets = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ?",
      )
      .bind(
        input.name,
        JSON.stringify(input.widgets),
        now,
        id,
        userId,
        input.revision,
      )
      .run();
    if (!result.meta.changes) throw new Error("BOARD_CONFLICT");
  }
  return map(
    (await db
      .prepare("SELECT * FROM dashboards WHERE id = ? AND user_id = ?")
      .bind(id, userId)
      .first<Row>())!,
  );
}
export async function removeBoard(
  userId: string,
  id: string,
  revision: number,
) {
  const result = await getRawDb()
    .prepare(
      `DELETE FROM dashboards WHERE id = ? AND user_id = ? AND revision = ? AND
    (SELECT COUNT(*) FROM dashboards WHERE user_id = ?) > 1`,
    )
    .bind(id, userId, revision, userId)
    .run();
  if (!result.meta.changes) throw new Error("BOARD_CONFLICT");
}
