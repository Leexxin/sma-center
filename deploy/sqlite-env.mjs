import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.env.SMA_CENTER_DATA_DIR || process.env.ATLAS_DATA_DIR || '/data';
mkdirSync(directory, { recursive: true });
// Rename the legacy database and its journal together before opening a connection.
if (!existsSync(join(directory, 'sma-center.sqlite')) && existsSync(join(directory, 'atlas.sqlite'))) {
  for (const suffix of ['', '-wal', '-shm']) {
    const legacy = join(directory, 'atlas.sqlite' + suffix);
    if (existsSync(legacy)) renameSync(legacy, join(directory, 'sma-center.sqlite' + suffix));
  }
}
const sqlite = new DatabaseSync(join(directory, 'sma-center.sqlite'));
sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
if (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='atlas_migrations'").get() && !sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sma_center_migrations'").get()) sqlite.exec('ALTER TABLE atlas_migrations RENAME TO sma_center_migrations');
sqlite.exec('CREATE TABLE IF NOT EXISTS sma_center_migrations (name TEXT PRIMARY KEY NOT NULL)');
const migrations = join(process.cwd(), 'drizzle');
for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql')).sort()) {
  if (sqlite.prepare('SELECT name FROM sma_center_migrations WHERE name=?').get(name)) continue;
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    sqlite.exec(readFileSync(join(migrations, name), 'utf8'));
    sqlite.prepare('INSERT INTO sma_center_migrations VALUES (?)').run(name);
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
};
