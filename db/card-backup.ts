import { getRawDb } from "./index";
import {
  parseCardPackage,
  parseCardState,
  type CardPackage,
  type CardState,
} from "../lib/card-package";
export type CardBackup = {
  cardDefinitions?: {
    userId: string;
    manifest: CardPackage;
    revision: number;
    updatedAt: number;
  }[];
  cardStates?: {
    userId: string;
    boardId: string;
    widgetId: string;
    state: CardState;
    revision: number;
    updatedAt: number;
  }[];
};
export async function exportCards(): Promise<CardBackup> {
  const db = getRawDb();
  const definitions = await db
    .prepare(
      "SELECT user_id AS userId,manifest,revision,updated_at AS updatedAt FROM card_definitions ORDER BY user_id,id",
    )
    .all<{
      userId: string;
      manifest: string;
      revision: number;
      updatedAt: number;
    }>();
  const states = await db
    .prepare(
      "SELECT user_id AS userId,board_id AS boardId,widget_id AS widgetId,state,revision,updated_at AS updatedAt FROM card_states ORDER BY board_id,widget_id",
    )
    .all<{
      userId: string;
      boardId: string;
      widgetId: string;
      state: string;
      revision: number;
      updatedAt: number;
    }>();
  return {
    cardDefinitions: definitions.results.map((r) => ({
      ...r,
      manifest: parseCardPackage(JSON.parse(r.manifest)),
    })),
    cardStates: states.results.map((r) => ({
      ...r,
      state: parseCardState(JSON.parse(r.state)),
    })),
  };
}
export function parseCardBackup(
  raw: Record<string, unknown>,
  owners: Set<string>,
  boards?: {
    id: string;
    userId: string;
    widgets: { id: string; type: string }[];
  }[],
): CardBackup {
  const result: CardBackup = {};
  const keys = new Set<string>();
  const counts = new Map<string, number>();
  if (raw.cardDefinitions !== undefined) {
    if (
      !Array.isArray(raw.cardDefinitions) ||
      raw.cardDefinitions.length > 10000
    )
      throw new Error("INVALID_BACKUP");
    result.cardDefinitions = raw.cardDefinitions.map((r) => {
      const p = r as NonNullable<CardBackup["cardDefinitions"]>[number];
      const manifest = parseCardPackage(p.manifest);
      if (
        !owners.has(p.userId) ||
        keys.has(p.userId + ":" + manifest.id) ||
        !Number.isSafeInteger(p.revision) ||
        p.revision < 0 ||
        !Number.isSafeInteger(p.updatedAt) ||
        p.updatedAt < 0 ||
        (counts.get(p.userId) || 0) >= 100
      )
        throw new Error("INVALID_BACKUP");
      keys.add(p.userId + ":" + manifest.id);
      counts.set(p.userId, (counts.get(p.userId) || 0) + 1);
      return {
        userId: p.userId,
        manifest,
        revision: p.revision,
        updatedAt: p.updatedAt,
      };
    });
  }
  if (raw.cardStates !== undefined) {
    if (!Array.isArray(raw.cardStates) || raw.cardStates.length > 720000)
      throw new Error("INVALID_BACKUP");
    keys.clear();
    result.cardStates = raw.cardStates.map((r) => {
      const p = r as NonNullable<CardBackup["cardStates"]>[number];
      if (
        !owners.has(p.userId) ||
        !boards?.some(
          (b) =>
            b.id === p.boardId &&
            b.userId === p.userId &&
            b.widgets.some((w) => w.id === p.widgetId && w.type === "plugin"),
        ) ||
        keys.has(p.boardId + ":" + p.widgetId) ||
        !Number.isSafeInteger(p.revision) ||
        p.revision < 0 ||
        !Number.isSafeInteger(p.updatedAt) ||
        p.updatedAt < 0
      )
        throw new Error("INVALID_BACKUP");
      keys.add(p.boardId + ":" + p.widgetId);
      return {
        userId: p.userId,
        boardId: p.boardId,
        widgetId: p.widgetId,
        state: parseCardState(p.state),
        revision: p.revision,
        updatedAt: p.updatedAt,
      };
    });
  }
  return result;
}
export function cardRestoreStatements(backup: CardBackup) {
  const db = getRawDb();
  return [
    ...(backup.cardDefinitions || []).map((d) =>
      db
        .prepare(
          "INSERT INTO card_definitions(user_id,id,manifest,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET manifest=excluded.manifest,revision=card_definitions.revision+1,updated_at=excluded.updated_at",
        )
        .bind(
          d.userId,
          d.manifest.id,
          JSON.stringify(d.manifest),
          Math.max(1, d.revision),
          d.updatedAt,
        ),
    ),
    ...(backup.cardStates || []).map((s) =>
      db
        .prepare(
          "INSERT INTO card_states(board_id,widget_id,user_id,state,revision,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(board_id,widget_id) DO UPDATE SET state=excluded.state,revision=card_states.revision+1,updated_at=excluded.updated_at",
        )
        .bind(
          s.boardId,
          s.widgetId,
          s.userId,
          JSON.stringify(s.state),
          Math.max(1, s.revision),
          s.updatedAt,
        ),
    ),
  ];
}
