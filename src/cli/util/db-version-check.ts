/**
 * Build the read-side `versionCheck` opts bag a CLI read verb (`sm
 * list` / `sm show` / `sm check` / ...) threads into `withSqlite`. The
 * seam then reads `scan_meta.scanned_by_version` + `scan_meta.schema_fingerprint`
 * after the adapter opens and surfaces the advisory:
 *
 *   - older same-major DB → one-shot WARN, open continues.
 *   - same version but a drifted / absent schema fingerprint (an inline
 *     migration change with no version bump, pre-1.0 greenfield) →
 *     one-shot WARN, open continues, message points at `sm scan` /
 *     `sm db reset`.
 *   - newer minor / different major → throws `DbVersionMismatchError`,
 *     the verb refuses to open.
 *
 * Read verbs WARN (never refuse) on drift, so a column missing on an
 * older same-version DB surfaces as a clear advisory instead of a
 * cryptic "no such column" query error. The colour resolver +
 * VERSION are owned by the CLI seam (the kernel / core stay env-free),
 * so this helper lives under `cli/util/`.
 */

import type { IAnsi } from './ansi.js';
import { VERSION } from './../version.js';
import type { IPrinter } from '../../core/runtime/printer.js';
import type { TWithSqliteVersionCheck } from '../../core/sqlite/with-sqlite.js';

/**
 * Assemble the opts bag from a command's printer + stderr colour
 * resolver. `dbPath` is filled in by `withSqlite` from
 * `options.databasePath`, so it is intentionally absent here.
 */
export function buildReadVersionCheck(
  printer: IPrinter,
  stderrAnsi: IAnsi,
): TWithSqliteVersionCheck {
  return {
    currentVersion: VERSION,
    printer,
    style: {
      warnGlyph: stderrAnsi.yellow('⚠'),
      errorGlyph: stderrAnsi.red('✕'),
      dim: stderrAnsi.dim,
    },
  };
}
