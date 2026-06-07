/**
 * User-facing strings emitted by the `node-stability` built-in analyzer
 * (`plugins/core/analyzers/node-stability/index.ts`) for the inspector
 * action button that dispatches `core/node-set-stability`.
 *
 * The chip tooltips and issue messages stay inline in `index.ts` (their
 * own historical home); this catalog covers the button label and prompt
 * strings added with the action-button affordance.
 *
 * Convention: flat string templates. The `tx` helper at
 * `kernel/util/tx.ts` does the interpolation (none needed here today).
 */

export const NODE_STABILITY_TEXTS = {
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
