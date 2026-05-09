/**
 * `scan_node_tags` adapter — tags · dual-source persistence layer.
 *
 * One row per `(node_path, tag, source)` triple. Projected at persist
 * time from BOTH `frontmatter.tags` (with `source='author'`) and
 * `sidecar.annotations.tags` (with `source='user'`). The same tag
 * string MAY appear under both sources for the same node — the PK
 * accepts the pair; search returns the node once via DISTINCT, the
 * UI renders both chips with their attribution.
 *
 * Belongs to the `scan_*` family — replaced wholesale per scan.
 * Cached nodes' tag rows are projected from the cached
 * `node.frontmatter.tags` / `node.sidecar.annotations.tags` (both
 * already in memory at persist time), so the rebuild is cheap
 * regardless of cache hit / miss. See `spec/db-schema.md`
 * § scan_node_tags for the normative shape and replace-all semantics.
 */

import type { Insertable, Kysely, Transaction } from 'kysely';

import type { IDatabase, IScanNodeTagsTable } from './schema.js';

/**
 * In-memory tag record buffered during scan and flushed to
 * `scan_node_tags` by `persistScanResult`. One entry per
 * `(node_path, tag, source)` projected from a node's frontmatter tags
 * (`source: 'author'`) or sidecar annotations tags
 * (`source: 'user'`).
 */
export interface ITagRecord {
  nodePath: string;
  tag: string;
  source: 'author' | 'user';
}

/**
 * Persist the per-scan tag buffer.
 *
 * Replace-all per node: orphan-sweep rows whose `node_path` is NOT in
 * the live set, then wipe + reinsert rows for live nodes from the
 * buffer. Pure replace-all is safe here (unlike `scan_contributions`)
 * because tag projection is cheap and unconditional — every persisted
 * scan rebuilds the table for the live node set whether nodes hit the
 * scan cache or not.
 */
export async function replaceAllScanTags(
  trx: Transaction<IDatabase>,
  records: readonly ITagRecord[],
  livePaths: ReadonlySet<string> = new Set(),
): Promise<void> {
  // 1) Orphan sweep — drop rows for nodes that disappeared. When no
  //    live set is supplied (legacy / test callers), fall through to
  //    full wipe so the table resets cleanly.
  if (livePaths.size > 0) {
    const livePathsArr = [...livePaths];
    await trx
      .deleteFrom('scan_node_tags')
      .where('nodePath', 'not in', livePathsArr)
      .execute();
    // 2) Wipe rows for live nodes — replace-all per-node.
    await trx
      .deleteFrom('scan_node_tags')
      .where('nodePath', 'in', livePathsArr)
      .execute();
  } else {
    await trx.deleteFrom('scan_node_tags').execute();
  }
  // 3) Insert the buffer.
  if (records.length === 0) return;
  const rows: Insertable<IScanNodeTagsTable>[] = records.map((r) => ({
    nodePath: r.nodePath,
    tag: r.tag,
    source: r.source,
  }));
  // SQLite INSERT cap of 999 bound parameters is the practical batch
  // ceiling. 3 columns × 333 rows = 999 — chunk at 300 for safety.
  const BATCH = 300;
  for (let i = 0; i < rows.length; i += BATCH) {
    await trx.insertInto('scan_node_tags').values(rows.slice(i, i + BATCH)).execute();
  }
}

/**
 * Read tag rows for a single node. Used by the BFF to project
 * `node.tags = { byAuthor, byUser }` on `/api/nodes/:pathB64`.
 * Returns rows in author-first order so consumers can split with a
 * single linear pass.
 */
export async function loadTagsForNode(
  db: Kysely<IDatabase>,
  nodePath: string,
): Promise<ITagRecord[]> {
  const rows = await db
    .selectFrom('scan_node_tags')
    .select(['nodePath', 'tag', 'source'])
    .where('nodePath', '=', nodePath)
    .orderBy('source', 'asc') // 'author' < 'user' lexicographically
    .orderBy('tag', 'asc')
    .execute();
  return rows.map((r) => ({ nodePath: r.nodePath, tag: r.tag, source: r.source }));
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
    .select(['nodePath', 'tag', 'source'])
    .where('nodePath', 'in', [...nodePaths])
    .orderBy('source', 'asc')
    .orderBy('tag', 'asc')
    .execute();
  return rows.map((r) => ({ nodePath: r.nodePath, tag: r.tag, source: r.source }));
}

/**
 * Find every node carrying a given tag. Optional `source` filter
 * narrows to one side of the dual surface; absent / undefined matches
 * the union (default behaviour for `sm list --tag <name>`).
 */
export async function findNodesByTag(
  db: Kysely<IDatabase>,
  tag: string,
  source?: 'author' | 'user',
): Promise<string[]> {
  let q = db.selectFrom('scan_node_tags').select('nodePath').where('tag', '=', tag);
  if (source !== undefined) q = q.where('source', '=', source);
  const rows = await q.distinct().orderBy('nodePath', 'asc').execute();
  return rows.map((r) => r.nodePath);
}
