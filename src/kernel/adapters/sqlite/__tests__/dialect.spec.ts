/**
 * `NodeSqliteDialect` driver contract (2026-08 perf sprint additions):
 *
 *   - AST-based dispatch: builder-produced queries route by
 *     `query.query.kind` (SELECT -> `.all()`, DML -> `.run()`, DML with
 *     a structural `returning` field -> `.all()` + row-count), and RAW
 *     statements (PRAGMAs, checkpoints) fall back to string sniffing.
 *   - Prepared-statement LRU cache: identical SQL text is prepared
 *     once; the cache caps at 64 entries and evicts the least recently
 *     used statement, which is re-prepared on its next use.
 *   - `destroy()` clears the cache and closes the DB.
 *
 * Tests construct the concrete driver directly (the sanctioned
 * exception for asserting implementation internals) and hand-craft
 * `CompiledQuery` objects, the driver only reads `query.kind` /
 * `query.returning`, `sql`, and `parameters`.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import type { CompiledQuery, DatabaseConnection, Driver } from 'kysely';
import type { DatabaseSync } from 'node:sqlite';

import { NodeSqliteDialect } from '../dialect.js';

let root: string;
let counter = 0;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'sm-dialect-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

/** node:sqlite rows carry a null prototype; normalise for deepEqual. */
function plainRows(rows: readonly unknown[]): Record<string, unknown>[] {
  return rows.map((r) => ({ ...(r as Record<string, unknown>) }));
}

/** Hand-craft the minimal `CompiledQuery` surface the driver consumes. */
function cq(
  sql: string,
  parameters: readonly unknown[] = [],
  kind = 'RawNode',
  extra: Record<string, unknown> = {},
): CompiledQuery {
  return { query: { kind, ...extra }, sql, parameters } as unknown as CompiledQuery;
}

interface IHarness {
  driver: Driver;
  conn: DatabaseConnection;
  /** Times `db.prepare` ran for a given SQL text. */
  prepares: (sql: string) => number;
  close: () => Promise<void>;
}

async function bootDriver(label: string): Promise<IHarness> {
  counter += 1;
  const path = join(root, `${label}-${counter}.db`);
  const prepareCounts = new Map<string, number>();
  const dialect = new NodeSqliteDialect({
    databasePath: path,
    onCreateConnection(db: DatabaseSync) {
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
      // Shadow the instance's `prepare` to count per-SQL compilations;
      // a statement-cache hit must not reach this wrapper.
      const original = db.prepare.bind(db);
      (db as { prepare: DatabaseSync['prepare'] }).prepare = (sql: string) => {
        prepareCounts.set(sql, (prepareCounts.get(sql) ?? 0) + 1);
        return original(sql);
      };
    },
  });
  const driver = dialect.createDriver();
  await driver.init();
  const conn = await driver.acquireConnection();
  return {
    driver,
    conn,
    prepares: (sql) => prepareCounts.get(sql) ?? 0,
    close: async () => {
      await driver.releaseConnection(conn);
      await driver.destroy();
    },
  };
}

describe('NodeSqliteDialect, AST dispatch', () => {
  it('routes builder kinds correctly and RETURNING yields rows + count', async () => {
    const h = await bootDriver('dispatch');
    try {
      const ins = await h.conn.executeQuery(
        cq('INSERT INTO t (id, v) VALUES (?, ?)', [1, 'one'], 'InsertQueryNode'),
      );
      assert.equal(ins.numAffectedRows, 1n, 'plain DML reports affected rows');
      assert.deepEqual(ins.rows, [], 'plain DML yields no rows');

      const sel = await h.conn.executeQuery(
        cq('SELECT id, v FROM t ORDER BY id', [], 'SelectQueryNode'),
      );
      assert.deepEqual(plainRows(sel.rows), [{ id: 1, v: 'one' }], 'SELECT routes through .all()');

      const upd = await h.conn.executeQuery(
        cq('UPDATE t SET v = ? WHERE id = ? RETURNING id, v', ['uno', 1], 'UpdateQueryNode', {
          returning: {},
        }),
      );
      assert.deepEqual(plainRows(upd.rows), [{ id: 1, v: 'uno' }], 'structural returning routes through .all()');
      assert.equal(upd.numAffectedRows, 1n, 'RETURNING DML reports the returned-row count');
    } finally {
      await h.close();
    }
  });

  it('raw statements fall back to string sniffing', async () => {
    const h = await bootDriver('raw');
    try {
      await h.conn.executeQuery(cq('INSERT INTO t (id, v) VALUES (?, ?)', [7, 'seven']));
      const sel = await h.conn.executeQuery(cq('SELECT v FROM t WHERE id = ?', [7]));
      assert.deepEqual(plainRows(sel.rows), [{ v: 'seven' }], 'raw SELECT still reads rows');

      // A PRAGMA is neither SELECT/WITH nor RETURNING: the write path
      // (`.run()`) must accept it without throwing.
      const pragma = await h.conn.executeQuery(cq('PRAGMA user_version'));
      assert.deepEqual(pragma.rows, [], 'raw PRAGMA takes the write path');
    } finally {
      await h.close();
    }
  });
});

describe('NodeSqliteDialect, statement cache', () => {
  it('prepares identical SQL once and evicts least-recently-used past the cap', async () => {
    const h = await bootDriver('lru');
    try {
      const first = 'SELECT 999 AS n';
      await h.conn.executeQuery(cq(first, [], 'SelectQueryNode'));
      await h.conn.executeQuery(cq(first, [], 'SelectQueryNode'));
      assert.equal(h.prepares(first), 1, 'identical SQL is prepared once');

      // 64 distinct fillers push the cache to its cap; inserting the
      // 65th distinct entry evicts `first` (the oldest).
      for (let i = 0; i < 64; i += 1) {
        await h.conn.executeQuery(cq(`SELECT ${i} AS n`, [], 'SelectQueryNode'));
      }
      await h.conn.executeQuery(cq(first, [], 'SelectQueryNode'));
      assert.equal(h.prepares(first), 2, 'an evicted statement is re-prepared on next use');

      // The most recent filler survived the eviction churn.
      await h.conn.executeQuery(cq('SELECT 63 AS n', [], 'SelectQueryNode'));
      assert.equal(h.prepares('SELECT 63 AS n'), 1, 'a recently-used statement stays cached');
    } finally {
      await h.close();
    }
  });

  it('destroy() clears the cache and closes the DB', async () => {
    const h = await bootDriver('destroy');
    await h.conn.executeQuery(cq('SELECT 1 AS n', [], 'SelectQueryNode'));
    await h.driver.releaseConnection(h.conn);
    await h.driver.destroy();
    await assert.rejects(
      async () => h.conn.executeQuery(cq('SELECT 1 AS n', [], 'SelectQueryNode')),
      'a destroyed driver must not serve queries',
    );
  });
});
