/**
 * Pollution-defence storage tests (audit M3). Two read boundaries
 * round-trip JSON written by `JSON.stringify` and fed back into the
 * runtime via `JSON.parse`:
 *
 *   - `loadNodeEnrichments` → `parseJsonObject(row.valueJson)` →
 *     `IPersistedEnrichment.value` flows into the read-time
 *     `mergeNodeWithEnrichments`.
 *   - `loadContributionsForNode` / `loadContributionsForPaths` /
 *     `loadContributionLookup` → `rowToContribution.payload` flows
 *     into the BFF / UI / future deep-merge consumers.
 *
 * AJV at emit time does not necessarily forbid `__proto__` /
 * `constructor` / `prototype`; a plugin (today the in-tree set, but
 * the surface is open to user plugins via the manifest registry)
 * could legitimately emit one of those names on the inner shape and
 * the schema would let it through. The strip happens at the LOAD
 * boundary so neither read surface returns an object that carries a
 * forbidden key at any depth.
 *
 * Uses temp file-based SQLite DBs (`mkdtempSync`), `:memory:` is
 * broken per `feedback_sqlite_in_memory_workaround.md`.
 */

import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Kysely, CamelCasePlugin } from 'kysely';

import {
  loadContributionsForNode,
  loadContributionsForPaths,
  loadContributionLookup,
} from '../kernel/adapters/sqlite/contributions.js';
import { NodeSqliteDialect } from '../kernel/adapters/sqlite/dialect.js';
import {
  applyMigrations,
  discoverMigrations,
} from '../kernel/adapters/sqlite/migrations.js';
import { loadNodeEnrichments } from '../kernel/adapters/sqlite/scan-load.js';
import type { IDatabase } from '../kernel/adapters/sqlite/schema.js';

let root: string;
let counter = 0;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'sm-pollution-storage-'));
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
  raw.exec('PRAGMA foreign_keys = ON');
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

describe('loadNodeEnrichments pollution defence (audit M3)', () => {
  it('strips __proto__ / constructor / prototype at every depth on reload', async () => {
    const handle = await bootDb('enrichments');
    try {
      // Bypass AJV: write the row directly with a hostile nested shape.
      // The encoded JSON carries the forbidden names at multiple depths.
      const a64 = 'a'.repeat(64);
      const valueJson = JSON.stringify({
        title: 'ok',
        // Root-level forbidden name (caught by the historic shallow
        // filter too) plus a nested one (the M3 surface).
        __proto__: { polluted: 'root' },
        meta: {
          __proto__: { polluted: 'nested' },
          fine: 'keep-me',
          deeper: {
            constructor: { hijack: true },
            ok: 'yes',
          },
        },
        arr: [
          { __proto__: { bad: 1 }, inside: 'still-here' },
        ],
      });
      await handle.db
        .insertInto('node_enrichments')
        .values({
          nodePath: 'a.md',
          extractorId: 'test/probe',
          bodyHashAtEnrichment: a64,
          valueJson,
          stale: 0,
          enrichedAt: 100,
          isProbabilistic: 0,
        })
        .execute();

      const rows = await loadNodeEnrichments(handle.db, 'a.md');
      assert.equal(rows.length, 1);
      const value = rows[0]!.value as Record<string, unknown>;

      // Title preserved; root __proto__ stripped.
      assert.equal(value['title'], 'ok');
      assert.equal(Object.prototype.hasOwnProperty.call(value, '__proto__'), false);
      // Nested meta: __proto__ gone, legitimate sibling stays.
      const meta = value['meta'] as Record<string, unknown>;
      assert.equal(meta['fine'], 'keep-me');
      assert.equal(Object.prototype.hasOwnProperty.call(meta, '__proto__'), false);
      // Deeper.constructor gone; safe sibling stays.
      const deeper = meta['deeper'] as Record<string, unknown>;
      assert.equal(deeper['ok'], 'yes');
      assert.equal(Object.prototype.hasOwnProperty.call(deeper, 'constructor'), false);
      // Array element loses __proto__ but keeps its sibling.
      const arr = value['arr'] as Record<string, unknown>[];
      assert.equal(arr[0]!['inside'], 'still-here');
      assert.equal(Object.prototype.hasOwnProperty.call(arr[0]!, '__proto__'), false);
      // Object.prototype itself is clean.
      assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
      assert.equal(({} as Record<string, unknown>)['bad'], undefined);
      assert.equal(({} as Record<string, unknown>)['hijack'], undefined);
    } finally {
      await handle.close();
    }
  });
});

describe('loadContributionsForNode pollution defence (audit M3)', () => {
  it('strips __proto__ / constructor / prototype at every depth on reload', async () => {
    const handle = await bootDb('contributions');
    try {
      // Bypass `replaceAllScanContributions` (which AJV-validates the
      // payload at emit time): insert a row directly with a hostile
      // nested shape so the test exercises ONLY the load-time strip.
      const payloadJson = JSON.stringify({
        value: 42,
        meta: {
          __proto__: { polluted: 'nested' },
          fine: 'keep-me',
        },
        nested: {
          deeper: {
            constructor: { hijack: 1 },
            safe: 'kept',
          },
        },
        arr: [{ __proto__: { bad: 1 }, inside: 'still-here' }],
        // Root-level forbidden name too.
        __proto__: { polluted: 'root' },
      });
      await handle.db
        .insertInto('scan_contributions')
        .values({
          pluginId: 'p1',
          extensionId: 'e1',
          nodePath: 'a.md',
          contributionId: 'count',
          slot: 'card.footer.right',
          payloadJson,
          emittedAt: 1000,
        })
        .execute();

      // Read back via every load helper; all funnel through
      // `rowToContribution` and must return a clean payload.
      const byNode = await loadContributionsForNode(handle.db, 'a.md');
      const byPaths = await loadContributionsForPaths(handle.db, ['a.md']);
      const byLookup = await loadContributionLookup(handle.db, 'p1', 'count', 'a.md');

      for (const rows of [byNode, byPaths, byLookup]) {
        assert.equal(rows.length, 1);
        const payload = rows[0]!.payload as Record<string, unknown>;
        assert.equal(payload['value'], 42);
        assert.equal(Object.prototype.hasOwnProperty.call(payload, '__proto__'), false);
        const meta = payload['meta'] as Record<string, unknown>;
        assert.equal(meta['fine'], 'keep-me');
        assert.equal(Object.prototype.hasOwnProperty.call(meta, '__proto__'), false);
        const deeper = (payload['nested'] as Record<string, unknown>)['deeper'] as Record<string, unknown>;
        assert.equal(deeper['safe'], 'kept');
        assert.equal(Object.prototype.hasOwnProperty.call(deeper, 'constructor'), false);
        const arr = payload['arr'] as Record<string, unknown>[];
        assert.equal(arr[0]!['inside'], 'still-here');
        assert.equal(Object.prototype.hasOwnProperty.call(arr[0]!, '__proto__'), false);
      }

      // Object.prototype itself is clean.
      assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
      assert.equal(({} as Record<string, unknown>)['bad'], undefined);
      assert.equal(({} as Record<string, unknown>)['hijack'], undefined);
    } finally {
      await handle.close();
    }
  });
});
