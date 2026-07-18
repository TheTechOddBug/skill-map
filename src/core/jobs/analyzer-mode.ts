/**
 * The execution mode of the analyzer(s) a fixer's `precondition.analyzerIds`
 * reference, resolved against a composed analyzer catalog. Modelo B splits on
 * this (`spec/architecture.md` §Analyzer ↔ Action relationship): a fixer whose
 * referenced analyzer is DETERMINISTIC consumes that analyzer's `scan_issues`
 * rows (the `## Issues to resolve` injection at submit, no finding id to stamp
 * at record, the fix's evidence is the next scan clearing the Issue), while a
 * fixer whose referenced analyzer is a PROBABILISTIC finder consumes its
 * `state_findings` rows (the `## Findings to resolve` injection, resolution
 * stamped at record).
 *
 * BOTH the submit path (`submit-engine.ts` render-input branch) and the record
 * path (`record-outcome.ts` resolution-stamp skip) resolve the mode through
 * this one helper so the two halves agree on which lane a fixer is in.
 */

import type { IAnalyzer } from '../../kernel/extensions/index.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';

export type TAnalyzerMode = 'deterministic' | 'probabilistic';

/**
 * Resolve the mode of the analyzer a fixer's `analyzerIds` name, matching each
 * declared id (qualified `core/reference-broken` OR bare `reference-broken`)
 * against the composed catalog. Returns the mode of the FIRST id that resolves
 * to a composed analyzer, `undefined` when none resolves (e.g. the referenced
 * finder is currently disabled, so it is absent from the runtime). Callers
 * treat `undefined` as "not deterministic" and keep the findings lane, so an
 * unresolved analyzer never accidentally routes a probabilistic fixer through
 * the Issue-injection path.
 *
 * `analyzerIds` are assumed homogeneous in mode (a fixer serves one analyzer
 * family); the first-match reduction is the single real case
 * (`core/reference-broken`), and mixing modes under one fixer is not a shape
 * the built-in roster produces.
 */
export function referencedAnalyzerMode(
  analyzers: readonly IAnalyzer[],
  analyzerIds: readonly string[],
): TAnalyzerMode | undefined {
  for (const id of analyzerIds) {
    for (const analyzer of analyzers) {
      const qualified = qualifiedExtensionId(analyzer.pluginId, analyzer.id);
      if (id === qualified || id === analyzer.id) {
        return (analyzer.mode ?? 'deterministic') === 'probabilistic'
          ? 'probabilistic'
          : 'deterministic';
      }
    }
  }
  return undefined;
}
