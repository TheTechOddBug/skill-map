/**
 * Storage helpers for the `config_plugins` table, the per-machine plugin
 * import-trust store (the SECURITY axis). Read-side feeds
 * `sm plugins list/show/doctor` and the scan-boot import-trust gate;
 * write-side feeds `sm plugins trust/untrust` and
 * `PATCH /api/plugins/:id/trust`.
 *
 * The operational enable/disable toggle does NOT live here, it lives in
 * the config layers (`plugins.<id>.enabled` /
 * `plugins.<id>.extensions.<ext>.enabled`). This table records only
 * per-machine consent to import a project-local plugin's code, keyed by
 * the bare plugin id.
 *
 * The table schema is shipped in the kernel's initial migration (see
 * `src/migrations/001_initial.sql`). This module only adds the helpers.
 */

import type { Kysely, Transaction } from 'kysely';

import type { IDatabase } from './schema.js';
import type { IPluginTrustRow } from '../../types/storage.js';

export type { IPluginTrustRow } from '../../types/storage.js';

type TDbOrTx = Kysely<IDatabase> | Transaction<IDatabase>;

/**
 * Upsert a single `config_plugins` trust row. `now` defaults to
 * `Date.now()` when omitted.
 */
export async function setPluginTrusted(
  db: TDbOrTx,
  pluginId: string,
  trusted: boolean,
  now: number = Date.now(),
): Promise<void> {
  await db
    .insertInto('config_plugins')
    .values({
      pluginId,
      trusted: trusted ? 1 : 0,
      updatedAt: now,
    })
    .onConflict((oc) =>
      oc.column('pluginId').doUpdateSet({
        trusted: trusted ? 1 : 0,
        updatedAt: now,
      }),
    )
    .execute();
}

/**
 * Fetch the trust grant for one plugin id. Returns `undefined` when no
 * row exists (the plugin is untrusted; trust is granted only by a
 * `config_plugins` row via `sm plugins trust`).
 */
export async function getPluginTrusted(
  db: TDbOrTx,
  pluginId: string,
): Promise<boolean | undefined> {
  const row = await db
    .selectFrom('config_plugins')
    .select(['trusted'])
    .where('pluginId', '=', pluginId)
    .executeTakeFirst();
  if (!row) return undefined;
  return row.trusted === 1;
}

/** List every trust row. Useful for `sm plugins list`. */
export async function listPluginTrust(db: TDbOrTx): Promise<IPluginTrustRow[]> {
  const rows = await db
    .selectFrom('config_plugins')
    .select(['pluginId', 'trusted', 'updatedAt'])
    .orderBy('pluginId', 'asc')
    .execute();
  return rows.map((r) => ({
    pluginId: r.pluginId,
    trusted: r.trusted === 1,
    updatedAt: r.updatedAt,
  }));
}

/**
 * Drop the trust grant for one plugin so the next resolution falls back
 * to "untrusted unless the local opt-in is set". Idempotent, removing a
 * non-existent row is a no-op.
 */
export async function deletePluginTrust(
  db: TDbOrTx,
  pluginId: string,
): Promise<void> {
  await db
    .deleteFrom('config_plugins')
    .where('pluginId', '=', pluginId)
    .execute();
}

/**
 * Fetch every trust grant at once and return a `Map<pluginId, trusted>`
 * keyed by bare plugin id. `PluginLoader` consumers use this once per
 * process to avoid one round-trip per plugin during discovery.
 */
export async function loadPluginTrustMap(
  db: TDbOrTx,
): Promise<Map<string, boolean>> {
  const rows = await listPluginTrust(db);
  const out = new Map<string, boolean>();
  for (const row of rows) out.set(row.pluginId, row.trusted);
  return out;
}
