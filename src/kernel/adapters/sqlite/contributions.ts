/**
 * `scan_contributions` adapter — replace-all writer used by
 * `persistScanResult`, plus read helpers consumed by the BFF
 * (`/api/contributions/...`) and rules (`core/contribution-orphan`).
 *
 * One row per `(plugin_id, extension_id, node_path, contribution_id)`
 * tuple. See `spec/architecture.md` § View contribution system →
 * Persistence and `migrations/001_initial.sql` § View contribution
 * layer for the normative shape.
 *
 * Replace-all semantics mirror the rest of the `scan_*` zone: every
 * scan is a fresh snapshot, so prior rows are deleted before insert.
 * Wrapped in the same transaction `persistScanResult` opens.
 *
 * The rename heuristic does NOT need to migrate `node_path` here —
 * because of replace-all, every contribution is re-emitted on the new
 * path automatically. Keeping the rename path lighter than `state_*`
 * (which IS rename-migrated because state survives across scans).
 */

import type { Insertable, Kysely, Selectable, Transaction } from 'kysely';

import type { IDatabase, IScanContributionsTable } from './schema.js';

/**
 * In-memory contribution record buffered during scan and flushed to
 * `scan_contributions` by `persistScanResult`. One entry per accepted
 * `ctx.emitContribution(id, payload)` call. Payload validation against
 * the contract's payload schema happens at emit time (orchestrator);
 * by the time records reach this adapter they are wire-shape clean.
 */
export interface IContributionRecord {
  pluginId: string;
  extensionId: string;
  nodePath: string;
  contributionId: string;
  /**
   * Closed enum value mirroring `view-contracts.schema.json#/$defs/ContractName`.
   * Persisted as TEXT (no SQL CHECK by design — see migration comment).
   */
  contract: string;
  /** Already-validated payload. Serialised via `JSON.stringify` at write. */
  payload: unknown;
  emittedAt: number;
}

/**
 * Persist the per-scan contributions buffer.
 *
 * Semantics — this is **NOT pure replace-all** (the way `scan_links`
 * and `scan_issues` are). Cached nodes don't re-emit contributions
 * (the orchestrator skips `extract()` when the per-(node, extractor)
 * cache hits), so a wipe-all would silently drop their valid prior
 * rows on every watcher pass. Instead the persist:
 *
 *   1. Drops every row whose `node_path` is NOT in the current live
 *      node set — disappeared nodes lose their contributions.
 *   2. Drops every row whose qualified id `(pluginId, extensionId,
 *      contributionId)` is NOT in the buffer's catalog AND NOT in
 *      the registered runtime catalog — uninstalled plugins / removed
 *      contributions lose their rows.
 *   3. Upserts every row in the buffer (PK conflict → REPLACE so the
 *      payload + emittedAt refresh).
 *
 * Cached nodes' rows survive untouched because they're neither
 * orphaned (still in the live set) nor uninstalled (still in the
 * catalog). The next time the body changes, the orchestrator
 * re-runs the extractor, fresh contributions land in the buffer,
 * and the upsert refreshes them.
 *
 * Empty buffer + empty live set is a no-op (cold start, no scan
 * yet); empty buffer with non-empty live set is the cached-pass
 * case where every contribution stays put.
 */
// Complexity counts the orphan-sweep / catalog-sweep / upsert paths
// + the optional `livePaths` / `registeredKeys` short-circuits. The
// algorithm is a single linear flow (sweep → upsert), splitting it
// into helpers would scatter the txn-bound semantics for no clarity
// win.
// eslint-disable-next-line complexity
export async function replaceAllScanContributions(
  trx: Transaction<IDatabase>,
  contributions: readonly IContributionRecord[],
  livePaths: ReadonlySet<string> = new Set(),
  registeredKeys: ReadonlySet<string> = new Set(),
): Promise<void> {
  // 1) Orphan sweep — drop rows for nodes that disappeared.
  if (livePaths.size > 0) {
    const livePathsArr = [...livePaths];
    await trx
      .deleteFrom('scan_contributions')
      .where('nodePath', 'not in', livePathsArr)
      .execute();
  } else {
    // No live paths supplied (legacy callers) — preserve the old
    // wipe-all behaviour so a fresh scan from a primed DB still
    // resets when no nodes survive.
    await trx.deleteFrom('scan_contributions').execute();
  }

  // 2) Catalog sweep — drop rows whose qualified id no longer
  //    appears in the runtime catalog. The buffer is always a
  //    superset of in-scope keys for the current scan; merging with
  //    the explicit `registeredKeys` set (when supplied) covers the
  //    "extension declared the contribution but emitted nothing this
  //    pass" case (e.g. cached nodes only).
  if (registeredKeys.size > 0) {
    const allRows = await trx
      .selectFrom('scan_contributions')
      .select(['pluginId', 'extensionId', 'contributionId'])
      .execute();
    const stale: Array<{ pluginId: string; extensionId: string; contributionId: string }> = [];
    for (const r of allRows) {
      const key = `${r.pluginId}/${r.extensionId}/${r.contributionId}`;
      if (!registeredKeys.has(key)) stale.push(r);
    }
    for (const s of stale) {
      await trx
        .deleteFrom('scan_contributions')
        .where('pluginId', '=', s.pluginId)
        .where('extensionId', '=', s.extensionId)
        .where('contributionId', '=', s.contributionId)
        .execute();
    }
  }

  if (contributions.length === 0) return;

  // 3) Upsert the buffer. Composite PK is `(plugin_id, extension_id,
  //    node_path, contribution_id)` so we use `onConflict.doUpdateSet`
  //    instead of plain `insertInto`. Same chunk-size posture as the
  //    enrichment upsert (≤ 500 rows per chunk to stay under SQLite's
  //    999-binding limit; 7 columns × 500 = 3500 bindings).
  const CHUNK = 500;
  for (let i = 0; i < contributions.length; i += CHUNK) {
    const slice = contributions.slice(i, i + CHUNK);
    const rows: Insertable<IScanContributionsTable>[] = slice.map((c) => ({
      pluginId: c.pluginId,
      extensionId: c.extensionId,
      nodePath: c.nodePath,
      contributionId: c.contributionId,
      contract: c.contract,
      payloadJson: JSON.stringify(c.payload),
      emittedAt: c.emittedAt,
    }));
    await trx
      .insertInto('scan_contributions')
      .values(rows)
      .onConflict((oc) =>
        oc
          .columns(['pluginId', 'extensionId', 'nodePath', 'contributionId'])
          .doUpdateSet((eb) => ({
            contract: eb.ref('excluded.contract'),
            payloadJson: eb.ref('excluded.payloadJson'),
            emittedAt: eb.ref('excluded.emittedAt'),
          })),
      )
      .execute();
  }
}

/**
 * Single contribution row as returned to callers. The payload is
 * `unknown` because the contract space is open at the type layer
 * (catalog evolution is a kernel + spec concern); narrow at the call
 * site by reading `contract`.
 */
export interface IPersistedContribution {
  pluginId: string;
  extensionId: string;
  nodePath: string;
  contributionId: string;
  contract: string;
  payload: unknown;
  emittedAt: number;
}

/**
 * Load every contribution row for a single node, stable order
 * (`pluginId` ASC, `extensionId` ASC, `contributionId` ASC). Used by
 * the BFF's single-node response builder — the UI's slot host then
 * filters by slot via the contract → slot map (slots are UI-only;
 * the kernel emits a flat list).
 *
 * Cold-start posture: returns `[]` when the table is missing. Callers
 * upstream check via `tryWithSqlite`-style wrappers; this function
 * itself trusts the schema is provisioned (the storage adapter's
 * boot path runs migrations before any read).
 */
export async function loadContributionsForNode(
  db: Kysely<IDatabase>,
  nodePath: string,
): Promise<IPersistedContribution[]> {
  const rows = await db
    .selectFrom('scan_contributions')
    .selectAll()
    .where('nodePath', '=', nodePath)
    .orderBy('pluginId', 'asc')
    .orderBy('extensionId', 'asc')
    .orderBy('contributionId', 'asc')
    .execute();
  return rows.map(rowToContribution);
}

/**
 * Bulk variant — load contributions for an explicit list of node paths
 * in one round-trip. Used by the BFF's nodes-list route to embed
 * contributions in the page slice when `limit ≤ bff.maxBulkContributions`
 * (default 200).
 *
 * Stable order: `nodePath` ASC, then the same triple ASC ordering as
 * the single-node load. Empty `paths` returns `[]` without a query.
 */
export async function loadContributionsForPaths(
  db: Kysely<IDatabase>,
  paths: readonly string[],
): Promise<IPersistedContribution[]> {
  if (paths.length === 0) return [];
  const rows = await db
    .selectFrom('scan_contributions')
    .selectAll()
    .where('nodePath', 'in', paths)
    .orderBy('nodePath', 'asc')
    .orderBy('pluginId', 'asc')
    .orderBy('extensionId', 'asc')
    .orderBy('contributionId', 'asc')
    .execute();
  return rows.map(rowToContribution);
}

/**
 * Lazy per-(plugin, extension, contribution) lookup. Used by
 * `GET /api/contributions/:pluginId/:contributionId?path=...`.
 *
 * The route accepts a 2-segment qualified id (no extensionId) for
 * backwards-compat with the design narrative — the disambiguation
 * happens here by joining all matching rows for the (pluginId,
 * contributionId) pair against the path. In practice, an extension's
 * Record key is unique within a plugin (the manifest enforces it) so
 * the result is at most one row per (pluginId, contributionId, path)
 * tuple. Pass `extensionId` to narrow further.
 */
export async function loadContributionLookup(
  db: Kysely<IDatabase>,
  pluginId: string,
  contributionId: string,
  nodePath: string,
  extensionId?: string,
): Promise<IPersistedContribution[]> {
  let query = db
    .selectFrom('scan_contributions')
    .selectAll()
    .where('pluginId', '=', pluginId)
    .where('contributionId', '=', contributionId)
    .where('nodePath', '=', nodePath);
  if (extensionId !== undefined) {
    query = query.where('extensionId', '=', extensionId);
  }
  const rows = await query
    .orderBy('extensionId', 'asc')
    .execute();
  return rows.map(rowToContribution);
}

/**
 * Drop every row for a given plugin id. Used by the (future)
 * `sm plugins disable --purge` flag and by the install path when a
 * plugin is removed from disk between scans.
 *
 * Does NOT cascade across extensions of the same plugin family —
 * caller decides the granularity.
 */
export async function purgeContributionsByPlugin(
  db: Kysely<IDatabase>,
  pluginId: string,
): Promise<number> {
  const result = await db
    .deleteFrom('scan_contributions')
    .where('pluginId', '=', pluginId)
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0n);
}

function rowToContribution(
  row: Selectable<IScanContributionsTable>,
): IPersistedContribution {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payloadJson);
  } catch {
    // Defensive — row was written via `replaceAllScanContributions`
    // which always serialises with `JSON.stringify`. A parse failure
    // here indicates manual DB tampering or a corrupt page; surface
    // an empty object rather than throwing so the BFF response stays
    // best-effort.
    payload = {};
  }
  return {
    pluginId: row.pluginId,
    extensionId: row.extensionId,
    nodePath: row.nodePath,
    contributionId: row.contributionId,
    contract: row.contract,
    payload,
    emittedAt: row.emittedAt,
  };
}
