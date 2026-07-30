/**
 * `state_plugin_kvs` adapter, Mode A plugin key/value persistence.
 *
 * Backs the plugin-facing `KvStore` accessor documented in
 * `spec/plugin-kv-api.md` § Mode A. The plugin never reaches this
 * module: `kernel/adapters/plugin-store.ts` owns the plugin contract
 * (key validation, JSON encoding, the typed error taxonomy, the
 * `nodePath ↔ node_id` sentinel) and talks to a plugin-bound
 * `IKvStorePersist` port; `core/runtime/plugin-stores.ts` binds that
 * port to these functions. Everything here speaks raw storage terms:
 * an already-encoded `valueJson` string and the sentinel `nodeId`
 * (`''` for the global scope, never NULL, because the primary key is
 * `(plugin_id, node_id, key)`).
 *
 * Zone `state_`: rows survive `sm scan` truncation and `sm db reset`
 * (which drops only `scan_*`). See `spec/db-schema.md` §
 * `state_plugin_kvs` and `spec/plugin-kv-api.md` § Backup and
 * retention.
 *
 * `pluginId` is a mandatory argument on every function. There is no
 * cross-plugin read: the composite key is always fully qualified, so
 * a plugin's accessor structurally cannot address another plugin's
 * rows.
 */

import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import type { IDatabase } from './schema.js';

/** One `state_plugin_kvs` row, storage-shaped (value still encoded). */
export interface IPluginKvRow {
  pluginId: string;
  /** Sentinel scope: `''` is global, anything else is a node path. */
  nodeId: string;
  key: string;
  valueJson: string;
  updatedAt: number;
}

/** Fully-qualified addressing for a single row. */
export interface IPluginKvScope {
  pluginId: string;
  nodeId: string;
  key: string;
}

/** Scope + optional key-prefix filter for a `list`. */
export interface IPluginKvListQuery {
  pluginId: string;
  nodeId: string;
  prefix?: string;
}

/**
 * Read one row. Returns `null` when absent, which the wrapper surfaces
 * to the plugin as `get(...) === null` (never an error, per spec).
 */
export async function getPluginKv(
  db: Kysely<IDatabase>,
  scope: IPluginKvScope,
): Promise<IPluginKvRow | null> {
  const row = await db
    .selectFrom('state_plugin_kvs')
    .select(['pluginId', 'nodeId', 'key', 'valueJson', 'updatedAt'])
    .where('pluginId', '=', scope.pluginId)
    .where('nodeId', '=', scope.nodeId)
    .where('key', '=', scope.key)
    .executeTakeFirst();
  return row ?? null;
}

/**
 * Upsert one row. Replaces the value and refreshes `updated_at` on
 * conflict against the `(plugin_id, node_id, key)` primary key.
 */
export async function setPluginKv(
  db: Kysely<IDatabase>,
  row: IPluginKvRow,
): Promise<void> {
  await db
    .insertInto('state_plugin_kvs')
    .values(row)
    .onConflict((oc) =>
      oc
        .columns(['pluginId', 'nodeId', 'key'])
        .doUpdateSet({ valueJson: row.valueJson, updatedAt: row.updatedAt }),
    )
    .execute();
}

/**
 * Delete one row. Returns `true` iff a row was actually removed, which
 * is the plugin-visible return of `store.delete(...)`. Idempotent: a
 * second call simply returns `false`.
 */
export async function deletePluginKv(
  db: Kysely<IDatabase>,
  scope: IPluginKvScope,
): Promise<boolean> {
  const result = await db
    .deleteFrom('state_plugin_kvs')
    .where('pluginId', '=', scope.pluginId)
    .where('nodeId', '=', scope.nodeId)
    .where('key', '=', scope.key)
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0n) > 0;
}

/**
 * List one scope's rows, ordered by key ASC (the spec's SHOULD; the
 * primary key makes the order free). `prefix` narrows to keys starting
 * with the given string.
 *
 * Deliberately NOT `LIKE`. SQLite's `LIKE` is case-insensitive for
 * ASCII unless `PRAGMA case_sensitive_like` is on, which this adapter
 * never sets (and must not: the pragma is connection-global and would
 * silently retune every other `LIKE` in the adapter). Under `LIKE`,
 * `prefix: 'cache.'` also matched `Cache.secret`, which is not what
 * "keys starting with the given string" means. `substr(key, 1, N) = ?`
 * is BINARY-collated, so it is exact, and it drops the LIKE
 * metacharacter escaping along with the wildcard semantics.
 *
 * The length is measured in CODE POINTS because SQLite's `substr`
 * counts characters, not UTF-16 units; `[...prefix].length` is the
 * matching count in JS (`.length` would over-count an astral prefix
 * and silently return nothing).
 */
export async function listPluginKvs(
  db: Kysely<IDatabase>,
  query: IPluginKvListQuery,
): Promise<IPluginKvRow[]> {
  let builder = db
    .selectFrom('state_plugin_kvs')
    .select(['pluginId', 'nodeId', 'key', 'valueJson', 'updatedAt'])
    .where('pluginId', '=', query.pluginId)
    .where('nodeId', '=', query.nodeId);
  if (query.prefix !== undefined && query.prefix !== '') {
    const codePoints = [...query.prefix].length;
    builder = builder.where(sql<boolean>`substr(key, 1, ${codePoints}) = ${query.prefix}`);
  }
  return builder.orderBy('key', 'asc').execute();
}

/**
 * Drop every row owned by a plugin. Not wired to a verb today (`sm
 * plugins disable` deliberately KEEPS plugin storage, per
 * `spec/plugin-kv-api.md` § Backup and retention); it exists so the
 * future `sm plugins forget <id>` has one place to call.
 */
export async function purgePluginKvs(
  db: Kysely<IDatabase>,
  pluginId: string,
): Promise<number> {
  const result = await db
    .deleteFrom('state_plugin_kvs')
    .where('pluginId', '=', pluginId)
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0n);
}
