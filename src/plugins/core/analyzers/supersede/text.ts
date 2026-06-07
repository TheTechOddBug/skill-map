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
  /** Prompt label for the target-path single-string input. */
  supersedePromptLabel: 'Superseded by (node path)',
} as const;
