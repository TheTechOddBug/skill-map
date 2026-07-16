/**
 * Storage helpers for `state_findings`, the probabilistic-findings
 * write-through (`spec/db-schema.md` § state_findings).
 *
 * Rows land when `sm record` closes a `completed` job for a probabilistic
 * extension: the finder lane (`origin: 'extension'`, one row per entry of
 * a probabilistic Analyzer's validated `findings[]` array) plus the kernel
 * safety lane (`origin: 'kernel'`, synthesized from any probabilistic
 * report's `safety` block under the reserved type slugs). The write runs
 * inside the SAME transaction as the `state_executions` insert + job
 * transition (see `recordJobTerminal` in `jobs.ts`) with REPLACE
 * semantics: every existing row for `(node_id, extension_id)` (both
 * origins) is deleted first, then the fresh rows are inserted, so an
 * empty row set is a clean verdict that erases the prior judgment.
 *
 * Staleness (`body_hash_at_generation` != the node's live
 * `scan_nodes.body_hash`, or the node missing from `scan_nodes` entirely)
 * is computed at READ time via a LEFT JOIN; rows are never auto-deleted
 * on staleness and `sm scan` never touches this table.
 *
 * Every helper accepts a `Kysely<IDatabase>` OR a `Transaction<IDatabase>`
 * so the record path can compose the replace inside its existing
 * transaction, while reads (and storage-level tests) call on the base
 * handle directly (mirror of `summaries.ts`).
 */

import type { Kysely, Transaction } from 'kysely';

import type {
  IFindingRecord,
  IFindingResolutionIntent,
  IFindingRowInput,
  IFindingsListFilter,
  IFindingsWriteIntent,
} from '../../types/storage.js';
import type { Severity } from '../../types.js';
import { matchesQualifiedExtensionFilter } from '../../util/analyzer-filter.js';
import type { IDatabase } from './schema.js';

export type {
  IFindingRecord,
  IFindingResolutionIntent,
  IFindingRowInput,
  IFindingsListFilter,
  IFindingsWriteIntent,
} from '../../types/storage.js';

type TDbOrTx = Kysely<IDatabase> | Transaction<IDatabase>;

/**
 * One fully-composed `state_findings` row ready for INSERT (every column
 * except the autoincrement `id`). `replaceFindingsForNode` consumers
 * normally reach this shape through `writeFindingsForNode`, which stamps
 * the node-derived `bodyHashAtGeneration` from the live scan row.
 */
export interface IFindingInsertRow extends IFindingRowInput {
  extensionVersion: string;
  /** Agent-self-reported `--model` of the recording callback; `null` when undeclared. */
  model: string | null;
  bodyHashAtGeneration: string;
  generatedAt: number;
  jobId: string | null;
}

/**
 * Replace the stored judgment for `(nodeId, extensionId)`: DELETE every
 * existing row for the pair, BOTH origins (`extension` + `kernel`), then
 * INSERT the fresh rows. Designed to run inside the record transaction;
 * an empty `rows` array is a legitimate clean verdict (pure erase).
 */
export async function replaceFindingsForNode(
  db: TDbOrTx,
  nodeId: string,
  extensionId: string,
  rows: readonly IFindingInsertRow[],
): Promise<void> {
  await db
    .deleteFrom('state_findings')
    .where('nodeId', '=', nodeId)
    .where('extensionId', '=', extensionId)
    .execute();
  if (rows.length === 0) return;
  await db
    .insertInto('state_findings')
    .values(
      rows.map((row) => ({
        nodeId,
        extensionId,
        extensionVersion: row.extensionVersion,
        origin: row.origin,
        type: row.type,
        severity: row.severity,
        message: row.message,
        detail: row.detail,
        confidence: row.confidence,
        model: row.model,
        bodyHashAtGeneration: row.bodyHashAtGeneration,
        generatedAt: row.generatedAt,
        jobId: row.jobId,
      })),
    )
    .execute();
}

/**
 * Record-path write: read the target node's live `body_hash` from
 * `scan_nodes` and, when the node still exists, replace the pair's rows
 * with the intent's (each stamped with the live hash). Returns `true`
 * when the replace ran, `false` when the node is absent (deleted /
 * renamed since submit), in which case the ENTIRE write is skipped and
 * the previous rows are kept, same rule as the summaries upsert
 * (`spec/db-schema.md` §state_findings). Runs on whatever handle the
 * caller passes so the read + write stay atomic inside the record
 * transaction.
 */
export async function writeFindingsForNode(
  db: TDbOrTx,
  nodeId: string,
  intent: IFindingsWriteIntent,
): Promise<boolean> {
  const node = await db
    .selectFrom('scan_nodes')
    .select(['bodyHash'])
    .where('path', '=', nodeId)
    .executeTakeFirst();
  if (!node) return false;
  await replaceFindingsForNode(
    db,
    nodeId,
    intent.extensionId,
    intent.rows.map((row) => ({
      ...row,
      extensionVersion: intent.extensionVersion,
      model: intent.model,
      bodyHashAtGeneration: node.bodyHash,
      generatedAt: intent.generatedAt,
      jobId: intent.jobId,
    })),
  );
  return true;
}

/**
 * Record-path stamp for a FIXER's outcome (`spec/db-schema.md`
 * §state_findings, "Fixer resolution state"): write the lifecycle `state`
 * each `resolved[]` entry declares onto the finding its `id` names. Runs
 * on the caller's handle so the stamps stay atomic inside the record
 * transaction, alongside the execution insert + job transition.
 *
 * Three guards, each SKIPPING the entry silently rather than failing the
 * job (a fixer's report is not a place to surface storage-scope errors,
 * and its edits already landed on disk):
 *
 *   - **unknown id**: a benign race. The finder re-ran between submit and
 *     record, replacing its rows, so the resolution is moot.
 *   - **wrong node**: the row belongs to a node this job did not target.
 *   - **outside `analyzerIds`**: the row came from a finder this fixer
 *     does not serve.
 *
 * The last two are DEFENSIVE SCOPE: a fixer can never stamp a finding
 * outside its own, however its report is composed. Returns the number of
 * rows actually stamped (the caller may report it; the skips are silent
 * by contract).
 */
export async function stampFindingResolutions(
  db: TDbOrTx,
  nodeId: string,
  intent: IFindingResolutionIntent,
): Promise<number> {
  let stamped = 0;
  for (const entry of intent.entries) {
    const row = await db
      .selectFrom('state_findings')
      .select(['id', 'nodeId', 'extensionId'])
      .where('id', '=', entry.id)
      .executeTakeFirst();
    // Unknown id (finder re-ran), foreign node, or a finder outside this
    // fixer's declared scope: skip, never fail.
    if (!row) continue;
    if (row.nodeId !== nodeId) continue;
    if (!matchesQualifiedExtensionFilter(row.extensionId, intent.analyzerIds)) continue;
    await db
      .updateTable('state_findings')
      .set({
        // The lifecycle STATE the fixer declared (`fixed` / `declined`),
        // stamped verbatim onto the finding it named.
        resolution: entry.state,
        // The fixer's note, verbatim (agent-supplied: sanitized at render,
        // never on the way in, so the machine surface round-trips).
        resolutionNote: entry.note,
        resolutionBy: intent.resolvedBy,
        resolutionAt: intent.resolvedAt,
      })
      .where('id', '=', entry.id)
      .execute();
    stamped += 1;
  }
  return stamped;
}

/**
 * Count the STALE rows (`spec/db-schema.md` §state_findings stale rule):
 * `body_hash_at_generation` differs from the node's live
 * `scan_nodes.body_hash`, or the node is gone from `scan_nodes` entirely
 * (the same LEFT-JOIN staleness `listFindings` derives). Backs the
 * `sm findings prune` dry-run / confirmation count.
 */
export async function countStaleFindings(db: TDbOrTx): Promise<number> {
  const row = await db
    .selectFrom('state_findings')
    .leftJoin('scan_nodes', 'scan_nodes.path', 'state_findings.nodeId')
    .where((eb) =>
      eb.or([
        eb('scan_nodes.path', 'is', null),
        eb('scan_nodes.bodyHash', '!=', eb.ref('state_findings.bodyHashAtGeneration')),
      ]),
    )
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

/**
 * Delete every STALE row (`sm findings prune`), never a fresh one: pure
 * hygiene, the read side already hides stale rows by default and a fresh
 * record for the pair is the only other eraser. Returns the deleted row
 * count.
 */
export async function deleteStaleFindings(db: TDbOrTx): Promise<number> {
  const result = await db
    .deleteFrom('state_findings')
    .where('id', 'in', (eb) =>
      eb
        .selectFrom('state_findings as sf')
        .leftJoin('scan_nodes', 'scan_nodes.path', 'sf.nodeId')
        .where((web) =>
          web.or([
            web('scan_nodes.path', 'is', null),
            web('scan_nodes.bodyHash', '!=', web.ref('sf.bodyHashAtGeneration')),
          ]),
        )
        .select('sf.id'),
    )
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}

/** Rank used by the minimum-severity filter: `info` < `warn` < `error`. */
const SEVERITY_RANK: Record<Severity, number> = { info: 0, warn: 1, error: 2 };

/**
 * Read `state_findings` with the derived `stale` flag. Staleness is
 * computed via a LEFT JOIN against `scan_nodes`: a row is stale when its
 * `body_hash_at_generation` differs from the node's live `body_hash` OR
 * the node is gone from the scan entirely. Stale rows are EXCLUDED unless
 * `filter.includeStale` is set (they are then returned flagged). The
 * scalar filters (`nodeId`, `type`, `sinceMs`, `minConfidence`) push down
 * to SQL; `extensionIds` (suffix matching) and `minSeverity` (rank
 * comparison) apply in TS on the projected rows. Ordered by
 * `(node_id, extension_id, id)` ASC for stable rendering.
 */
export async function listFindings(
  db: TDbOrTx,
  filter: IFindingsListFilter = {},
): Promise<IFindingRecord[]> {
  let query = db
    .selectFrom('state_findings')
    .leftJoin('scan_nodes', 'scan_nodes.path', 'state_findings.nodeId')
    .select([
      'state_findings.id as id',
      'state_findings.nodeId as nodeId',
      'state_findings.extensionId as extensionId',
      'state_findings.extensionVersion as extensionVersion',
      'state_findings.origin as origin',
      'state_findings.type as type',
      'state_findings.severity as severity',
      'state_findings.message as message',
      'state_findings.detail as detail',
      'state_findings.confidence as confidence',
      'state_findings.model as model',
      'state_findings.resolution as resolution',
      'state_findings.resolutionNote as resolutionNote',
      'state_findings.resolutionBy as resolutionBy',
      'state_findings.resolutionAt as resolutionAt',
      'state_findings.bodyHashAtGeneration as bodyHashAtGeneration',
      'state_findings.generatedAt as generatedAt',
      'state_findings.jobId as jobId',
      'scan_nodes.bodyHash as liveBodyHash',
    ])
    .orderBy('state_findings.nodeId', 'asc')
    .orderBy('state_findings.extensionId', 'asc')
    .orderBy('state_findings.id', 'asc');

  if (filter.nodeId !== undefined) {
    query = query.where('state_findings.nodeId', '=', filter.nodeId);
  }
  if (filter.type !== undefined) {
    query = query.where('state_findings.type', '=', filter.type);
  }
  if (filter.sinceMs !== undefined) {
    query = query.where('state_findings.generatedAt', '>=', filter.sinceMs);
  }
  if (filter.minConfidence !== undefined) {
    query = query.where('state_findings.confidence', '>=', filter.minConfidence);
  }

  return projectAndFilterRows(await query.execute(), filter);
}

/**
 * Post-SQL leg: derive `stale` per row (JOIN column), apply the filters
 * that cannot push down to SQL, and project the port shape.
 */
function projectAndFilterRows(
  rows: readonly TJoinedFindingRow[],
  filter: IFindingsListFilter,
): IFindingRecord[] {
  const out: IFindingRecord[] = [];
  for (const row of rows) {
    const stale = row.liveBodyHash === null || row.liveBodyHash !== row.bodyHashAtGeneration;
    if (!passesTsFilters(row, stale, filter)) continue;
    out.push(projectRow(row, stale));
  }
  return out;
}

/** Joined projection the SELECT in `listFindings` produces. */
type TJoinedFindingRow = Omit<IFindingRecord, 'stale'> & { liveBodyHash: string | null };

/**
 * The filter legs that cannot push down to SQL: staleness (JOIN-derived),
 * extension-id suffix matching, and the severity rank comparison.
 */
function passesTsFilters(
  row: TJoinedFindingRow,
  stale: boolean,
  filter: IFindingsListFilter,
): boolean {
  if (stale && filter.includeStale !== true) return false;
  if (
    filter.extensionIds !== undefined &&
    filter.extensionIds.length > 0 &&
    !matchesQualifiedExtensionFilter(row.extensionId, filter.extensionIds)
  ) {
    return false;
  }
  if (
    filter.minSeverity !== undefined &&
    SEVERITY_RANK[row.severity] < SEVERITY_RANK[filter.minSeverity]
  ) {
    return false;
  }
  return true;
}

/** Drop the JOIN column, attach the derived `stale` flag. */
function projectRow(row: TJoinedFindingRow, stale: boolean): IFindingRecord {
  return {
    id: row.id,
    nodeId: row.nodeId,
    extensionId: row.extensionId,
    extensionVersion: row.extensionVersion,
    origin: row.origin,
    type: row.type,
    severity: row.severity,
    message: row.message,
    detail: row.detail,
    confidence: row.confidence,
    model: row.model,
    // Fixer lifecycle state, never a verdict: a `fixed` state does NOT
    // erase the row, only a finder re-judging does; the default `sm
    // findings` view hides it, this read still returns it.
    resolution: row.resolution,
    resolutionNote: row.resolutionNote,
    resolutionBy: row.resolutionBy,
    resolutionAt: row.resolutionAt,
    bodyHashAtGeneration: row.bodyHashAtGeneration,
    generatedAt: row.generatedAt,
    jobId: row.jobId,
    stale,
  };
}
