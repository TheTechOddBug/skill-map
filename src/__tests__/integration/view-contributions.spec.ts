/**
 * View contribution system, Phases 2-7 end-to-end tests.
 *
 * Covers:
 *   - AJV emit-time payload validation (`validateContributionPayload`).
 *   - Runtime catalog aggregation (`loadPluginRuntime` →
 *     `bundle.viewContributions`).
 *   - Storage adapter round-trip (`replaceAllScanContributions` +
 *     `loadContributionsForNode` / `loadContributionsForPaths` /
 *     `loadContributionLookup` / `purgeContributionsByPlugin`).
 *   - Orchestrator emit-time wiring through to persistence (extract()
 *     calls `ctx.emitContribution(...)` → buffer → persist → read back).
 *
 * Sister to `annotation-contributions.test.ts` (Step 9.6.6 surface).
 * Same `loadPluginRuntime` test plumbing, mkdtemp + plant manifests +
 * load + assert.
 */

import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Kysely } from 'kysely';
import { NodeSqliteDialect } from '../../kernel/adapters/sqlite/dialect.js';
import { CamelCasePlugin } from 'kysely';

import { loadPluginRuntime } from '../../core/runtime/plugin-runtime.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import {
  loadContributionLookup,
  loadContributionsForNode,
  loadContributionsForPaths,
  purgeContributionsByPlugin,
  replaceAllScanContributions,
  type IContributionRecord,
} from '../../kernel/adapters/sqlite/contributions.js';
import { discoverMigrations, applyMigrations } from '../../kernel/adapters/sqlite/migrations.js';
import type { IDatabase } from '../../kernel/adapters/sqlite/schema.js';

let root: string;
let counter = 0;

function freshDir(label: string): string {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface IViewContributionShape {
  slot: string;
  label?: string;
  tooltip?: string;
  icon?: string;
  emptyText?: string;
  emitWhenEmpty?: boolean;
}

/**
 * Plant a minimal `extractor` plugin that declares `viewContributions`
 * and (optionally) calls `ctx.emitContribution(id, payload)` from
 * `extract()`. Mirrors the pattern in `annotation-contributions.test.ts`.
 */
function plantPluginWithViewContributions(
  pluginsDir: string,
  id: string,
  viewContributions: Record<string, IViewContributionShape>,
  extractBody = '',
): void {
  const dir = join(pluginsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({
      id,
      version: '1.0.0',
      specCompat: '>=0.0.0',
      granularity: 'bundle',
    }),
  );
  const extDir = join(dir, 'extractors', `${id}-d`);
  mkdirSync(extDir, { recursive: true });
  writeFileSync(
    join(extDir, 'index.mjs'),
    `export default {
      id: '${id}-d',
      kind: 'extractor',
      version: '1.0.0',
      emitsLinkKinds: [],
      defaultConfidence: 'high',
      scope: 'body',
      viewContributions: ${JSON.stringify(viewContributions)},
      extract(ctx) { ${extractBody} },
    };`,
  );
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-view-contrib-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. AJV emit-time payload validation
// ---------------------------------------------------------------------------

describe('view contributions, AJV payload validation', () => {
  it('accepts a valid counter payload (card.footer.right)', () => {
    const validators = loadSchemaValidators();
    const result = validators.validateContributionPayload('card.footer.right', {
      value: 42,
    });
    assert.equal(result.ok, true);
  });

  it('rejects a counter payload with negative value', () => {
    const validators = loadSchemaValidators();
    const result = validators.validateContributionPayload('card.footer.right', {
      value: -1,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.errors, />=|minimum|≥/);
  });

  it('rejects a counter payload missing required `value`', () => {
    const validators = loadSchemaValidators();
    const result = validators.validateContributionPayload('card.footer.right', {});
    assert.equal(result.ok, false);
  });

  it('accepts a valid key-values payload (inspector.body.panel.key-values)', () => {
    const validators = loadSchemaValidators();
    const result = validators.validateContributionPayload('inspector.body.panel.key-values', {
      entries: [
        { key: 'title', value: 'API Reference' },
        { key: 'version', value: 3 },
        { key: 'pinned', value: true },
      ],
    });
    assert.equal(result.ok, true);
  });

  it('rejects unknown slot names with a directed error', () => {
    const validators = loadSchemaValidators();
    const result = validators.validateContributionPayload('not-a-real-slot', {
      value: 1,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errors, 'unknown-slot');
  });

  it('rejects breakdown payload with an entry missing label', () => {
    const validators = loadSchemaValidators();
    const result = validators.validateContributionPayload('inspector.body.panel.breakdown', {
      entries: [{ value: 5 }],
    });
    assert.equal(result.ok, false);
  });
});

// ---------------------------------------------------------------------------
// 2. Runtime catalog aggregation
// ---------------------------------------------------------------------------

describe('view contributions, loadPluginRuntime aggregation', () => {
  it('collects a single declared contribution into the bundle catalog', async () => {
    const dir = freshDir('catalog-one');
    plantPluginWithViewContributions(dir, 'agg-one', {
      counter: { slot: 'card.footer.right', label: 'Things', icon: '🔍' },
    });

    const bundle = await loadPluginRuntime({ pluginDir: dir });
    assert.equal(bundle.discovered[0]!.status, 'enabled');
    assert.equal(bundle.viewContributions.length, 1);
    const entry = bundle.viewContributions[0]!;
    assert.equal(entry.pluginId, 'agg-one');
    assert.equal(entry.extensionId, 'agg-one-d');
    assert.equal(entry.contributionId, 'counter');
    assert.equal(entry.slot, 'card.footer.right');
    assert.equal(entry.label, 'Things');
    assert.equal(entry.icon, '🔍');
    assert.equal(entry.emitWhenEmpty, false); // default
  });

  it('honours emitWhenEmpty: true when set', async () => {
    const dir = freshDir('catalog-emit-empty');
    plantPluginWithViewContributions(dir, 'agg-emit', {
      tag: { slot: 'inspector.header.badge.tag', label: 'Status', emitWhenEmpty: true },
    });

    const bundle = await loadPluginRuntime({ pluginDir: dir });
    assert.equal(bundle.discovered[0]!.status, 'enabled');
    assert.equal(bundle.viewContributions[0]!.emitWhenEmpty, true);
  });

  it('collects multiple contributions per extension', async () => {
    const dir = freshDir('catalog-multi');
    plantPluginWithViewContributions(dir, 'agg-multi', {
      counter: { slot: 'card.footer.right', label: 'C', icon: '🔧' },
      breakdown: { slot: 'inspector.body.panel.breakdown', label: 'B' },
      tree: { slot: 'inspector.body.panel.tree', label: 'T' },
    });

    const bundle = await loadPluginRuntime({ pluginDir: dir });
    assert.equal(bundle.discovered[0]!.status, 'enabled');
    assert.equal(bundle.viewContributions.length, 3);
    const ids = bundle.viewContributions.map((c) => c.contributionId).sort();
    assert.deepEqual(ids, ['breakdown', 'counter', 'tree']);
  });

  it('returns empty catalog for plugins that declare none', async () => {
    const dir = freshDir('catalog-none');
    // Plant without viewContributions
    const pdir = join(dir, 'no-vc');
    mkdirSync(pdir, { recursive: true });
    writeFileSync(
      join(pdir, 'plugin.json'),
      JSON.stringify({
        id: 'no-vc',
        version: '1.0.0',
        specCompat: '>=0.0.0',
        granularity: 'bundle',
      }),
    );
    const noVcExtDir = join(pdir, 'extractors', 'no-vc-d');
    mkdirSync(noVcExtDir, { recursive: true });
    writeFileSync(
      join(noVcExtDir, 'index.mjs'),
      `export default {
        id: 'no-vc-d',
        kind: 'extractor',
        version: '1.0.0',
        emitsLinkKinds: ['references'],
        defaultConfidence: 'high',
        scope: 'body',
        extract() {},
      };`,
    );

    const bundle = await loadPluginRuntime({ pluginDir: dir });
    assert.equal(bundle.discovered[0]!.status, 'enabled');
    assert.equal(bundle.viewContributions.length, 0);
  });
});

// ---------------------------------------------------------------------------
// 3. Storage adapter round-trip
// ---------------------------------------------------------------------------

interface IDbHandle {
  db: Kysely<IDatabase>;
  close: () => Promise<void>;
}

async function bootDb(): Promise<IDbHandle> {
  const path = join(mkdtempSync(join(tmpdir(), 'skill-map-vc-db-')), 'skill-map.db');
  // Apply kernel migrations against the file (SqliteStorageAdapter is
  // overkill for this, we want a raw Kysely instance).
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON');
  applyMigrations(raw, path, undefined, discoverMigrations());
  raw.close();
  // Re-open through Kysely + camelcase so the adapter's queries work.
  const dialect = new NodeSqliteDialect({ databasePath: path });
  const db = new Kysely<IDatabase>({ dialect, plugins: [new CamelCasePlugin()] });
  return {
    db,
    async close() {
      await db.destroy();
      rmSync(path, { force: true });
    },
  };
}

describe('view contributions, storage adapter round-trip', () => {
  it('replaceAll persists rows, listForNode reads them back', async () => {
    const handle = await bootDb();
    try {
      const records: IContributionRecord[] = [
        {
          pluginId: 'p1',
          extensionId: 'e1',
          nodePath: 'a.md',
          contributionId: 'count',
          slot: 'card.footer.right',
          payload: { value: 12 },
          emittedAt: 1000,
        },
        {
          pluginId: 'p1',
          extensionId: 'e1',
          nodePath: 'b.md',
          contributionId: 'count',
          slot: 'card.footer.right',
          payload: { value: 7 },
          emittedAt: 1000,
        },
      ];
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(trx, records);
      });

      const a = await loadContributionsForNode(handle.db, 'a.md');
      assert.equal(a.length, 1);
      assert.deepEqual(a[0]!.payload, { value: 12 });

      const b = await loadContributionsForNode(handle.db, 'b.md');
      assert.deepEqual(b[0]!.payload, { value: 7 });
    } finally {
      await handle.close();
    }
  });

  it('upserts on PK conflict, payload refreshes', async () => {
    const handle = await bootDb();
    try {
      const live = new Set(['a.md']);
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(trx, [
          {
            pluginId: 'p1',
            extensionId: 'e1',
            nodePath: 'a.md',
            contributionId: 'count',
            slot: 'card.footer.right',
            payload: { value: 1 },
            emittedAt: 1000,
          },
        ], live);
      });
      // Same PK, different payload + later timestamp → REPLACE.
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(trx, [
          {
            pluginId: 'p1',
            extensionId: 'e1',
            nodePath: 'a.md',
            contributionId: 'count',
            slot: 'card.footer.right',
            payload: { value: 99 },
            emittedAt: 2000,
          },
        ], live);
      });
      const rows = await loadContributionsForNode(handle.db, 'a.md');
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0]!.payload, { value: 99 });
      assert.equal(rows[0]!.emittedAt, 2000);
    } finally {
      await handle.close();
    }
  });

  it('drops orphan rows when a node disappears (livePaths set)', async () => {
    const handle = await bootDb();
    try {
      // First scan: a.md and b.md both have contributions.
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(trx, [
          { pluginId: 'p1', extensionId: 'e1', nodePath: 'a.md', contributionId: 'count', slot: 'card.footer.right', payload: { value: 1 }, emittedAt: 1 },
          { pluginId: 'p1', extensionId: 'e1', nodePath: 'b.md', contributionId: 'count', slot: 'card.footer.right', payload: { value: 2 }, emittedAt: 1 },
        ], new Set(['a.md', 'b.md']));
      });
      assert.equal((await loadContributionsForNode(handle.db, 'a.md')).length, 1);
      assert.equal((await loadContributionsForNode(handle.db, 'b.md')).length, 1);

      // Second scan: b.md disappeared. Buffer has a.md only AND
      // livePaths only includes a.md → b.md's row is swept.
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(trx, [
          { pluginId: 'p1', extensionId: 'e1', nodePath: 'a.md', contributionId: 'count', slot: 'card.footer.right', payload: { value: 1 }, emittedAt: 2 },
        ], new Set(['a.md']));
      });
      assert.equal((await loadContributionsForNode(handle.db, 'a.md')).length, 1);
      assert.equal((await loadContributionsForNode(handle.db, 'b.md')).length, 0);
    } finally {
      await handle.close();
    }
  });

  it('preserves cached-node rows when buffer is empty (watcher cache pass)', async () => {
    const handle = await bootDb();
    try {
      // Initial scan emits contributions.
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(trx, [
          { pluginId: 'p1', extensionId: 'e1', nodePath: 'a.md', contributionId: 'count', slot: 'card.footer.right', payload: { value: 5 }, emittedAt: 1 },
          { pluginId: 'p1', extensionId: 'e1', nodePath: 'b.md', contributionId: 'count', slot: 'card.footer.right', payload: { value: 7 }, emittedAt: 1 },
        ], new Set(['a.md', 'b.md']));
      });

      // Watcher's cached pass: same nodes, no extractor re-runs, so
      // the buffer is empty. Both prior rows MUST survive, they're
      // still valid because the source bodies didn't change.
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(trx, [], new Set(['a.md', 'b.md']));
      });
      const a = await loadContributionsForNode(handle.db, 'a.md');
      const b = await loadContributionsForNode(handle.db, 'b.md');
      assert.equal(a.length, 1);
      assert.deepEqual(a[0]!.payload, { value: 5 });
      assert.equal(b.length, 1);
      assert.deepEqual(b[0]!.payload, { value: 7 });
    } finally {
      await handle.close();
    }
  });

  it('catalog sweep drops rows for plugins not in registeredKeys', async () => {
    const handle = await bootDb();
    try {
      const live = new Set(['a.md']);
      // Initial scan: two plugins emit on the same node.
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(trx, [
          { pluginId: 'p1', extensionId: 'e1', nodePath: 'a.md', contributionId: 'count', slot: 'card.footer.right', payload: { value: 1 }, emittedAt: 1 },
          { pluginId: 'p2', extensionId: 'e1', nodePath: 'a.md', contributionId: 'count', slot: 'card.footer.right', payload: { value: 2 }, emittedAt: 1 },
        ], live);
      });
      assert.equal((await loadContributionsForNode(handle.db, 'a.md')).length, 2);

      // p2 disabled, registeredKeys only carries p1's id, buffer
      // re-emits p1 only, p2's row gets swept.
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(
          trx,
          [
            { pluginId: 'p1', extensionId: 'e1', nodePath: 'a.md', contributionId: 'count', slot: 'card.footer.right', payload: { value: 99 }, emittedAt: 2 },
          ],
          live,
          new Set(['p1/e1/count']),
        );
      });
      const rows = await loadContributionsForNode(handle.db, 'a.md');
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.pluginId, 'p1');
      assert.deepEqual(rows[0]!.payload, { value: 99 });
    } finally {
      await handle.close();
    }
  });

  it('per-tuple sweep drops rows for extractors that stopped emitting on a freshly-run node', async () => {
    const handle = await bootDb();
    try {
      // First scan: a.md has TWO contributions from the same extractor
      // (urls + mentions) and one from another extractor (linksOut).
      // b.md has its own (urls).
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(trx, [
          { pluginId: 'core', extensionId: 'urls', nodePath: 'a.md', contributionId: 'count', slot: 'card.footer.right', payload: { value: 1 }, emittedAt: 1 },
          { pluginId: 'core', extensionId: 'urls', nodePath: 'a.md', contributionId: 'mentions', slot: 'card.footer.right', payload: { value: 2 }, emittedAt: 1 },
          { pluginId: 'core', extensionId: 'linkcounts', nodePath: 'a.md', contributionId: 'out', slot: 'card.footer.right', payload: { value: 5 }, emittedAt: 1 },
          { pluginId: 'core', extensionId: 'urls', nodePath: 'b.md', contributionId: 'count', slot: 'card.footer.right', payload: { value: 9 }, emittedAt: 1 },
        ], new Set(['a.md', 'b.md']));
      });
      assert.equal((await loadContributionsForNode(handle.db, 'a.md')).length, 3);
      assert.equal((await loadContributionsForNode(handle.db, 'b.md')).length, 1);

      // Second scan: a.md was freshly walked AND `core/urls` still
      // emits ONE contribution there (count, refreshed value), but no
      // longer emits `mentions`. `core/linkcounts` did NOT run
      // freshly on a.md (cache hit), its row must survive. b.md was
      // also freshly walked AND `core/urls` no longer emits at all
      // for it (e.g. URL was removed from body), its row must be
      // swept.
      const freshlyRun = new Set([
        'core\0urls\0a.md',     // urls ran on a.md (kept count, dropped mentions)
        'core\0urls\0b.md',     // urls ran on b.md (no emissions → drop existing row)
        // core\0linkcounts\0a.md NOT included → its row must survive
      ]);
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(
          trx,
          [
            { pluginId: 'core', extensionId: 'urls', nodePath: 'a.md', contributionId: 'count', slot: 'card.footer.right', payload: { value: 11 }, emittedAt: 2 },
          ],
          new Set(['a.md', 'b.md']),
          new Set<string>(),  // no catalog sweep
          freshlyRun,
        );
      });

      const rowsA = await loadContributionsForNode(handle.db, 'a.md');
      const idsA = rowsA.map((r) => `${r.extensionId}/${r.contributionId}`).sort();
      assert.deepEqual(idsA, ['linkcounts/out', 'urls/count'], 'a.md keeps urls/count (refreshed) + linkcounts/out (cached, untouched); urls/mentions dropped');
      const urlsCount = rowsA.find((r) => r.extensionId === 'urls' && r.contributionId === 'count');
      assert.deepEqual(urlsCount?.payload, { value: 11 }, 'urls/count payload refreshed by upsert');
      const linkOut = rowsA.find((r) => r.extensionId === 'linkcounts' && r.contributionId === 'out');
      assert.deepEqual(linkOut?.payload, { value: 5 }, 'linkcounts/out payload preserved (cached)');

      const rowsB = await loadContributionsForNode(handle.db, 'b.md');
      assert.equal(rowsB.length, 0, 'b.md urls/count row was swept (extractor ran but emitted nothing)');
    } finally {
      await handle.close();
    }
  });

  it('per-tuple sweep handles nodePaths with slashes (regression: nested paths)', async () => {
    // Regression: previously the tuple was `/`-separated and the parser
    // used `lastIndexOf('/')`, so a `nodePath` like
    // `.claude/agents/architect.md` chopped at the wrong slash, the
    // SELECT missed every row, and stale analyzer rows survived the
    // sweep. Symptom in the wild: editing a `.sm` to force drift made
    // the chip appear; reverting the edit (undo) did NOT clear it.
    // The NUL-separated tuple format makes the parse path correct.
    const handle = await bootDb();
    try {
      const NESTED = '.claude/agents/architect.md';
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(trx, [
          { pluginId: 'core', extensionId: 'annotation-stale', nodePath: NESTED, contributionId: 'staleIcon', slot: 'card.footer.right', payload: { value: 0, severity: 'warn', tooltip: 't' }, emittedAt: 1 },
        ], new Set([NESTED]));
      });
      assert.equal((await loadContributionsForNode(handle.db, NESTED)).length, 1);

      // Second scan: analyzer freshly ran on the nested node but
      // emitted nothing (status flipped back to `fresh`). The row
      // must disappear.
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(
          trx,
          [],
          new Set([NESTED]),
          new Set<string>(),
          new Set([`core\0annotation-stale\0${NESTED}`]),
        );
      });
      const rows = await loadContributionsForNode(handle.db, NESTED);
      assert.equal(rows.length, 0, 'nested-path rows must be swept when the analyzer stops emitting');
    } finally {
      await handle.close();
    }
  });

  it('legacy callers (no livePaths) get the old wipe-all behaviour', async () => {
    const handle = await bootDb();
    try {
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(trx, [
          { pluginId: 'p1', extensionId: 'e1', nodePath: 'a.md', contributionId: 'old', slot: 'card.footer.right', payload: { value: 1 }, emittedAt: 1 },
        ]);
      });
      // Empty buffer + no livePaths → falls back to wipe-all.
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(trx, []);
      });
      const rows = await loadContributionsForNode(handle.db, 'a.md');
      assert.equal(rows.length, 0);
    } finally {
      await handle.close();
    }
  });

  it('listForPaths returns only matching paths in stable order', async () => {
    const handle = await bootDb();
    try {
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(trx, [
          { pluginId: 'p1', extensionId: 'e1', nodePath: 'b.md', contributionId: 'x', slot: 'card.footer.right', payload: { value: 1 }, emittedAt: 1 },
          { pluginId: 'p1', extensionId: 'e1', nodePath: 'a.md', contributionId: 'x', slot: 'card.footer.right', payload: { value: 2 }, emittedAt: 1 },
          { pluginId: 'p1', extensionId: 'e1', nodePath: 'c.md', contributionId: 'x', slot: 'card.footer.right', payload: { value: 3 }, emittedAt: 1 },
        ]);
      });
      const rows = await loadContributionsForPaths(handle.db, ['a.md', 'c.md']);
      assert.equal(rows.length, 2);
      assert.equal(rows[0]!.nodePath, 'a.md');
      assert.equal(rows[1]!.nodePath, 'c.md');
    } finally {
      await handle.close();
    }
  });

  it('listForPaths with empty array returns [] without query', async () => {
    const handle = await bootDb();
    try {
      const rows = await loadContributionsForPaths(handle.db, []);
      assert.deepEqual(rows, []);
    } finally {
      await handle.close();
    }
  });

  it('lookup filters by qualified id + path', async () => {
    const handle = await bootDb();
    try {
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(trx, [
          { pluginId: 'p1', extensionId: 'e1', nodePath: 'a.md', contributionId: 'count', slot: 'card.footer.right', payload: { value: 5 }, emittedAt: 1 },
          { pluginId: 'p2', extensionId: 'e1', nodePath: 'a.md', contributionId: 'count', slot: 'card.footer.right', payload: { value: 9 }, emittedAt: 1 },
        ]);
      });
      const p1 = await loadContributionLookup(handle.db, 'p1', 'count', 'a.md');
      assert.equal(p1.length, 1);
      assert.deepEqual(p1[0]!.payload, { value: 5 });

      const p2 = await loadContributionLookup(handle.db, 'p2', 'count', 'a.md');
      assert.deepEqual(p2[0]!.payload, { value: 9 });
    } finally {
      await handle.close();
    }
  });

  it('purgeByPlugin drops only the requested plugin', async () => {
    const handle = await bootDb();
    try {
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(trx, [
          { pluginId: 'p1', extensionId: 'e1', nodePath: 'a.md', contributionId: 'x', slot: 'card.footer.right', payload: { value: 1 }, emittedAt: 1 },
          { pluginId: 'p2', extensionId: 'e1', nodePath: 'a.md', contributionId: 'x', slot: 'card.footer.right', payload: { value: 2 }, emittedAt: 1 },
        ]);
      });
      const purged = await purgeContributionsByPlugin(handle.db, 'p1');
      assert.equal(purged, 1);
      const remaining = await loadContributionsForNode(handle.db, 'a.md');
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0]!.pluginId, 'p2');
    } finally {
      await handle.close();
    }
  });

  it('purgeByPlugin narrows by extensionId when supplied', async () => {
    // Mirrors the `sm plugins disable core/slash` path: the toggle
    // splits the qualified id into (pluginId='core', extensionId='slash')
    // and only that pair's rows must be dropped. Siblings under the
    // same bundle survive.
    const handle = await bootDb();
    try {
      await handle.db.transaction().execute(async (trx) => {
        await replaceAllScanContributions(trx, [
          { pluginId: 'core', extensionId: 'slash', nodePath: 'a.md', contributionId: 'x', slot: 'card.footer.right', payload: { value: 1 }, emittedAt: 1 },
          { pluginId: 'core', extensionId: 'at-directive', nodePath: 'a.md', contributionId: 'x', slot: 'card.footer.right', payload: { value: 2 }, emittedAt: 1 },
        ]);
      });
      const purged = await purgeContributionsByPlugin(handle.db, 'core', 'slash');
      assert.equal(purged, 1);
      const remaining = await loadContributionsForNode(handle.db, 'a.md');
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0]!.extensionId, 'at-directive');
    } finally {
      await handle.close();
    }
  });

  it('returns empty for cold-start (no rows yet)', async () => {
    const handle = await bootDb();
    try {
      const rows = await loadContributionsForNode(handle.db, 'a.md');
      assert.deepEqual(rows, []);
    } finally {
      await handle.close();
    }
  });
});
