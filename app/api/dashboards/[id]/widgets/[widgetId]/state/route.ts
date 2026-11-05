import { getOwner } from "@/app/auth";
import { getRawDb } from "@/db/index";
import { parseWidgets } from "@/lib/workspace-model";
import { parseCardState } from "@/lib/card-package";
import { listCardDefinitions } from "@/db/card-definitions";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; widgetId: string }> };
async function locate(context: Context) {
  const owner = await getOwner();
  if (!owner)
    return { error: Response.json({ error: "请先登录。" }, { status: 401 }) };
  const { id, widgetId } = await context.params;
  const db = getRawDb();
  const board = await db
    .prepare("SELECT widgets FROM dashboards WHERE id=? AND user_id=?")
    .bind(id, owner.userId)
    .first<{ widgets: string }>();
  const widget =
    board &&
    parseWidgets(JSON.parse(board.widgets)).find((w) => w.id === widgetId);
  const def =
    widget &&
    (await listCardDefinitions(owner.userId)).find(
      (d) => d.id === widget.pluginId,
    );
  if (!def || !["memo", "todo"].includes(def.renderer))
    return {
      error: Response.json(
        { error: "卡片不存在或不支持保存内容。" },
        { status: 404 },
      ),
    };
  return { db, userId: owner.userId, id, widgetId };
}
export async function GET(_request: Request, context: Context) {
  const c = await locate(context);
  if (c.error) return c.error;
  const row = await c
    .db!.prepare(
      "SELECT state,revision FROM card_states WHERE board_id=? AND widget_id=? AND user_id=?",
    )
    .bind(c.id, c.widgetId, c.userId)
    .first<{ state: string; revision: number }>();
  return Response.json(
    row
      ? { state: JSON.parse(row.state), revision: row.revision }
      : { state: {}, revision: 0 },
  );
}
export async function PUT(request: Request, context: Context) {
  const c = await locate(context);
  if (c.error) return c.error;
  try {
    const text = await request.text();
    if (text.length > 64000) throw new Error();
    const raw = JSON.parse(text);
    if (!Number.isSafeInteger(raw.revision) || raw.revision < 0)
      throw new Error();
    const state = parseCardState(raw.state);
    const result = await c
      .db!.prepare(
        `INSERT INTO card_states(board_id,widget_id,user_id,state,revision,updated_at) SELECT ?,?,?,?,1,? WHERE ?=0 AND EXISTS (SELECT 1 FROM dashboards b,json_each(b.widgets) w WHERE b.id=? AND b.user_id=? AND json_extract(w.value,'$.id')=?) ON CONFLICT(board_id,widget_id) DO UPDATE SET state=excluded.state,revision=card_states.revision+1,updated_at=excluded.updated_at WHERE card_states.user_id=? AND card_states.revision=?`,
      )
      .bind(
        c.id,
        c.widgetId,
        c.userId,
        JSON.stringify(state),
        Date.now(),
        raw.revision,
        c.id,
        c.userId,
        c.widgetId,
        c.userId,
        raw.revision,
      )
      .run();
    if (!result.meta.changes && raw.revision > 0) {
      const r = await c
        .db!.prepare(
          "UPDATE card_states SET state=?,revision=revision+1,updated_at=? WHERE board_id=? AND widget_id=? AND user_id=? AND revision=? AND EXISTS(SELECT 1 FROM dashboards b,json_each(b.widgets) w WHERE b.id=card_states.board_id AND b.user_id=card_states.user_id AND json_extract(w.value,'$.id')=card_states.widget_id)",
        )
        .bind(
          JSON.stringify(state),
          Date.now(),
          c.id,
          c.widgetId,
          c.userId,
          raw.revision,
        )
        .run();
      if (!r.meta.changes)
        return Response.json(
          { error: "内容已在其他页面更新，请重新载入。" },
          { status: 409 },
        );
    } else if (!result.meta.changes)
      return Response.json(
        { error: "内容已在其他页面更新，请重新载入。" },
        { status: 409 },
      );
    return Response.json({ state, revision: raw.revision + 1 });
  } catch {
    return Response.json({ error: "内容格式无效。" }, { status: 400 });
  }
}
