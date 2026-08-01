/**
 * Shared read-side DB version / schema-drift advisory for the BFF's GET
 * surfaces (`spec/db-schema.md` §Schema drift, "Read-side opens advise").
 *
 * Every read route that opens the project DB threads
 * `versionCheck: bffReadVersionCheck()` into `tryWithSqlite` /
 * `withSqlite`. The seam then:
 *
 *   - WARNS once per DB path (server log; the BFF has no TTY) and
 *     proceeds when the DB was written by an older same-major CLI or
 *     when the schema fingerprint drifted, so a GET never returns a
 *     `db-drift` refusal (that envelope is reserved for MUTATING routes,
 *     which keep the default write-side refuse by not passing a
 *     `versionCheck`).
 *   - throws `DbVersionMismatchError` on a newer / different-major DB
 *     (the global `app.onError` surfaces it), matching the CLI read
 *     verbs' refuse-on-newer posture.
 *
 * Extracted from `routes/scan.ts` (which pioneered the pattern for
 * `GET /api/scan`) so every read route shares one printer + bag shape.
 */

import type { IPrinter } from '../../core/runtime/printer.js';
import type { TWithSqliteVersionCheck } from '../../core/sqlite/with-sqlite.js';
import { log } from '../../kernel/util/logger.js';
import { VERSION } from '../../version.js';

/**
 * Printer for the read-side drift advisory. Only the one-shot
 * `warn-older` / `warn-schema` advisories route through here (the
 * version-skew runner calls `printer.warn`); the error classifications
 * throw instead of printing, so `data` / `info` / `error` never fire on
 * this path and discard defensively. The advisory lands in the server
 * log, the BFF has no TTY.
 */
const bffVersionCheckPrinter: IPrinter = {
  data: () => { /* unused on the version-check path */ },
  info: (text) => log.warn(text.trimEnd()),
  warn: (text) => log.warn(text.trimEnd()),
  error: (text) => log.warn(text.trimEnd()),
};

/** The `versionCheck` opts bag every BFF read open threads into the seam. */
export function bffReadVersionCheck(): TWithSqliteVersionCheck {
  return { currentVersion: VERSION, printer: bffVersionCheckPrinter };
}
