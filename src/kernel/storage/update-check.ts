/**
 * Kysely-based read/write helpers for the update-check cache.
 *
 * Stored as a single row in `config_preferences` keyed by the
 * canonical `_kernel.update-check`. The `_kernel.` prefix marks the
 * row as kernel-managed (not user-set via `sm config set ...`); user-
 * facing preferences land under unprefixed keys when they ship.
 *
 * The `valueJson` column holds the entire `IUpdateCheckCache` payload
 * as a single JSON blob. SQLite has no JSON column type natively, the
 * adapter writes the JSON-encoded string and decodes on read.
 *
 * Both helpers are short, single-statement, and intentionally do NOT
 * thread a transaction, the table is touched by one writer at a time
 * (the post-run hook in `cli/entry.ts` and the BFF read path which is
 * read-only). Concurrent writes from multiple `sm` invocations are
 * possible in theory; SQLite's WAL serializes them, and the worst-case
 * outcome is one write losing, neither catastrophic nor user-visible.
 */

import type { Kysely } from 'kysely';

import type { IDatabase } from '../adapters/sqlite/schema.js';
import type { IUpdateCheckCache } from '../update-check/index.js';

export const UPDATE_CHECK_KEY = '_kernel.update-check';

interface IPersistedCacheShape {
  latestVersion?: unknown;
  checkedAt?: unknown;
  shownAt?: unknown;
}

/**
 * Read the cache row. Returns `null` when:
 *   - the key is absent (first run / never probed),
 *   - the stored JSON is malformed (corrupt row → ignore, will be
 *     overwritten by the next probe),
 *   - the JSON shape doesn't match `IUpdateCheckCache` (forward-compat
 *     guard for the day this row's schema evolves).
 *
 * Never throws, read failures degrade silently because the banner is
 * a non-essential surface.
 */
export async function loadUpdateCheckCache(
  db: Kysely<IDatabase>,
): Promise<IUpdateCheckCache | null> {
  const row = await db
    .selectFrom('config_preferences')
    .select('valueJson')
    .where('key', '=', UPDATE_CHECK_KEY)
    .executeTakeFirst();
  if (!row) return null;
  let parsed: IPersistedCacheShape;
  try {
    parsed = JSON.parse(row.valueJson) as IPersistedCacheShape;
  } catch {
    return null;
  }
  if (
    typeof parsed.latestVersion !== 'string' ||
    typeof parsed.checkedAt !== 'number' ||
    !(parsed.shownAt === null || typeof parsed.shownAt === 'number')
  ) {
    return null;
  }
  return {
    latestVersion: parsed.latestVersion,
    checkedAt: parsed.checkedAt,
    shownAt: parsed.shownAt,
  };
}

/**
 * Write the cache row. Upserts on `key` so the second-and-after writes
 * just overwrite the JSON blob in place. `updatedAt` always tracks
 * wall-clock now, separate from the `checkedAt` field embedded in the
 * payload, which the caller controls.
 */
export async function saveUpdateCheckCache(
  db: Kysely<IDatabase>,
  cache: IUpdateCheckCache,
): Promise<void> {
  const valueJson = JSON.stringify({
    latestVersion: cache.latestVersion,
    checkedAt: cache.checkedAt,
    shownAt: cache.shownAt,
  });
  const updatedAt = Date.now();
  await db
    .insertInto('config_preferences')
    .values({ key: UPDATE_CHECK_KEY, valueJson, updatedAt })
    .onConflict((oc) =>
      oc.column('key').doUpdateSet({ valueJson, updatedAt }),
    )
    .execute();
}
