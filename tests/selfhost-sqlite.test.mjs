import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ATLAS_DATA_DIR = mkdtempSync(join(tmpdir(), 'atlas-sqlite-test-'));
const { env: { DB } } = await import('../deploy/sqlite-env.mjs');

test('all schema migrations are applied exactly once', async () => {
  const rows = await DB.prepare('SELECT name FROM atlas_migrations').all();
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
