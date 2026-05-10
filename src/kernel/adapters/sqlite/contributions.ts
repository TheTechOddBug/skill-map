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
 * the slot's payload schema happens at emit time (orchestrator);
 * by the time records reach this adapter they are wire-shape clean.
 */
export interface IContributionRecord {
  pluginId: string;
  extensionId: string;
  nodePath: string;
  contributionId: string;
  /**
   * Closed enum value mirroring `view-slots.schema.json#/$defs/SlotName`.
   * Persisted as TEXT (no SQL CHECK by design — see migration comment).
   */
  slot: string;
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
 *   3. **Per-tuple sweep** — for every `(pluginId, extensionId,
 *      nodePath)` triple where the extension actually RAN this scan
 *      (extractor cache miss, OR rule), drop any row carrying that
 *      triple whose `contributionId` is NOT refreshed by the buffer.
 *      Catches the "extractor used to emit, now does not" case
 *      without touching cached-extractor rows. Cached tuples are NOT
 *      in `freshlyRunTuples`, so their rows survive untouched.
 *   4. Upserts every row in the buffer (PK conflict → REPLACE so the
 *      payload + emittedAt refresh).
 *
 * Cached nodes' rows survive untouched because they're neither
 * orphaned nor uninstalled nor in `freshlyRunTuples`. The next time
 * the body changes, the orchestrator re-runs the extractor, the
 * tuple lands in `freshlyRunTuples`, and either the upsert refreshes
 * the row or the per-tuple sweep drops it.
 *
 * Empty buffer + empty live set is a no-op (cold start, no scan
 * yet); empty buffer with non-empty live set is the cached-pass
 * case where every contribution stays put.
 */
// Complexity counts the orphan / catalog / per-tuple sweep + upsert
// paths and their optional short-circuits. The algorithm is a single
// linear flow (sweep → sweep → sweep → upsert) bound to the same
// transaction; splitting it into helpers would scatter the txn-bound
// semantics for no clarity win.
// eslint-disable-next-line complexity
export async function replaceAllScanContributions(
  trx: Transaction<IDatabase>,
  contributions: readonly IContributionRecord[],
  livePaths: ReadonlySet<string> = new Set(),
  registeredKeys: ReadonlySet<string> = new Set(),
  freshlyRunTuples: ReadonlySet<string> = new Set(),
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

  // 3) Per-tuple sweep — for each `(pluginId, extensionId, nodePath)`
  //    where the extension actually ran this scan (cache miss for
  //    extractors, all rules), drop rows whose `contributionId` is NOT
  //    refreshed by the buffer. Catches the "extractor used to emit,
  //    now does not" case (e.g. body change removes the trigger).
  //    Cached tuples are absent from `freshlyRunTuples`, so their
  //    rows survive untouched (the cache-preservation invariant the
  //    rest of this function exists to honour).
  if (freshlyRunTuples.size > 0) {
    // Build a Set<string> of buffer keys per (plugin, extension, node)
    // so the diff is O(rows + buffer) instead of O(rows × buffer).
    // Format: `<pluginId>/<extensionId>/<nodePath>/<contributionId>`.
    const bufferKeys = new Set<string>();
    for (const c of contributions) {
      bufferKeys.add(`${c.pluginId}/${c.extensionId}/${c.nodePath}/${c.contributionId}`);
    }
    // Group freshly-run tuples by their (plugin, extension) so we can
    // narrow the SELECT to one query per (plugin, extension) and let
    // SQLite use the existing `(plugin_id)` index. The (node) leg is
    // filtered in-memory after the read.
    const tuplesByPluginExt = new Map<string, Set<string>>(); // key = `${plugin}/${ext}`, value = Set<nodePath>
    for (const tuple of freshlyRunTuples) {
      const lastSlash = tuple.lastIndexOf('/');
      if (lastSlash < 0) continue;
      const pe = tuple.slice(0, lastSlash);
      const node = tuple.slice(lastSlash + 1);
      let nodes = tuplesByPluginExt.get(pe);
      if (!nodes) {
        nodes = new Set<string>();
        tuplesByPluginExt.set(pe, nodes);
      }
      nodes.add(node);
    }
    for (const [pe, nodes] of tuplesByPluginExt) {
      const slash = pe.indexOf('/');
      if (slash < 0) continue;
      const pluginId = pe.slice(0, slash);
      const extensionId = pe.slice(slash + 1);
      const nodeArr = [...nodes];
      const candidates = await trx
        .selectFrom('scan_contributions')
        .select(['nodePath', 'contributionId'])
        .where('pluginId', '=', pluginId)
        .where('extensionId', '=', extensionId)
        .where('nodePath', 'in', nodeArr)
        .execute();
      const stale: Array<{ nodePath: string; contributionId: string }> = [];
      for (const row of candidates) {
        const key = `${pluginId}/${extensionId}/${row.nodePath}/${row.contributionId}`;
        if (!bufferKeys.has(key)) stale.push(row);
      }
      for (const s of stale) {
        await trx
          .deleteFrom('scan_contributions')
          .where('pluginId', '=', pluginId)
          .where('extensionId', '=', extensionId)
          .where('nodePath', '=', s.nodePath)
          .where('contributionId', '=', s.contributionId)
          .execute();
      }
    }
  }

  if (contributions.length === 0) return;

  // 4) Upsert the buffer. Composite PK is `(plugin_id, extension_id,
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
      slot: c.slot,
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
            slot: eb.ref('excluded.slot'),
            payloadJson: eb.ref('excluded.payloadJson'),
            emittedAt: eb.ref('excluded.emittedAt'),
          })),
      )
      .execute();
  }
}

/**
 * Single contribution row as returned to callers. The payload is
 * `unknown` because the slot space is open at the type layer (catalog
 * evolution is a kernel + spec concern); narrow at the call site by
 * reading `slot`.
 */
export interface IPersistedContribution {
  pluginId: string;
  extensionId: string;
  nodePath: string;
  contributionId: string;
  slot: string;
  payload: unknown;
  emittedAt: number;
}

/**
 * Load every contribution row for a single node, stable order
 * (`pluginId` ASC, `extensionId` ASC, `contributionId` ASC). Used by
 * the BFF's single-node response builder — the UI's slot host then
 * filters by `slot` directly (each row carries its target slot; the
 * kernel emits a flat list).
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
 * Drop contribution rows for a given plugin (optionally narrowed to a
 * single extension within the bundle). Used by `sm plugins disable` to
 * clear stale rows immediately at toggle time — without the purge, the
 * UI would keep rendering the disabled plugin's chips until the next
 * `sm scan` triggered the catalog sweep above.
 *
 * - `extensionId` omitted → wipes every row whose `pluginId` matches
 *   (bundle-granularity disable, e.g. `sm plugins disable claude`).
 * - `extensionId` supplied → narrows to the `(pluginId, extensionId)`
 *   pair (extension-granularity disable, e.g.
 *   `sm plugins disable core/slash`).
 *
 * Does NOT cascade across plugin families — the caller decides the
 * granularity by passing (or omitting) `extensionId`.
 */
export async function purgeContributionsByPlugin(
  db: Kysely<IDatabase>,
  pluginId: string,
  extensionId?: string,
): Promise<number> {
  let query = db.deleteFrom('scan_contributions').where('pluginId', '=', pluginId);
  if (extensionId !== undefined) {
    query = query.where('extensionId', '=', extensionId);
  }
  const result = await query.executeTakeFirst();
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
    slot: row.slot,
    payload,
    emittedAt: row.emittedAt,
  };
}
