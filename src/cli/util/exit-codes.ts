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
 *   Duplicate     = 3  emitted by `sm job submit` when an active duplicate
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
