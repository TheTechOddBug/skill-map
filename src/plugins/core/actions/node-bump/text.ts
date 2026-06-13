/**
 * User-facing strings for the `node-bump` built-in action's inspector
 * button (`plugins/core/actions/node-bump/index.ts`).
 *
 * The action's scan-time `project()` emits the `inspector.action.button`
 * that dispatches a bump for nodes whose sidecar is stale (the button
 * formerly emitted by the `core/annotation-stale` analyzer, now folded
 * into the action that dispatches it; the analyzer keeps its stale badge
 * + drift issue). These strings are the button label and the
 * disabled-reason tooltip.
 *
 * Convention: flat string templates. The `tx` helper at
 * `kernel/util/tx.ts` does the interpolation (none needed here today).
 */

export const BUMP_TEXTS = {
  /** Label of the inspector action button that dispatches a bump. */
  bumpLabel: 'Bump',
  /** Tooltip shown when the bump button is disabled (the node is fresh, no drift). */
  bumpDisabledReason: 'No drift to bump.',
} as const;
