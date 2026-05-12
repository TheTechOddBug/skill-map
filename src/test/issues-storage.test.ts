/**
 * Acceptance tests for `port.issues.list`, the paginated + filtered
 * read of `scan_issues` introduced in the audit L6 fix.
 *
 * Coverage:
 *   - empty DB: zero items, zero total.
 *   - large dataset (~150 rows): pagination math holds (offset / limit
 *     slice the right window, total stays consistent).
 *   - each filter individually (severity, analyzerId qualified-form,
 *     analyzerId short-form, node).
 *   - combined filters.
 *   - SQL injection defence: a `node` parameter containing typical
 *     SQL-injection payloads does not blow up and matches nothing.
 *
 * The tests plant rows directly into `scan_issues` (no scan / persist
 * round-trip) so the dataset shape is fully controlled: severity
 * distribution, analyzer-id distribution, node-id distribution. Mirrors
 * the pattern used in `orphans-cli.test.ts` and `check-include-prob.test.ts`.
 */

import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';

let dbRoot: string;
let dbCounter = 0;

function freshDbPath(label: string): string {
  dbCounter += 1;
  return join(dbRoot, `${label}-${dbCounter}.db`);
}

before(() => {
  dbRoot = mkdtempSync(join(tmpdir(), 'skill-map-issues-storage-'));
});

after(() => {
  rmSync(dbRoot, { recursive: true, force: true });
});

interface IPlantedIssue {
  analyzerId: string;
  severity: 'error' | 'warn' | 'info';
  nodeIds: string[];
  message: string;
}

async function plantIssues(
  adapter: SqliteStorageAdapter,
  rows: readonly IPlantedIssue[],
): Promise<void> {
  for (const r of rows) {
    await adapter.db
      .insertInto('scan_issues')
      .values({
        analyzerId: r.analyzerId,
        severity: r.severity,
        nodeIdsJson: JSON.stringify(r.nodeIds),
        linkIndicesJson: null,
        message: r.message,
        detail: null,
        fixJson: null,
        dataJson: null,
      })
      .execute();
  }
}

describe('port.issues.list (audit L6)', () => {
  it('empty DB returns zero items and zero total', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('empty'), autoBackup: false });
    await adapter.init();
    try {
      const result = await adapter.issues.list({ offset: 0, limit: 100 });
      assert.equal(result.items.length, 0);
      assert.equal(result.total, 0);
    } finally {
      await adapter.close();
    }
  });

  it('paginates a 150-row dataset: total stays full, items respects limit + offset', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('paginate'), autoBackup: false });
    await adapter.init();
    try {
      const planted: IPlantedIssue[] = [];
      for (let i = 0; i < 150; i++) {
        planted.push({
          analyzerId: 'core/broken-ref',
          severity: 'error',
          nodeIds: [`.claude/notes/note-${String(i).padStart(3, '0')}.md`],
          message: `msg-${i}`,
        });
      }
      await plantIssues(adapter, planted);

      // Default-ish page 0..99.
      const page0 = await adapter.issues.list({ offset: 0, limit: 100 });
      assert.equal(page0.items.length, 100);
      assert.equal(page0.total, 150);

      // Tail page 100..149.
      const page1 = await adapter.issues.list({ offset: 100, limit: 100 });
      assert.equal(page1.items.length, 50);
      assert.equal(page1.total, 150);

      // Page beyond total: empty but total preserved.
      const empty = await adapter.issues.list({ offset: 1000, limit: 100 });
      assert.equal(empty.items.length, 0);
      assert.equal(empty.total, 150);

      // Pages are id-stable: page0's last item differs from page1's first.
      const lastOfPage0 = page0.items[99]!;
      const firstOfPage1 = page1.items[0]!;
      assert.notDeepEqual(lastOfPage0, firstOfPage1);
    } finally {
      await adapter.close();
    }
  });

  it('severity filter narrows to the matching tokens (IN clause)', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('severity'), autoBackup: false });
    await adapter.init();
    try {
      await plantIssues(adapter, [
        { analyzerId: 'core/a', severity: 'error', nodeIds: ['n.md'], message: 'e1' },
        { analyzerId: 'core/a', severity: 'error', nodeIds: ['n.md'], message: 'e2' },
        { analyzerId: 'core/a', severity: 'warn', nodeIds: ['n.md'], message: 'w1' },
        { analyzerId: 'core/a', severity: 'info', nodeIds: ['n.md'], message: 'i1' },
      ]);

      const errs = await adapter.issues.list({ severities: ['error'], offset: 0, limit: 100 });
      assert.equal(errs.total, 2);
      for (const i of errs.items) assert.equal(i.severity, 'error');

      const warnsAndInfos = await adapter.issues.list({
        severities: ['warn', 'info'],
        offset: 0,
        limit: 100,
      });
      assert.equal(warnsAndInfos.total, 2);
      for (const i of warnsAndInfos.items) assert.ok(['warn', 'info'].includes(i.severity));

      // Unknown severity token: zero matches (no kernel error, the
      // SQL `IN (?)` just returns nothing).
      const unknown = await adapter.issues.list({
        severities: ['fatal'],
        offset: 0,
        limit: 100,
      });
      assert.equal(unknown.total, 0);
      assert.equal(unknown.items.length, 0);
    } finally {
      await adapter.close();
    }
  });

  it('analyzerId filter matches both qualified form and short-suffix form', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('analyzer'), autoBackup: false });
    await adapter.init();
    try {
      await plantIssues(adapter, [
        { analyzerId: 'core/broken-ref', severity: 'error', nodeIds: ['n.md'], message: 'a' },
        { analyzerId: 'core/superseded', severity: 'warn', nodeIds: ['n.md'], message: 'b' },
        { analyzerId: 'plugin/x', severity: 'info', nodeIds: ['n.md'], message: 'c' },
      ]);

      // Qualified form (exact equality).
      const qualified = await adapter.issues.list({
        analyzerIds: ['core/broken-ref'],
        offset: 0,
        limit: 100,
      });
      assert.equal(qualified.total, 1);
      assert.equal(qualified.items[0]!.analyzerId, 'core/broken-ref');

      // Short form: `broken-ref` matches `core/broken-ref` via the
      // LIKE '%/broken-ref' suffix clause.
      const short = await adapter.issues.list({
        analyzerIds: ['broken-ref'],
        offset: 0,
        limit: 100,
      });
      assert.equal(short.total, 1);
      assert.equal(short.items[0]!.analyzerId, 'core/broken-ref');

      // Mixed list (qualified + short) ORs across entries.
      const mixed = await adapter.issues.list({
        analyzerIds: ['core/broken-ref', 'superseded'],
        offset: 0,
        limit: 100,
      });
      assert.equal(mixed.total, 2);
    } finally {
      await adapter.close();
    }
  });

  it('node filter keeps only issues whose nodeIds JSON array contains the path', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('node'), autoBackup: false });
    await adapter.init();
    try {
      await plantIssues(adapter, [
        {
          analyzerId: 'core/a',
          severity: 'error',
          nodeIds: ['.claude/agents/architect.md', '.claude/commands/deploy.md'],
          message: 'shared',
        },
        {
          analyzerId: 'core/b',
          severity: 'warn',
          nodeIds: ['.claude/agents/architect.md'],
          message: 'arch-only',
        },
        {
          analyzerId: 'core/c',
          severity: 'info',
          nodeIds: ['.claude/skills/intro/SKILL.md'],
          message: 'unrelated',
        },
      ]);

      const archMatches = await adapter.issues.list({
        nodePath: '.claude/agents/architect.md',
        offset: 0,
        limit: 100,
      });
      assert.equal(archMatches.total, 2);
      for (const i of archMatches.items) {
        assert.ok(i.nodeIds.includes('.claude/agents/architect.md'));
      }

      // Path with no match: zero rows.
      const ghost = await adapter.issues.list({
        nodePath: '.claude/does-not-exist.md',
        offset: 0,
        limit: 100,
      });
      assert.equal(ghost.total, 0);
    } finally {
      await adapter.close();
    }
  });

  it('combined filters intersect: severity + analyzerId + node', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('combo'), autoBackup: false });
    await adapter.init();
    try {
      await plantIssues(adapter, [
        // Matches every filter below.
        {
          analyzerId: 'core/broken-ref',
          severity: 'error',
          nodeIds: ['.claude/agents/architect.md'],
          message: 'match',
        },
        // Same analyzer + node but wrong severity.
        {
          analyzerId: 'core/broken-ref',
          severity: 'warn',
          nodeIds: ['.claude/agents/architect.md'],
          message: 'no-sev',
        },
        // Same severity + analyzer but wrong node.
        {
          analyzerId: 'core/broken-ref',
          severity: 'error',
          nodeIds: ['.claude/other.md'],
          message: 'no-node',
        },
        // Same severity + node but wrong analyzer.
        {
          analyzerId: 'core/superseded',
          severity: 'error',
          nodeIds: ['.claude/agents/architect.md'],
          message: 'no-analyzer',
        },
      ]);

      const result = await adapter.issues.list({
        severities: ['error'],
        analyzerIds: ['broken-ref'],
        nodePath: '.claude/agents/architect.md',
        offset: 0,
        limit: 100,
      });
      assert.equal(result.total, 1);
      assert.equal(result.items[0]!.message, 'match');
    } finally {
      await adapter.close();
    }
  });

  it('node filter survives SQL-injection-shaped values without erroring', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('inject'), autoBackup: false });
    await adapter.init();
    try {
      await plantIssues(adapter, [
        {
          analyzerId: 'core/a',
          severity: 'error',
          nodeIds: ['.claude/safe.md'],
          message: 'safe',
        },
      ]);

      // Classic single-quote + OR 1=1 payload. The parameterised binding
      // matches the literal string against `json_each.value`, so the
      // payload finds nothing and the row count stays unchanged.
      const result = await adapter.issues.list({
        nodePath: "' OR 1=1 --",
        offset: 0,
        limit: 100,
      });
      assert.equal(result.total, 0);

      // Smoke: the safe row is still there afterwards.
      const all = await adapter.issues.list({ offset: 0, limit: 100 });
      assert.equal(all.total, 1);
    } finally {
      await adapter.close();
    }
  });

  it('offset=0 + limit=0 returns zero items but the full total', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('zero-limit'), autoBackup: false });
    await adapter.init();
    try {
      await plantIssues(adapter, [
        { analyzerId: 'core/a', severity: 'error', nodeIds: ['n.md'], message: 'x' },
        { analyzerId: 'core/a', severity: 'warn', nodeIds: ['n.md'], message: 'y' },
      ]);
      const result = await adapter.issues.list({ offset: 0, limit: 0 });
      assert.equal(result.items.length, 0);
      assert.equal(result.total, 2);
    } finally {
      await adapter.close();
    }
  });
});
