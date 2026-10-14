import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.env.ATLAS_DATA_DIR || '/data';
mkdirSync(directory, { recursive: true });
const sqlite = new DatabaseSync(join(directory, 'atlas.sqlite'));
sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
sqlite.exec('CREATE TABLE IF NOT EXISTS atlas_migrations (name TEXT PRIMARY KEY NOT NULL)');
const migrations = join(process.cwd(), 'drizzle');
for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql')).sort()) {
  if (sqlite.prepare('SELECT name FROM atlas_migrations WHERE name=?').get(name)) continue;
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    sqlite.exec(readFileSync(join(migrations, name), 'utf8'));
    sqlite.prepare('INSERT INTO atlas_migrations VALUES (?)').run(name);
    sqlite.exec('COMMIT');
  } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
}
class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  async first(column) {
    const row = sqlite.prepare(this.sql).get(...this.values);
    return row ? (column ? row[column] : { ...row }) : null;
  }
  all() {
    return { success: true, results: sqlite.prepare(this.sql).all(...this.values).map(r => ({ ...r })), meta: {} };
  }
  run() {
    const result = sqlite.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  async raw(options) {
    const stmt = sqlite.prepare(this.sql);
    const names = stmt.columns().map(c => c.name);
    stmt.setReturnArrays(true);
    const rows = stmt.all(...this.values);
    return options?.columnNames ? [names, ...rows] : rows;
  }
}
const DB = {
  prepare: sql => new Statement(sql),
  async batch(statements) {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) {
        const stmt = sqlite.prepare(statement.sql);
        if (stmt.columns().length) results.push(statement.all());
        else results.push(statement.run());
      }
      sqlite.exec('COMMIT');
      return results;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
  async exec(sql) { sqlite.exec(sql); return { count: 1, duration: 0 }; },
};
export const env = {
  DB,
  SMA_CREDENTIAL_KEY: process.env.SMA_CREDENTIAL_KEY,
  ATLAS_ADMIN_EMAILS: process.env.ATLAS_ADMIN_EMAILS || 'admin@atlas.local',
};
