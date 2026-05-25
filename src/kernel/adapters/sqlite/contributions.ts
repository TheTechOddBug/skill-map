/**
 * `scan_contributions` adapter, replace-all writer used by
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
 * The rename heuristic does NOT need to migrate `node_path` here,
 * because of replace-all, every contribution is re-emitted on the new
 * path automatically. Keeping the rename path lighter than `state_*`
 * (which IS rename-migrated because state survives across scans).
 */

import type { Insertable, Kysely, Selectable, Transaction } from 'kysely';

import { stripPrototypePollution } from '../../util/strip-prototype-pollution.js';
import type { IPersistedContribution } from '../../types/storage.js';
import type { IDatabase, IScanContributionsTable } from './schema.js';

// Re-export so existing consumers that import `IPersistedContribution`
// from the adapter path keep resolving. The canonical declaration
// lives in `kernel/types/storage.ts` so non-SQLite adapters can
// implement `StoragePort` without depending on the SQLite module.
export type { IPersistedContribution };

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
   * Persisted as TEXT (no SQL CHECK by design, see migration comment).
   */
  slot: string;
  /** Already-validated payload. Serialised via `JSON.stringify` at write. */
  payload: unknown;
  emittedAt: number;
}

/**
 * Persist the per-scan contributions buffer.
 *
 * Semantics, this is **NOT pure replace-all** (the way `scan_links`
 * and `scan_issues` are). Cached nodes don't re-emit contributions
 * (the orchestrator skips `extract()` when the per-(node, extractor)
 * cache hits), so a wipe-all would silently drop their valid prior
 * rows on every watcher pass. Instead the persist:
 *
 *   1. Drops every row whose `node_path` is NOT in the current live
 *      node set, disappeared nodes lose their contributions.
 *   2. Drops every row whose qualified id `(pluginId, extensionId,
 *      contributionId)` is NOT in the buffer's catalog AND NOT in
 *      the registered runtime catalog, uninstalled plugins / removed
 *      contributions lose their rows.
 *   3. **Per-tuple sweep**, for every `(pluginId, extensionId,
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
export async function replaceAllScanContributions(
  trx: Transaction<IDatabase>,
  contributions: readonly IContributionRecord[],
  livePaths: ReadonlySet<string> = new Set(),
  registeredKeys: ReadonlySet<string> = new Set(),
  freshlyRunTuples: ReadonlySet<string> = new Set(),
): Promise<void> {
  await sweepOrphanContributions(trx, livePaths);
  await sweepCatalogContributions(trx, registeredKeys);
  await sweepPerTupleContributions(trx, contributions, freshlyRunTuples);
  await upsertContributionsBuffer(trx, contributions);
}

/**
 * 1) Orphan sweep, drop rows for nodes that disappeared. Legacy
 * callers that pass no `livePaths` get the old wipe-all behaviour so
 * a fresh scan from a primed DB still resets when no nodes survive.
 */
async function sweepOrphanContributions(
  trx: Transaction<IDatabase>,
  livePaths: ReadonlySet<string>,
): Promise<void> {
  if (livePaths.size > 0) {
    await trx
      .deleteFrom('scan_contributions')
      .where('nodePath', 'not in', [...livePaths])
      .execute();
    return;
  }
  await trx.deleteFrom('scan_contributions').execute();
}

/**
 * 2) Catalog sweep, drop rows whose qualified id no longer appears
 * in the runtime catalog. Merging with the explicit `registeredKeys`
 * set (when supplied) covers the "extension declared the contribution
 * but emitted nothing this pass" case (e.g. cached nodes only).
 */
async function sweepCatalogContributions(
  trx: Transaction<IDatabase>,
  registeredKeys: ReadonlySet<string>,
): Promise<void> {
  if (registeredKeys.size === 0) return;
  const allRows = await trx
    .selectFrom('scan_contributions')
    .select(['pluginId', 'extensionId', 'contributionId'])
    .execute();
  for (const r of allRows) {
    const key = `${r.pluginId}/${r.extensionId}/${r.contributionId}`;
    if (registeredKeys.has(key)) continue;
    await trx
      .deleteFrom('scan_contributions')
      .where('pluginId', '=', r.pluginId)
      .where('extensionId', '=', r.extensionId)
      .where('contributionId', '=', r.contributionId)
      .execute();
  }
}

/**
 * 3) Per-tuple sweep, for each `(pluginId, extensionId, nodePath)`
 * where the extension actually ran this scan, drop rows whose
 * `contributionId` is NOT refreshed by the buffer. Catches the
 * "extractor used to emit, now does not" case. Cached tuples are
 * absent from `freshlyRunTuples`, so their rows survive untouched
 * (the cache-preservation invariant this function exists to honour).
 *
 * NUL-separated keys: the previous `/`-separator broke parsing when
 * `nodePath` carried slashes (`.claude/agents/architect.md`):
 * `lastIndexOf('/')` chopped at the wrong slash, the SELECT missed
 * every row, and the sweep silently no-op'd on real workspaces. NUL
 * is prohibited in POSIX paths and ruled out in plugin / extension
 * ids by kebab-case, so collisions are impossible by construction.
 */
async function sweepPerTupleContributions(
  trx: Transaction<IDatabase>,
  contributions: readonly IContributionRecord[],
  freshlyRunTuples: ReadonlySet<string>,
): Promise<void> {
  if (freshlyRunTuples.size === 0) return;
  const bufferKeys = buildContributionsBufferKeys(contributions);
  const tuplesByPluginExt = groupFreshlyRunTuplesByPluginExt(freshlyRunTuples);
  for (const [pe, nodes] of tuplesByPluginExt) {
    const sep = pe.indexOf('\0');
    if (sep < 0) continue;
    await deleteStaleTupleRows(trx, pe.slice(0, sep), pe.slice(sep + 1), [...nodes], bufferKeys);
  }
}

function buildContributionsBufferKeys(
  contributions: readonly IContributionRecord[],
): Set<string> {
  const out = new Set<string>();
  for (const c of contributions) {
    out.add(`${c.pluginId}\0${c.extensionId}\0${c.nodePath}\0${c.contributionId}`);
  }
  return out;
}

/**
 * Group freshly-run tuples by their `(plugin, extension)` pair so we
 * can narrow the SELECT to one query per `(plugin, extension)` and
 * let SQLite use the existing `(plugin_id)` index. Buffer keys are
 * 4-tuples; freshly-run tuples are 3-tuples (no `contributionId`).
 */
function groupFreshlyRunTuplesByPluginExt(
  freshlyRunTuples: ReadonlySet<string>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>(); // `${plugin}\0${ext}` → Set<nodePath>
  for (const tuple of freshlyRunTuples) {
    const parts = tuple.split('\0');
    if (parts.length !== 3) continue;
    const [pluginId, extensionId, node] = parts as [string, string, string];
    const pe = `${pluginId}\0${extensionId}`;
    let nodes = out.get(pe);
    if (!nodes) {
      nodes = new Set<string>();
      out.set(pe, nodes);
    }
    nodes.add(node);
  }
  return out;
}

async function deleteStaleTupleRows(
  trx: Transaction<IDatabase>,
  pluginId: string,
  extensionId: string,
  nodeArr: string[],
  bufferKeys: ReadonlySet<string>,
): Promise<void> {
  const candidates = await trx
    .selectFrom('scan_contributions')
    .select(['nodePath', 'contributionId'])
    .where('pluginId', '=', pluginId)
    .where('extensionId', '=', extensionId)
    .where('nodePath', 'in', nodeArr)
    .execute();
  for (const row of candidates) {
    const key = `${pluginId}\0${extensionId}\0${row.nodePath}\0${row.contributionId}`;
    if (bufferKeys.has(key)) continue;
    await trx
      .deleteFrom('scan_contributions')
      .where('pluginId', '=', pluginId)
      .where('extensionId', '=', extensionId)
      .where('nodePath', '=', row.nodePath)
      .where('contributionId', '=', row.contributionId)
      .execute();
  }
}

/**
 * 4) Upsert the buffer. Composite PK is `(plugin_id, extension_id,
 * node_path, contribution_id)` so we use `onConflict.doUpdateSet`
 * instead of plain `insertInto`. ≤ 500 rows per chunk to stay under
 * SQLite's 999-binding limit (7 columns × 500 = 3500 bindings).
 */
async function upsertContributionsBuffer(
  trx: Transaction<IDatabase>,
  contributions: readonly IContributionRecord[],
): Promise<void> {
  if (contributions.length === 0) return;
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
 * Load every contribution row for a single node, stable order
 * (`pluginId` ASC, `extensionId` ASC, `contributionId` ASC). Used by
 * the BFF's single-node response builder, the UI's slot host then
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
 * Bulk variant, load contributions for an explicit list of node paths
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
 * backwards-compat with the design narrative, the disambiguation
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
 * clear stale rows immediately at toggle time, without the purge, the
 * UI would keep rendering the disabled plugin's chips until the next
 * `sm scan` triggered the catalog sweep above.
 *
 * - `extensionId` omitted → wipes every row whose `pluginId` matches
 *   (bundle-granularity disable, e.g. `sm plugins disable claude`).
 * - `extensionId` supplied → narrows to the `(pluginId, extensionId)`
 *   pair (extension-granularity disable, e.g.
 *   `sm plugins disable core/slash-command`).
 *
 * Does NOT cascade across plugin families, the caller decides the
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
    // Audit M3: deep-strip `__proto__` / `constructor` / `prototype`
    // at every depth before the payload flows out to the BFF / UI /
    // future deep-merge consumers. Slot payload schemas at emit time
    // do not necessarily forbid those names; the strip closes the
    // round-trip gap regardless of slot author hygiene.
    payload = stripPrototypePollution(JSON.parse(row.payloadJson));
  } catch {
    // Defensive, row was written via `replaceAllScanContributions`
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
