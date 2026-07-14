/**
 * Shared `--analyzers` / `?analyzerId=` filter implementation.
 *
 * Call sites used to inline the same matching algorithm:
 *
 *   - `sm check`'s `matchesAnalyzerFilter` for the persisted-issue filter.
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
 *     `node-stability`, the persisted-issue path).
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
  return false;
}

/**
 * Mirror of `matchesAnalyzerFilter` for stores that persist the QUALIFIED
 * extension id (`<plugin>/<ext>`, e.g. `state_findings.extension_id`)
 * instead of the short analyzer id. Same accepted filter grammar
 * (qualified or bare entries, per `sm check --analyzers`), applied from
 * the other direction:
 *
 *   - a filter entry equals the stored qualified id verbatim
 *     (`plug/finder` matches stored `plug/finder`);
 *   - a bare filter entry equals the stored id's suffix after the first
 *     `/` (`finder` matches stored `plug/finder`).
 *
 * Empty `filter` always returns true (no filter = match everything).
 */
export function matchesQualifiedExtensionFilter(
  extensionId: string,
  filter: readonly string[],
): boolean {
  if (filter.length === 0) return true;
  if (filter.includes(extensionId)) return true;
  const slashIdx = extensionId.indexOf('/');
  if (slashIdx >= 0 && filter.includes(extensionId.slice(slashIdx + 1))) return true;
  return false;
}
