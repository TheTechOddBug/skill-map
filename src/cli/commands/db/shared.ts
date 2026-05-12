/**
 * Shared helpers across the `sm db …` verb family.
 *
 * Originally inline in `cli/commands/db.ts`; extracted as part of the
 * follow-up that split the verb into per-command files under
 * `cli/commands/db/`. Anything two or more subcommand files need lives
 * here:
 *
 *   - `SAFE_SQL_IDENTIFIER_RE`, alphanumeric + underscore guard for any
 *     table / index name we ever interpolate literally into a SQL
 *     statement. Used by `reset` (via `assertSafeIdentifier`) and `dump`
 *     (direct check on `--tables <names…>` user input).
 *   - `assertSafeIdentifier`, throw-based wrapper around the regex.
 *     Used as a defence-in-depth second layer after a catalog `LIKE`
 *     filter has already restricted results to a known prefix.
 */

export const SAFE_SQL_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Reject any sqlite_master row name that is not a plain identifier before
 * it reaches a `db.exec` statement. The catalog filter `LIKE 'scan_%'`
 * (and optional `state_%`) used by `db reset` is the primary line of
 * defence; this function is the second layer.
 */
export function assertSafeIdentifier(name: string): void {
  if (!SAFE_SQL_IDENTIFIER_RE.test(name)) {
    throw new Error(`refusing to operate on non-identifier table name: ${JSON.stringify(name)}`);
  }
}
