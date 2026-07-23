/**
 * The shared inverse-Modelo-B resolver: given a just-run finder's qualified
 * id and the loaded Action catalog, return the qualified ids of every fixer
 * Action whose `precondition.analyzerIds` name that finder
 * (`spec/architecture.md` §Analyzer ↔ Action relationship (Modelo B)).
 *
 * SINGLE source for the finder -> fixer join, consumed by all three auto-fix
 * entry points so the logic never diverges:
 *
 *   - the opt-in global `core/auto-fix` hook
 *     (`src/plugins/core/hooks/auto-fix/index.ts`), which chains every finder
 *     completion when enabled;
 *   - the per-job `auto_fix` record-path branch
 *     (`src/cli/commands/record.ts`), which chains a finder flagged at submit
 *     even when the hook is disabled (`spec/job-lifecycle.md` §Auto-fix chain);
 *   - the BFF launcher classifier
 *     (`src/server/routes/node-prob-extensions.ts`), which reports each
 *     finder's fixer(s) to the inspector's two-state button.
 *
 * Pure: no config read, no DB, no printing. Only reuses the kebab / qualified
 * matching grammar from `matchesQualifiedExtensionFilter`.
 */

import { matchesQualifiedExtensionFilter } from '../../kernel/util/analyzer-filter.js';

/**
 * The minimal Action projection the resolver reads: the qualified id plus the
 * declared `precondition.analyzerIds` (empty for a non-fixer Action). Both the
 * hook's `IHookActionInfo` and the record path's `projectHookActions` output
 * are structurally assignable.
 */
export interface IFixerCandidateAction {
  /** Qualified extension id (`<plugin>/<id>`). */
  id: string;
  /** The Action's declared `precondition.analyzerIds`; empty for a non-fixer. */
  analyzerIds: readonly string[];
}

/**
 * Qualified ids of the fixer Actions whose `precondition.analyzerIds` name
 * `finderQualifiedId` (the inverse of Modelo B). Only Actions declaring a
 * NON-EMPTY `analyzerIds` are candidates: an empty list matches everything
 * under `matchesQualifiedExtensionFilter`, so a plain (non-fixer) Action must
 * be excluded explicitly. Order follows the input catalog; ALL matches are
 * returned (a finder may feed several fixers).
 */
export function resolveMatchingFixerIds(
  finderQualifiedId: string,
  actions: readonly IFixerCandidateAction[],
): string[] {
  return actions
    .filter(
      (a) =>
        a.analyzerIds.length > 0 &&
        matchesQualifiedExtensionFilter(finderQualifiedId, a.analyzerIds),
    )
    .map((a) => a.id);
}
