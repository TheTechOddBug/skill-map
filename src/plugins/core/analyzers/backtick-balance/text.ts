/**
 * User-facing strings emitted by the `backtick-balance` built-in
 * analyzer (`plugins/core/analyzers/backtick-balance/index.ts`).
 *
 * Convention: flat `<what>; <why>` diagnosis bodies plus `fix.summary`
 * remediation hints. The `tx` helper at `kernel/util/tx.ts` interpolates
 * `{{name}}` placeholders; the shared `formatFinding` helper owns the
 * subject / location chrome.
 */

export const BACKTICK_BALANCE_TEXTS = {
  /** An opening fence (``` or ~~~) is never closed. */
  unclosedFence:
    'Unclosed fenced code block; the opening fence has no matching closer, so the code-strip policy swallows the rest of the file and prose extractors stop emitting edges',
  /** Remediation for an unclosed fence. */
  unclosedFenceFix: 'Close the fenced block with a matching ``` (or ~~~) marker.',
  /** A backtick run has no equal-length closer (CommonMark inline span). */
  unclosedInline:
    'Unclosed inline backtick; the backtick run has no matching closer, so the code-strip policy mis-parses the body',
  /** Remediation for an unclosed inline span. */
  unclosedInlineFix:
    'Close the inline span with a matching backtick run, or escape a literal backtick with a backslash.',
} as const;
