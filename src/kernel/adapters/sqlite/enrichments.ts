/**
 * Storage helpers for `state_enrichments`, the per-node enrichment
 * write-through populated by `sm enrich` (`spec/db-schema.md`
 * §state_enrichments), Model A of the enrichment split.
 *
 * A row lands when `sm enrich` executes an enabled enricher Action
 * (one whose report schema extends a canonical `enrichments/<kind>`
 * schema, see `kernel/enrichments/enrichment-schema.ts`): the validated
 * report is upserted here keyed `(node_id, provider_id)` where
 * `provider_id` carries the Action's QUALIFIED id (e.g.
 * `github/enrichment`). This is the mirror of the summaries
 * write-through (`summaries.ts`); the Model B Extractor layer
 * (`node_enrichments`) is a different table with different semantics,
 * do not conflate the two.
 *
 * Staleness (v1): there is no declared refresh policy yet, so
 * `stale_after` is always NULL and body-hash drift is the only signal.
 * A row is a stale candidate when `data_json.localBodyHash` (stamped by
 * the enricher at verification time) differs from the node's current
 * `scan_nodes.body_hash`, OR when a non-null `stale_after` has passed
 * (future-proofing for the declared-policy revision). The comparison
 * runs SQL-side via `json_extract` joined against `scan_nodes`, so a
 * large corpus never hydrates every state row into memory; rows whose
 * node no longer exists in the scan are excluded (there is nothing to
 * refresh against).
 *
 * Every helper accepts a `Kysely<IDatabase>` OR a `Transaction<IDatabase>`
 * so the refresh path can compose the upsert inside its existing
 * transaction (state row + execution row land atomically), while a read
 * (or a storage-level test) can call directly on the base handle.
 */

import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';

import type {
  IStateEnrichmentRecord,
  IStateEnrichmentUpsert,
} from '../../types/storage.js';
import type { IDatabase, IStateEnrichmentsTable } from './schema.js';

export type {
  IStateEnrichmentRecord,
  IStateEnrichmentUpsert,
} from '../../types/storage.js';

type TDbOrTx = Kysely<IDatabase> | Transaction<IDatabase>;

/**
 * Upsert one state-enrichment row: `INSERT ... ON CONFLICT(node_id,
 * provider_id) DO UPDATE`. A second write for the same
 * `(node_id, provider_id)` REPLACES the prior row in place (refreshing
 * `data_json` / `verified` / `fetched_at` / `stale_after`), never a
 * duplicate: the composite PK carries the conflict.
 */
export async function upsertStateEnrichment(
  db: TDbOrTx,
  row: IStateEnrichmentUpsert,
): Promise<void> {
  const verified = row.verified === null ? null : row.verified ? 1 : 0;
  await db
    .insertInto('state_enrichments')
    .values({
      nodeId: row.nodeId,
      providerId: row.providerId,
      dataJson: row.dataJson,
      verified,
      fetchedAt: row.fetchedAt,
      staleAfter: row.staleAfter,
    })
    .onConflict((oc) =>
      oc.columns(['nodeId', 'providerId']).doUpdateSet({
        dataJson: row.dataJson,
        verified,
        fetchedAt: row.fetchedAt,
        staleAfter: row.staleAfter,
      }),
    )
    .execute();
}

/**
 * Every stored enrichment state row for a single node, ordered by
 * `provider_id` ASC for stable rendering. Backs read-side consumers
 * (`sm enrich`'s post-write reporting, future `sm show` surfaces).
 */
export async function listStateEnrichmentsForNode(
  db: TDbOrTx,
  nodeId: string,
): Promise<IStateEnrichmentRecord[]> {
  const rows = await db
    .selectFrom('state_enrichments')
    .selectAll()
    .where('nodeId', '=', nodeId)
    .orderBy('providerId', 'asc')
    .execute();
  return rows.map(rowToStateEnrichment);
}

/**
 * The stale candidate set for `sm enrich --stale` (v1 staleness rule,
 * see the module header): rows whose recorded `data_json.localBodyHash`
 * differs from the node's live `scan_nodes.body_hash` (the node body
 * was edited and rescanned since the verification), or whose non-null
 * `stale_after` is at/past `nowMs`. Rows with no `localBodyHash` in
 * `data_json` are never body-drift candidates (nothing to compare);
 * rows whose node vanished from `scan_nodes` are excluded via the inner
 * join. Ordered `(nodeId, providerId)` ASC so the verb's iteration is
 * deterministic.
 */
export async function listStaleStateEnrichments(
  db: TDbOrTx,
  nowMs: number,
): Promise<IStateEnrichmentRecord[]> {
  const rows = await db
    .selectFrom('state_enrichments')
    .innerJoin('scan_nodes', 'scan_nodes.path', 'state_enrichments.nodeId')
    .selectAll('state_enrichments')
    .where((eb) =>
      eb.or([
        // Body-hash drift: the JSON1 extract runs on the raw snake_case
        // column (raw SQL fragments bypass the CamelCasePlugin, see the
        // adapter header trap note).
        eb(
          sql<string>`json_extract(state_enrichments.data_json, '$.localBodyHash')`,
          '!=',
          eb.ref('scan_nodes.bodyHash'),
        ),
        // Declared-policy expiry (always NULL in v1, kept for the
        // future revision so the verb ships policy-ready).
        eb.and([
          eb('state_enrichments.staleAfter', 'is not', null),
          eb('state_enrichments.staleAfter', '<=', nowMs),
        ]),
      ]),
    )
    .orderBy('state_enrichments.nodeId', 'asc')
    .orderBy('state_enrichments.providerId', 'asc')
    .execute();
  return rows.map(rowToStateEnrichment);
}

function rowToStateEnrichment(
  row: Selectable<IStateEnrichmentsTable>,
): IStateEnrichmentRecord {
  return {
    nodeId: row.nodeId,
    providerId: row.providerId,
    data: parseData(row.dataJson),
    verified: row.verified === null ? null : row.verified === 1,
    fetchedAt: row.fetchedAt,
    staleAfter: row.staleAfter,
  };
}

/**
 * Parse a stored `data_json` blob. The writer only ever serializes a
 * validated report object, so a non-object / unparseable value is a
 * corruption-only case, degrade to `{}` rather than throwing on a read.
 */
function parseData(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
