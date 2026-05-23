/**
 * `withSqlite`, open a `SqliteStorageAdapter`, hand it to the callback,
 * and guarantee `close()` even if the callback throws or returns early.
 *
 * Standardises the open/use/close idiom every read-side CLI command was
 * open-coding. Eliminates four classes of bugs the inline boilerplate
 * tended to produce:
 *
 *   1. Forgotten `await adapter.close()` in an early-return branch
 *      (resource leak; on Linux WSL the WAL file lingers).
 *   2. Drift between `autoBackup: false` (read-side verbs) and the
 *      default `autoBackup: true`, easy to flip the wrong way when
 *      copying boilerplate across commands.
 *   3. Double-close on the error path (`jobs.ts` had two `await
 *      adapter.close()` calls, one in the catch + one in the finally).
 *      Idempotent today, but a wart.
 *   4. Forgetting to wrap the body in try/finally at all (the rare
 *      error path leaves the DB open until process exit).
 *
 * The callback receives the adapter, not `adapter.db`, because a
 * minority of call sites pass the adapter itself to repository
 * helpers. The common case (`adapter.db.selectFrom(...)`) reads the
 * same.
 *
 * Migration policy reminder:
 *   - Read-side verbs (`check`, `list`, `show`, `export`, `graph`,
 *     `history`, `orphans` list, `plugins list/doctor`, scan prior
 *     load) SHOULD pass `{ autoBackup: false }` so a transient schema
 *     upgrade doesn't write an unsolicited backup.
 *   - Write-side verbs (scan persist, init seed, watch writer,
 *     orphans reconcile / undo-rename) leave defaults on so first-run
 *     schema upgrades are guarded by an automatic backup.
 *
 * Version-skew detection:
 * Pass a `versionCheck` opts bag (resolved at the CLI / BFF seam) to
 * have the helper read `scan_meta.scanned_by_version` after the adapter
 * opens and compare against `currentVersion`. The seam refuses to hand
 * the adapter to the callback when the DB was written by a newer minor
 * or a different major (throws `DbVersionMismatchError`), and prints a
 * one-shot warning when the DB was written by an OLDER minor (open
 * proceeds, the next `sm scan` rewrites the metadata). Verbs that do
 * not opt in keep the historical no-check behaviour; the kernel
 * adapter is untouched so existing tests and the BFF transactional
 * paths stay unchanged.
 *
 * Lives under `core/` so the BFF consumes it without crossing into
 * `src/cli/`. Historic `cli/util/with-sqlite.ts` keeps working through
 * a re-export shim.
 */

import { existsSync } from 'node:fs';

import { createSqliteStorage } from '../../kernel/adapters/sqlite/index.js';
import type { ISqliteStorageAdapterOptions } from '../../kernel/adapters/sqlite/index.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import type { Kysely } from 'kysely';
import type { IDatabase } from '../../kernel/adapters/sqlite/schema.js';

import {
  runDbVersionCheck,
  type IRunDbVersionCheckOpts,
} from './db-version-runner.js';

/**
 * Subset of `IRunDbVersionCheckOpts` the seam accepts. `dbPath` is
 * filled in automatically from `options.databasePath`, every other
 * field is forwarded verbatim. Pass `versionCheck: undefined` (or
 * omit the option) to skip the check.
 */
export type TWithSqliteVersionCheck = Omit<IRunDbVersionCheckOpts, 'dbPath'>;

export interface IWithSqliteOptions extends ISqliteStorageAdapterOptions {
  /**
   * When provided, the seam reads `scan_meta.scanned_by_version`
   * after init and compares against `versionCheck.currentVersion`.
   * Errors throw `DbVersionMismatchError`; warnings print once per
   * DB path via `versionCheck.printer`. Omit to keep the historical
   * no-check behaviour (covers every transactional / persist path
   * + every test that pre-dates the check).
   */
  versionCheck?: TWithSqliteVersionCheck;
}

export async function withSqlite<T>(
  options: IWithSqliteOptions,
  fn: (adapter: StoragePort) => Promise<T>,
): Promise<T> {
  const adapter = createSqliteStorage(options);
  await adapter.init();
  try {
    if (options.versionCheck) {
      // The adapter's `db` getter is the test-only escape hatch
      // documented on `SqliteStorageAdapter`; the seam itself sits
      // inside `core/sqlite/` (the boundary between CLI / BFF and
      // the kernel adapter), so reaching for the typed Kysely
      // handle is acceptable. The alternative (a `port.scans.*`
      // method that runs the check) bloats the kernel port with a
      // driving-side concern.
      const db = (adapter as unknown as { db: Kysely<IDatabase> }).db;
      await runDbVersionCheck(db, {
        ...options.versionCheck,
        dbPath: options.databasePath,
      });
    }
    return await fn(adapter);
  } finally {
    await adapter.close();
  }
}

/**
 * Open the DB only when it already exists on disk; return `null`
 * otherwise. Wraps the very common `if (existsSync(dbPath)) { withSqlite
 * ... }` chain that every read-side command was open-coding.
 *
 * The bare-`existsSync` + `withSqlite` pair was both noisy and a subtle
 * footgun: `withSqlite` opens the adapter unconditionally, and the
 * adapter's `init()` runs `mkdirSync(dirname(absolute), { recursive:
 * true })` before opening the file. That is benign for write-side verbs
 * (they intend to create the scope) but wrong for "read-only-if-present"
 * lookups, which would silently provision `.skill-map/` directories on
 * misuse. `tryWithSqlite` keeps the no-op semantics by short-circuiting
 * before the adapter is constructed.
 *
 * `:memory:` is treated as "exists", useful for tests that want the
 * read path to run against a fresh in-memory DB instead of skipping.
 */
export async function tryWithSqlite<T>(
  options: IWithSqliteOptions,
  fn: (adapter: StoragePort) => Promise<T>,
): Promise<T | null> {
  if (options.databasePath !== ':memory:' && !existsSync(options.databasePath)) {
    return null;
  }
  return withSqlite(options, fn);
}
