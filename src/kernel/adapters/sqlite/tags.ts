/**
 * `scan_node_tags` adapter, tags · single-source persistence layer.
 *
 * One row per `(node_path, tag)` pair. Projected at persist time from
 * the node's `sidecar.annotations.tags` (the only tag source).
 *
 * Belongs to the `scan_*` family, replaced wholesale per scan.
 * Cached nodes' tag rows are projected from the cached
 * `node.sidecar.annotations.tags` (already in memory at persist time),
 * so the rebuild is cheap regardless of cache hit / miss. See
 * `spec/db-schema.md` § scan_node_tags for the normative shape and
 * replace-all semantics.
 */

import type { Insertable, Kysely, Transaction } from 'kysely';

import type { IDatabase, IScanNodeTagsTable } from './schema.js';

/**
 * In-memory tag record buffered during scan and flushed to
 * `scan_node_tags` by `persistScanResult`. One entry per
 * `(node_path, tag)` pair projected from a node's sidecar annotations
 * tags (`sidecar.annotations.tags`).
 */
export interface ITagRecord {
  nodePath: string;
  tag: string;
}

/**
 * Persist the per-scan tag buffer.
 *
 * Plain replace-all: one unconditional wipe, then reinsert the buffer.
 * The historical two-DELETE split ("not in live set" + "in live set")
 * was set-theoretically the same full wipe while binding up to
 * `scan.maxScan` placeholders twice per scan; `livePaths` stays in the
 * signature because callers thread it and a future partial rebuild
 * would need it back. Pure replace-all is safe here (unlike
 * `scan_contributions`) because tag projection is cheap and
 * unconditional, every persisted scan rebuilds the table for the live
 * node set whether nodes hit the scan cache or not.
 */
export async function replaceAllScanTags(
  trx: Transaction<IDatabase>,
  records: readonly ITagRecord[],
  _livePaths: ReadonlySet<string> = new Set(),
): Promise<void> {
  await trx.deleteFrom('scan_node_tags').execute();
  // Insert the buffer.
  if (records.length === 0) return;
  const rows: Insertable<IScanNodeTagsTable>[] = records.map((r) => ({
    nodePath: r.nodePath,
    tag: r.tag,
  }));
  // SQLite INSERT cap of 999 bound parameters is the practical batch
  // ceiling. 2 columns × 499 rows = 998, chunk at 300 for safety.
  const BATCH = 300;
  for (let i = 0; i < rows.length; i += BATCH) {
    await trx.insertInto('scan_node_tags').values(rows.slice(i, i + BATCH)).execute();
  }
}

/**
 * Read tag rows for a single node. Used by the BFF to project
 * `node.tags` (a flat `string[]`) on `/api/nodes/:pathB64`. Returns
 * rows ordered by tag name.
 */
export async function loadTagsForNode(
  db: Kysely<IDatabase>,
  nodePath: string,
): Promise<ITagRecord[]> {
  const rows = await db
    .selectFrom('scan_node_tags')
    .select(['nodePath', 'tag'])
    .where('nodePath', '=', nodePath)
    .orderBy('tag', 'asc')
    .execute();
  return rows.map((r) => ({ nodePath: r.nodePath, tag: r.tag }));
}

/**
 * Read tag rows for a set of node paths. Used by the BFF on bulk
 * `/api/nodes` responses; the caller groups the result by `nodePath`
 * client-side.
 */
export async function loadTagsForPaths(
  db: Kysely<IDatabase>,
  nodePaths: readonly string[],
): Promise<ITagRecord[]> {
  if (nodePaths.length === 0) return [];
  const rows = await db
    .selectFrom('scan_node_tags')
    .select(['nodePath', 'tag'])
    .where('nodePath', 'in', [...nodePaths])
    .orderBy('tag', 'asc')
    .execute();
  return rows.map((r) => ({ nodePath: r.nodePath, tag: r.tag }));
}

/**
 * Find every node carrying a given tag. Drives `sm list --tag <name>`.
 */
export async function findNodesByTag(
  db: Kysely<IDatabase>,
  tag: string,
): Promise<string[]> {
  const rows = await db
    .selectFrom('scan_node_tags')
    .select('nodePath')
    .where('tag', '=', tag)
    .distinct()
    .orderBy('nodePath', 'asc')
    .execute();
  return rows.map((r) => r.nodePath);
}
