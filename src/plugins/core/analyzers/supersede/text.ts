/**
 * User-facing strings emitted by the `supersede` built-in analyzer
 * (`plugins/core/analyzers/supersede/index.ts`).
 *
 * The analyzer surfaces no issues; it only projects the inspector
 * action button that dispatches `core/node-supersede`. These strings
 * are the button label, the prompt label, and the disabled-reason
 * tooltip.
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
