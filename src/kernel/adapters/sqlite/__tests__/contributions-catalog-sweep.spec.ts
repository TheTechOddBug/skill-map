/**
 * Catalog sweep of `replaceAllScanContributions` (2026-08 perf sprint
 * rework): rows whose qualified id left the runtime catalog are dropped
 * with one grouped `IN` DELETE per `(pluginId, extensionId)` instead of
 * one DELETE per row. Behavior pinned here, independent of the grouping
 * mechanics:
 *
 *   - dead ids are dropped across MULTIPLE groups in one sweep,
 *     including a group where several ids die together;
 *   - registered ids survive untouched;
 *   - an EMPTY registered-keys set disables the sweep entirely (the
 *     legacy-caller guard).
 *
 * Uses temp file-based SQLite DBs (`:memory:` is broken per
 * `feedback_sqlite_in_memory_workaround.md`).
 */

import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Kysely, CamelCasePlugin } from 'kysely';

import {
  replaceAllScanContributions,
  type IContributionRecord,
} from '../contributions.js';
import { NodeSqliteDialect } from '../dialect.js';
import { applyMigrations, discoverMigrations } from '../migrations.js';
import type { IDatabase } from '../schema.js';

let root: string;
let counter = 0;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'sm-contrib-sweep-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

interface IDbHandle {
  db: Kysely<IDatabase>;
  close: () => Promise<void>;
}

async function bootDb(label: string): Promise<IDbHandle> {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'skill-map.db');
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(path);
  applyMigrations(raw, path, undefined, discoverMigrations());
  raw.close();
  const dialect = new NodeSqliteDialect({ databasePath: path });
  const db = new Kysely<IDatabase>({ dialect, plugins: [new CamelCasePlugin()] });
  return {
    db,
    async close() {
      await db.destroy();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const NODE = 'skills/host.md';
const LIVE = new Set([NODE]);

function record(pluginId: string, extensionId: string, contributionId: string): IContributionRecord {
  return {
    pluginId,
    extensionId,
    nodePath: NODE,
    contributionId,
    slot: 'card.footer.left',
    payload: { value: 1 },
    emittedAt: 1_000,
  };
}

const keyOf = (r: IContributionRecord): string =>
  `${r.pluginId}/${r.extensionId}/${r.contributionId}`;

async function listIds(db: Kysely<IDatabase>): Promise<string[]> {
  const rows = await db
    .selectFrom('scan_contributions')
    .select(['pluginId', 'extensionId', 'contributionId'])
    .execute();
  return rows.map((r) => `${r.pluginId}/${r.extensionId}/${r.contributionId}`).sort();
}

describe('replaceAllScanContributions, catalog sweep', () => {
  it('drops dead ids across multiple (plugin, extension) groups in one sweep', async () => {
    const handle = await bootDb('grouped');
    try {
      // Seed five contributions spanning three groups: pluginA/extA
      // (two ids), pluginA/extB (two ids, BOTH will die together), and
      // pluginB/extA (one id).
      const seeded = [
        record('plugin-a', 'ext-a', 'kept-a'),
        record('plugin-a', 'ext-a', 'dead-a'),
        record('plugin-a', 'ext-b', 'dead-b1'),
        record('plugin-a', 'ext-b', 'dead-b2'),
        record('plugin-b', 'ext-a', 'kept-b'),
      ];
      await handle.db
        .transaction()
        .execute((trx) => replaceAllScanContributions(trx, seeded, LIVE, new Set(), new Set()));
      assert.equal((await listIds(handle.db)).length, 5, 'seed persisted');

      // Sweep with a catalog that keeps one id in each surviving group.
      const registered = new Set([keyOf(seeded[0]!), keyOf(seeded[4]!)]);
      await handle.db
        .transaction()
        .execute((trx) => replaceAllScanContributions(trx, [], LIVE, registered, new Set()));

      assert.deepEqual(
        await listIds(handle.db),
        ['plugin-a/ext-a/kept-a', 'plugin-b/ext-a/kept-b'],
        'dead ids dropped across all groups (incl. a fully-dead group), registered ids survive',
      );
    } finally {
      await handle.close();
    }
  });

  it('an empty registered-keys set disables the sweep', async () => {
    const handle = await bootDb('legacy-guard');
    try {
      const seeded = [record('plugin-a', 'ext-a', 'c1'), record('plugin-a', 'ext-b', 'c2')];
      await handle.db
        .transaction()
        .execute((trx) => replaceAllScanContributions(trx, seeded, LIVE, new Set(), new Set()));

      await handle.db
        .transaction()
        .execute((trx) => replaceAllScanContributions(trx, [], LIVE, new Set(), new Set()));
      assert.equal(
        (await listIds(handle.db)).length,
        2,
        'no catalog supplied means no catalog sweep',
      );
    } finally {
      await handle.close();
    }
  });
});
