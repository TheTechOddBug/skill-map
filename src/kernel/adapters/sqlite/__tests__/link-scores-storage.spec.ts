/**
 * Acceptance tests for the `scan_link_scores` adapter
 * (`replaceAllScanLinkScores`), the per-op confidence-attribution audit
 * trail that answers "why is this link at X?". Pins:
 *
 *   - the round-trip: every field of an `IConfidenceAdjustment` lands on
 *     the row, including the link's structural identity
 *     (`source` / `target` / `kind` / `trigger?.normalizedTrigger`), the
 *     op's `kind` / `value`, and the FOLDED final `link.confidence`
 *     denormalised as `result_confidence`;
 *   - `normalizedTrigger` is NULL for a path-style link with no trigger;
 *   - REPLACE-ALL semantics: a second persist wipes the prior rows, and an
 *     empty buffer clears the table.
 *
 * `replaceAllScanLinkScores` takes a Kysely `Transaction`, so the test
 * opens one on `adapter.db` (the same handle `persistScanResult` wraps),
 * mirroring how the writer runs inside the scan-zone transaction.
 *
 * Per-test fixture path uses `mkdtempSync` ([[feedback_sqlite_in_memory_workaround]]
 * says `:memory:` doesn't work with the adapter's two-DatabaseSync design).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';

import { SqliteStorageAdapter } from '../index.js';
import {
  replaceAllScanLinkScores,
  type IConfidenceAdjustment,
} from '../link-scores.js';
import type { Link } from '../../../types.js';

let tempRoot: string;

before(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'skill-map-link-scores-'));
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function freshDbPath(name: string): string {
  return join(tempRoot, `${name}.db`);
}

function makeLink(over: Partial<Link>): Link {
  return {
    source: 'a.md',
    target: 'b.md',
    kind: 'references',
    confidence: 0.3,
    sources: ['markdown-link'],
    ...over,
  };
}

async function writeLinkScores(
  adapter: SqliteStorageAdapter,
  adjustments: readonly IConfidenceAdjustment[],
): Promise<void> {
  await adapter.db.transaction().execute((trx) => replaceAllScanLinkScores(trx, adjustments));
}

async function readAllRows(adapter: SqliteStorageAdapter) {
  return adapter.db
    .selectFrom('scan_link_scores')
    .selectAll()
    .orderBy('sourcePath', 'asc')
    .orderBy('opKind', 'asc')
    .execute();
}

describe('replaceAllScanLinkScores (scan_link_scores audit trail)', () => {
  it('round-trips every attribution field, NULLing normalizedTrigger for path-style links', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('round-trip') });
    await adapter.init();
    try {
      // A trigger-style invocation link capped to 0.5 (broken), plus a
      // path-style reference set to 1.0 (resolved). The final folded
      // confidence already sits on `link.confidence`, denormalised onto
      // every row as `result_confidence`.
      const triggerLink = makeLink({
        source: '.claude/agents/architect.md',
        target: '@reviewer',
        kind: 'invokes',
        confidence: 0.5,
        trigger: { originalTrigger: '@reviewer', normalizedTrigger: 'reviewer' },
      });
      const pathLink = makeLink({
        source: 'docs/guide.md',
        target: 'docs/intro.md',
        kind: 'references',
        confidence: 1,
      });
      const adjustments: IConfidenceAdjustment[] = [
        {
          link: triggerLink,
          pluginId: 'core',
          extensionId: 'reference-broken',
          op: { kind: 'ceil', value: 0.5 },
        },
        {
          link: pathLink,
          pluginId: 'core',
          extensionId: 'reference-broken',
          op: { kind: 'set', value: 1 },
        },
      ];

      await writeLinkScores(adapter, adjustments);
      const rows = await readAllRows(adapter);
      strictEqual(rows.length, 2);

      // Path-style row first (sourcePath 'docs/guide.md' < '.claude/...'?
      // '.' (0x2e) < 'd' (0x64), so the trigger row sorts first). Assert
      // by content, not position, to keep the test order-robust.
      const triggerRow = rows.find((r) => r.sourcePath === '.claude/agents/architect.md');
      const pathRow = rows.find((r) => r.sourcePath === 'docs/guide.md');

      deepStrictEqual(
        {
          pluginId: triggerRow?.pluginId,
          extensionId: triggerRow?.extensionId,
          sourcePath: triggerRow?.sourcePath,
          target: triggerRow?.target,
          kind: triggerRow?.kind,
          normalizedTrigger: triggerRow?.normalizedTrigger,
          opKind: triggerRow?.opKind,
          opValue: triggerRow?.opValue,
          resultConfidence: triggerRow?.resultConfidence,
        },
        {
          pluginId: 'core',
          extensionId: 'reference-broken',
          sourcePath: '.claude/agents/architect.md',
          target: '@reviewer',
          kind: 'invokes',
          normalizedTrigger: 'reviewer',
          opKind: 'ceil',
          opValue: 0.5,
          resultConfidence: 0.5,
        },
      );

      // Path-style link carries no trigger → NULL normalizedTrigger; the
      // folded confidence (1.0) rides on the row.
      strictEqual(pathRow?.normalizedTrigger, null);
      strictEqual(pathRow?.opKind, 'set');
      strictEqual(pathRow?.opValue, 1);
      strictEqual(pathRow?.resultConfidence, 1);

      // `emitted_at` is a wall-clock ms integer.
      strictEqual(Number.isInteger(triggerRow?.emittedAt), true);
    } finally {
      await adapter.close();
    }
  });

  it('REPLACE-ALL: a second persist wipes prior rows, an empty buffer clears the table', async () => {
    const adapter = new SqliteStorageAdapter({ databasePath: freshDbPath('replace-all') });
    await adapter.init();
    try {
      const first: IConfidenceAdjustment[] = [
        {
          link: makeLink({ source: 'x.md', confidence: 0.1 }),
          pluginId: 'core',
          extensionId: 'reference-broken',
          op: { kind: 'set', value: 0.1 },
        },
      ];
      await writeLinkScores(adapter, first);
      strictEqual((await readAllRows(adapter)).length, 1);

      // Second persist with a different link replaces the snapshot.
      const second: IConfidenceAdjustment[] = [
        {
          link: makeLink({ source: 'y.md', confidence: 1 }),
          pluginId: 'core',
          extensionId: 'reference-broken',
          op: { kind: 'set', value: 1 },
        },
      ];
      await writeLinkScores(adapter, second);
      const afterReplace = await readAllRows(adapter);
      strictEqual(afterReplace.length, 1);
      strictEqual(afterReplace[0]?.sourcePath, 'y.md');

      // Empty buffer clears the table entirely (the clean-scan reset).
      await writeLinkScores(adapter, []);
      strictEqual((await readAllRows(adapter)).length, 0);
    } finally {
      await adapter.close();
    }
  });
});
