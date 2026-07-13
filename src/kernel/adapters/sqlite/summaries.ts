/**
 * Storage helpers for `state_summaries`, the per-node semantic-summary
 * write-through (`spec/db-schema.md` § state_summaries).
 *
 * A summary lands when `sm record` closes a `completed` job whose Action
 * declares `writesSummary: true`: the validated report is upserted here,
 * keyed by `(node_id, summarizer_action_id)`, in the SAME transaction as
 * the `state_executions` insert + job transition (see `recordJobTerminal`
 * in `jobs.ts`). `sm show <node>` reads the rows back via
 * `listSummariesForNode` and flags each `(stale)` when the node's current
 * `scan_nodes.body_hash` no longer matches `body_hash_at_generation`.
 *
 * Every helper accepts a `Kysely<IDatabase>` OR a `Transaction<IDatabase>`
 * so the record path can compose the upsert inside its existing
 * transaction, while a read (or a storage-level test) can call directly on
 * the base handle.
 */

import type { Kysely, Selectable, Transaction } from 'kysely';

import type { ISummaryRecord, ISummaryWriteIntent } from '../../types/storage.js';
import type { IDatabase, IStateSummariesTable } from './schema.js';

export type { ISummaryRecord, ISummaryWriteIntent } from '../../types/storage.js';

type TDbOrTx = Kysely<IDatabase> | Transaction<IDatabase>;

/**
 * Full `state_summaries` row (all seven columns) for a direct upsert.
 * `kind` + `bodyHashAtGeneration` are the node-derived fields the record
 * path fills from `scan_nodes`; the rest come straight from the caller.
 */
export interface ISummaryUpsertRow {
  nodeId: string;
  kind: string;
  summarizerActionId: string;
  summarizerVersion: string;
  bodyHashAtGeneration: string;
  generatedAt: number;
  summaryJson: string;
}

/**
 * Upsert one summary row: `INSERT ... ON CONFLICT(node_id,
 * summarizer_action_id) DO UPDATE`. A second write for the same
 * `(node_id, summarizer_action_id)` REPLACES the prior row in place
 * (refreshing `kind` / `summarizer_version` / `body_hash_at_generation` /
 * `generated_at` / `summary_json`), never a duplicate: the composite PK
 * carries the conflict.
 */
export async function upsertSummary(db: TDbOrTx, row: ISummaryUpsertRow): Promise<void> {
  await db
    .insertInto('state_summaries')
    .values({
      nodeId: row.nodeId,
      kind: row.kind,
      summarizerActionId: row.summarizerActionId,
      summarizerVersion: row.summarizerVersion,
      bodyHashAtGeneration: row.bodyHashAtGeneration,
      generatedAt: row.generatedAt,
      summaryJson: row.summaryJson,
    })
    .onConflict((oc) =>
      oc.columns(['nodeId', 'summarizerActionId']).doUpdateSet({
        kind: row.kind,
        summarizerVersion: row.summarizerVersion,
        bodyHashAtGeneration: row.bodyHashAtGeneration,
        generatedAt: row.generatedAt,
        summaryJson: row.summaryJson,
      }),
    )
    .execute();
}

/**
 * Record-path upsert: read the target node's live `kind` + `body_hash`
 * from `scan_nodes` and, when the node still exists, upsert the summary
 * with those values. Returns `true` when a row was written, `false` when
 * the node is absent (deleted / renamed since the job was submitted, in
 * which case the caller keeps the execution record but writes no summary).
 * Runs on whatever handle the caller passes so the read + write stay
 * atomic inside the record transaction.
 */
export async function upsertSummaryForNode(
  db: TDbOrTx,
  nodeId: string,
  intent: ISummaryWriteIntent,
): Promise<boolean> {
  const node = await db
    .selectFrom('scan_nodes')
    .select(['kind', 'bodyHash'])
    .where('path', '=', nodeId)
    .executeTakeFirst();
  if (!node) return false;
  await upsertSummary(db, {
    nodeId,
    kind: node.kind,
    summarizerActionId: intent.summarizerActionId,
    summarizerVersion: intent.summarizerVersion,
    bodyHashAtGeneration: node.bodyHash,
    generatedAt: intent.generatedAt,
    summaryJson: intent.summaryJson,
  });
  return true;
}

/**
 * Every stored summary for a single node, ordered by
 * `summarizer_action_id` ASC for stable rendering. Backs
 * `sm show <node>`'s Summary section (and its `--json` `summaries` array).
 */
export async function listSummariesForNode(
  db: TDbOrTx,
  nodeId: string,
): Promise<ISummaryRecord[]> {
  const rows = await db
    .selectFrom('state_summaries')
    .selectAll()
    .where('nodeId', '=', nodeId)
    .orderBy('summarizerActionId', 'asc')
    .execute();
  return rows.map(rowToSummary);
}

function rowToSummary(row: Selectable<IStateSummariesTable>): ISummaryRecord {
  return {
    nodeId: row.nodeId,
    kind: row.kind,
    summarizerActionId: row.summarizerActionId,
    summarizerVersion: row.summarizerVersion,
    bodyHashAtGeneration: row.bodyHashAtGeneration,
    generatedAt: row.generatedAt,
    report: parseReport(row.summaryJson),
  };
}

/**
 * Parse a stored `summary_json` blob. The writer only ever serializes a
 * validated report object, so a non-object / unparseable value is a
 * corruption-only case, degrade to `{}` rather than throwing on a read.
 */
function parseReport(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
