/**
 * Canonical CLI exit codes, single source of truth.
 *
 * Every `Command#execute()` in `src/cli/commands/` MUST return one of
 * these values. Numeric values are the public contract documented in
 * `spec/cli-contract.md` §Exit codes; the semantic names are
 * kernel-internal.
 *
 *   Ok            = 0  success.
 *   Issues        = 1  command succeeded but the produced result has at
 *                      least one error-severity issue (`sm scan`,
 *                      `sm check`, `sm show <node>` when its issue list
 *                      contains an `error`).
 *   Error         = 2  unhandled error / config load failure / bad usage
 *                      / IO failure / DB invariant violation.
 *   Duplicate     = 3  emitted by `sm jobs submit` when an active duplicate
 *                      job already covers the same action + node + hash.
 *   NonceMismatch = 4  emitted by `sm record` when the supplied nonce does
 *                      not match the target job's.
 *   NotFound      = 5  target not on disk / not in DB. DB file missing
 *                      (most common, see `assertDbExists`), prior
 *                      scan-result row missing, requested node path
 *                      missing, dump file passed to `--compare-with`
 *                      missing.
 *
 * The TS object literal pattern (frozen `as const` + derived union type)
 * is preferred over `enum` because it has zero runtime overhead and
 * narrows correctly when used as a return type.
 */
export const ExitCode = {
  Ok: 0,
  Issues: 1,
  Error: 2,
  Duplicate: 3,
  NonceMismatch: 4,
  NotFound: 5,
} as const;

export type TExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * The exit-code set every verb carries unless it declares its own.
 *
 * `Ok` because a verb that can never succeed would not exist, and
 * `Error` because `SmCommand.execute()` funnels every exception
 * escaping `run()` into `ExitCode.Error` (see its `renderUnhandledError`
 * boundary), so exit `2` is reachable from ANY verb regardless of what
 * its own body returns.
 *
 * Verbs that can also produce `Issues` / `Duplicate` / `NonceMismatch` /
 * `NotFound` declare the full set via `static override exitCodes`; the
 * declaration is what `sm help --format json` publishes per verb
 * (`spec/cli-contract.md` §Introspection, NORMATIVE), so it must match
 * what the verb's `run()` can actually return.
 */
export const DEFAULT_EXIT_CODES: readonly TExitCode[] = [ExitCode.Ok, ExitCode.Error];
