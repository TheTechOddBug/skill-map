/**
 * User-facing strings for the `node-set-stability` built-in action's
 * inspector button (`plugins/core/actions/node-set-stability/index.ts`).
 *
 * The action's scan-time `project()` emits the `inspector.action.button`
 * that sets the lifecycle stage of the current node (the button lives with
 * the action that dispatches it, mirroring `node-set-tags` / `node-supersede`).
 * These strings are the button label, the prompt label, and the enum-pick
 * option labels.
 *
 * Convention: flat string templates. The `tx` helper at
 * `kernel/util/tx.ts` does the interpolation (none needed here today).
 */

export const NODE_SET_STABILITY_TEXTS = {
  /** Label of the inspector action button that sets the lifecycle stage. */
  setLabel: 'Set stability',
  /** Prompt label for the enum-pick stability input. */
  promptLabel: 'Stability',
  /** Prompt option label for the `experimental` stage. */
  optionExperimental: 'Experimental',
  /** Prompt option label for the `stable` stage. */
  optionStable: 'Stable',
  /** Prompt option label for the `deprecated` stage. */
  optionDeprecated: 'Deprecated',
} as const;
