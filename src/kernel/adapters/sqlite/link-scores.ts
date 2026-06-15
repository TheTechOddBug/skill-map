/**
 * `scan_link_scores` adapter, replace-all writer used by
 * `persistScanResult`. One row per attributed
 * `ctx.adjustConfidence(link, op)` call buffered by a `score`-phase
 * analyzer during the scan (the kernel's own built-in score-phase
 * detectors `core/name-reserved`, `core/reference-broken` dogfood the
 * API, applying penalty deltas on top of the kernel's 1.0 baseline). The
 * audit trail an operator reads to answer "why is this link at 0.3?".
 *
 * See `spec/db-schema.md` § scan_link_scores and `migrations/001_initial.sql`
 * § scan_link_scores for the normative shape.
 *
 * Replace-all semantics mirror `scan_issues` / `scan_contribution_errors`
 * (plain delete-all-then-insert), NOT the orphan/catalog/per-tuple sweep
 * `scan_contributions` uses: a confidence adjustment is a transient scan
 * finding re-derived in full on every analyzer pass, so there is no
 * cached-node row to preserve. Wrapped in the same transaction
 * `persistScanResult` opens.
 *
 * Each adjustment maps to a row using the link's structural identity
 * fields (`source`, `target`, `kind`, `trigger?.normalizedTrigger`), the
 * op's `kind` / `value`, the FOLDED final `link.confidence` denormalised
 * as `result_confidence` (so the audit read needs no join back to
 * `scan_links`), and the fold's `emittedAt`.
 */

import type { Insertable, Transaction } from 'kysely';

import type { IConfidenceAdjustment } from '../../orchestrator/confidence-score.js';
import type { IDatabase, IScanLinkScoresTable } from './schema.js';

// Re-export so consumers that thread the orchestrator buffer through the
// persistence layer (`scan-persistence.ts`, the storage adapter, the
// scan-runner) can import the record shape from the adapter path next to
// the writer, mirroring how `contributions.ts` re-exports
// `IPersistedContribution`.
export type { IConfidenceAdjustment };

/**
 * Persist the per-scan link-score buffer. Plain REPLACE-ALL (delete every
 * prior row, then insert), the same posture as `scan_issues` and
 * `scan_contribution_errors`.
 *
 * Empty buffer wipes the table (the common case: a scan whose scorers
 * touched nothing clears any stale rows from a prior scan).
 *
 * ≤ 90 rows per chunk to stay under SQLite's 999-binding limit
 * (10 columns × 90 = 900 bindings, leaving margin under 999).
 */
export async function replaceAllScanLinkScores(
  trx: Transaction<IDatabase>,
  linkScores: readonly IConfidenceAdjustment[],
): Promise<void> {
  await trx.deleteFrom('scan_link_scores').execute();
  if (linkScores.length === 0) return;
  const CHUNK = 90;
  for (let i = 0; i < linkScores.length; i += CHUNK) {
    const slice = linkScores.slice(i, i + CHUNK);
    const rows: Insertable<IScanLinkScoresTable>[] = slice.map(adjustmentToRow);
    await trx.insertInto('scan_link_scores').values(rows).execute();
  }
}

function adjustmentToRow(adj: IConfidenceAdjustment): Insertable<IScanLinkScoresTable> {
  return {
    pluginId: adj.pluginId,
    extensionId: adj.extensionId,
    sourcePath: adj.link.source,
    target: adj.link.target,
    kind: adj.link.kind,
    normalizedTrigger: adj.link.trigger?.normalizedTrigger ?? null,
    opKind: adj.op.kind,
    opValue: adj.op.value,
    // FOLDED final confidence: by the time this writer runs, the
    // orchestrator has already applied every buffered op into
    // `link.confidence` (see `applyConfidenceAdjustments`). Denormalised
    // per row so the audit read needs no join.
    resultConfidence: adj.link.confidence,
    emittedAt: Date.now(),
  };
}
