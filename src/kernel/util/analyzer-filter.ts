/**
 * Shared `--analyzers` / `?analyzerId=` filter implementation.
 *
 * Three call sites used to inline the same matching algorithm:
 *
 *   - `sm check`'s `matchesAnalyzerFilter` for the persisted-issue filter.
 *   - `sm check`'s `detectProbAnalyzerIds` (re-applies the filter to the
 *     prob-analyzer advisory).
 *   - `/api/issues` for the BFF surface.
 *
 * Behaviour: an issue's persisted `analyzerId` is SHORT / kebab-case with
 * no `/` (spec `issue.schema.json` pins the pattern
 * `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, and analyzers persist their short id).
 * The filter accepts BOTH the short form (`node-stability`) and the
 * qualified `<plugin>/<id>` form (`core/node-stability`), matching either
 * against the short stored id: a user typing `--analyzers core/schema-violation`
 * matches the stored `schema-violation` because the suffix after `/` is
 * identical, and the bare `schema-violation` matches directly. Empty
 * filter = match everything (callers gate on `filter.length > 0` before
 * invoking).
 */

/**
 * Returns true on any of:
 *   - `analyzerId` appears verbatim in `filter`;
 *   - a filter entry's suffix after the first `/` equals `analyzerId`
 *     (qualified entry `core/node-stability` matches short stored id
 *     `node-stability`, the persisted-issue path);
 *   - `analyzerId`'s own suffix after the first `/` appears in `filter`
 *     (qualified arg `core/node-stability` matches short filter
 *     `node-stability`, the prob-advisory path where the caller passes a
 *     qualified id).
 *
 * Empty `filter` always returns true, callers should short-circuit on
 * length === 0 before invoking when they want "no filter = no match".
 */
export function matchesAnalyzerFilter(analyzerId: string, filter: readonly string[]): boolean {
  if (filter.length === 0) return true;
  if (filter.includes(analyzerId)) return true;
  // The stored `analyzerId` is short (no slash per `issue.schema.json`),
  // so qualified filter entries must be reduced to their suffix before
  // comparison. This is the path that lets a `core/<id>` filter match the
  // short stored `<id>`.
  for (const entry of filter) {
    const slashIdx = entry.indexOf('/');
    if (slashIdx >= 0 && entry.slice(slashIdx + 1) === analyzerId) return true;
  }
  // Symmetric case: some callers (the `--include-prob` advisory) pass a
  // qualified `analyzerId` and let a short filter token match its suffix.
  const argSlashIdx = analyzerId.indexOf('/');
  if (argSlashIdx >= 0 && filter.includes(analyzerId.slice(argSlashIdx + 1))) return true;
  return false;
}
