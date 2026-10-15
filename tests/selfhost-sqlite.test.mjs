import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SMA_CENTER_DATA_DIR = mkdtempSync(join(tmpdir(), 'sma-center-sqlite-test-'));
const { env: { DB } } = await import('../deploy/sqlite-env.mjs');

test('all schema migrations are applied exactly once', async () => {
  const rows = await DB.prepare('SELECT name FROM sma_center_migrations').all();
  assert.equal(rows.results.length, 7);
  const tables = await DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  for (const name of ['resources', 'users', 'user_preferences', 'agent_credentials']) assert.ok(tables.results.some(r => r.name === name));
});
test('a failing batch rolls back all writes', async () => {
  await DB.exec('CREATE TABLE test_atomic (id TEXT PRIMARY KEY)');
  await assert.rejects(DB.batch([
    DB.prepare('INSERT INTO test_atomic VALUES (?)').bind('a'),
    DB.prepare('INSERT INTO test_atomic VALUES (?)').bind('a'),
  ]));
  assert.equal((await DB.prepare('SELECT * FROM test_atomic').all()).results.length, 0);
});
test('bindings, raw rows, first-column and parallel batches work', async () => {
  await Promise.all(['a', 'b'].map(id => DB.batch([DB.prepare('INSERT INTO test_atomic VALUES (?)').bind(id)])));
  assert.equal(await DB.prepare('SELECT id FROM test_atomic WHERE id=?').bind('a').first('id'), 'a');
  assert.deepEqual(await DB.prepare('SELECT id FROM test_atomic ORDER BY id').raw({ columnNames: true }), [['id'], ['a'], ['b']]);
});
test('legacy database migration keeps user data and does not replay migrations', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sma-center-legacy-test-'));
  const legacy = new DatabaseSync(join(directory, 'atlas.sqlite'));
  legacy.exec('CREATE TABLE atlas_migrations (name TEXT PRIMARY KEY NOT NULL)');
  for (const name of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) {
    legacy.exec(readFileSync(join('drizzle', name), 'utf8'));
    legacy.prepare('INSERT INTO atlas_migrations VALUES (?)').run(name);
  }
  legacy.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)').run('existing-user', 'user@example.com', 'Existing user', 1, 2);
  legacy.close();
  const previous = process.env.SMA_CENTER_DATA_DIR;
  process.env.SMA_CENTER_DATA_DIR = directory;
  try {
    const migrated = (await import('../deploy/sqlite-env.mjs?legacy-migration')).env.DB;
    assert.equal(await migrated.prepare('SELECT display_name FROM users WHERE user_id=?').bind('existing-user').first('display_name'), 'Existing user');
    assert.equal((await migrated.prepare('SELECT * FROM sma_center_migrations').all()).results.length, 7);
    assert.ok(existsSync(join(directory, 'sma-center.sqlite')));
    assert.ok(!existsSync(join(directory, 'atlas.sqlite')));
  } finally { process.env.SMA_CENTER_DATA_DIR = previous; }
});
