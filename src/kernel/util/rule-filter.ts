/**
 * Shared `--rules` / `?ruleId=` filter implementation.
 *
 * Three call sites used to inline the same matching algorithm:
 *
 *   - `sm check`'s `matchesRuleFilter` for the persisted-issue filter.
 *   - `sm check`'s `detectProbRuleIds` (re-applies the filter to the
 *     prob-rule advisory).
 *   - `/api/issues` for the BFF surface.
 *
 * Behaviour: an issue's `ruleId` always arrives qualified
 * (`<plugin>/<id>`) because the orchestrator persists the full extension
 * id (spec § A.6). The filter accepts BOTH qualified and short forms —
 * a user typing `--rules validate-all` matches `core/validate-all`
 * because the suffix after `/` is identical. Empty filter = match
 * everything (callers gate on `filter.length > 0` before invoking).
 */

/**
 * Returns true if `ruleId` is in the filter list, OR if the suffix
 * after the first `/` is in the filter list. Empty `filter` always
 * returns true — callers should short-circuit on length === 0 before
 * invoking when they want "no filter = no match".
 */
export function matchesRuleFilter(ruleId: string, filter: readonly string[]): boolean {
  if (filter.length === 0) return true;
  if (filter.includes(ruleId)) return true;
  const slashIdx = ruleId.indexOf('/');
  if (slashIdx >= 0) {
    const short = ruleId.slice(slashIdx + 1);
    if (filter.includes(short)) return true;
  }
  return false;
}
