/**
 * User-facing strings for the `node-supersede` built-in action's
 * inspector button (`plugins/core/actions/node-supersede/index.ts`).
 *
 * The action's scan-time `project()` emits the `inspector.action.button`
 * that declares the current node superseded by another (the former
 * `core/supersede` projector analyzer, now folded into the action that
 * dispatches the button). These strings are the button label, the prompt
 * label, and the disabled-reason tooltips.
 *
 * Convention: flat string templates. The `tx` helper at
 * `kernel/util/tx.ts` does the interpolation (none needed here today).
 */

export const SUPERSEDE_TEXTS = {
  /** Label of the inspector action button that declares supersession. */
  supersedeLabel: 'Supersede',
  /** Tooltip shown when the supersede button is disabled (already superseded). */
  supersedeDisabledReason: 'Already superseded.',
  /** Tooltip shown when there is no other node to supersede this one. */
  supersedeNoTargetsReason: 'No other node to supersede this one.',
  /** Prompt label for the target node-picker (enum-pick over the live node set). */
  supersedePromptLabel: 'Superseded by',
} as const;
