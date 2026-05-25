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
 * Behaviour: an issue's `analyzerId` always arrives qualified
 * (`<plugin>/<id>`) because the orchestrator persists the full extension
 * id (spec § A.6). The filter accepts BOTH qualified and short forms,
 * a user typing `--analyzers validate-all` matches `core/schema-violation`
 * because the suffix after `/` is identical. Empty filter = match
 * everything (callers gate on `filter.length > 0` before invoking).
 */

/**
 * Returns true if `analyzerId` is in the filter list, OR if the suffix
 * after the first `/` is in the filter list. Empty `filter` always
 * returns true, callers should short-circuit on length === 0 before
 * invoking when they want "no filter = no match".
 */
export function matchesAnalyzerFilter(analyzerId: string, filter: readonly string[]): boolean {
  if (filter.length === 0) return true;
  if (filter.includes(analyzerId)) return true;
  const slashIdx = analyzerId.indexOf('/');
  if (slashIdx >= 0) {
    const short = analyzerId.slice(slashIdx + 1);
    if (filter.includes(short)) return true;
  }
  return false;
}
