/**
 * User-facing strings emitted by the `reference-redundant` built-in
 * rule (`plugins/core/analyzers/reference-redundant/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const REFERENCE_REDUNDANT_TEXTS = {
  /**
   * Diagnosis body (`<what>; <why>`). The shared `formatFinding` helper
   * wraps it with the backtick subject (the resolved target); no
   * `L<line>:` prefix because the per-occurrence line numbers stay inline
   * in the rendered occurrence list. Occurrences are grouped BY TRIGGER:
   * each distinct trigger text appears once with its line numbers
   * collapsed into one paren list. The source node is the finding's own
   * node, so it never appears.
   */
  message: 'Duplicate reference ({{count}}); consolidate the links pointing here: {{occurrences}}',
  /** Remediation hint surfaced via `Issue.fix.summary`. */
  fixSummary: 'Consolidate the duplicate references into one.',
  /** Inline separator between trigger groups in the message. */
  occurrenceSeparator: ', ',
  /** Per-trigger formatting: the trigger once, its lines grouped. */
  occurrence: '`{{trigger}}` (L{{lines}})',
  /** Placeholder for an occurrence whose extractor recorded no line. */
  lineUnknown: '?',
} as const;
