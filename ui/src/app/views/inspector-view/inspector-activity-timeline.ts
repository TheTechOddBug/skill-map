/**
 * Merged Activity timeline (user decision 2026-07-17): the inspector's
 * "Recent executions" area interleaves TWO provenances into one
 * newest-first list:
 *
 *   - `runtime`: the ephemeral runtime execution ring (`recent`,
 *     spec/provider-activity.md §Execution stats), timestamped by `at`.
 *   - `ai`: skill-map's own persistent AI-run history (`runs`, read
 *     from `state_executions`), timestamped by `finishedAt`, which is
 *     `null` while a run has not finished.
 *
 * Pure derivation, no Angular dependency: the component wraps it in a
 * `computed`. Entries without a timestamp sink to the end; ties keep
 * the input order (`Array.prototype.sort` is stable).
 */

import type { IActivityRecentExecutionApi, IActivityRunApi } from '../../../models/api';

export type TActivityTimelineEntry =
  | { provenance: 'runtime'; at: number; key: string; run: IActivityRecentExecutionApi }
  | { provenance: 'ai'; at: number | null; key: string; run: IActivityRunApi };

export function mergeActivityTimeline(
  recent: readonly IActivityRecentExecutionApi[],
  runs: readonly IActivityRunApi[],
): TActivityTimelineEntry[] {
  const entries: TActivityTimelineEntry[] = [
    // Runtime entries have no id, so the key stays content-shaped (same
    // rationale as the previous content-keyed `track`: keep row DOM
    // across silent refreshes); AI runs key on their stable executionId.
    ...recent.map((run, i) => ({
      provenance: 'runtime' as const,
      at: run.at,
      key: `rt|${run.at}|${run.owner}|${i}`,
      run,
    })),
    ...runs.map((run) => ({
      provenance: 'ai' as const,
      at: run.finishedAt,
      key: `ai|${run.executionId}`,
      run,
    })),
  ];
  entries.sort((a, b) => {
    if (a.at === null) return b.at === null ? 0 : 1;
    if (b.at === null) return -1;
    return b.at - a.at;
  });
  return entries;
}
