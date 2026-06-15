/**
 * User-facing strings emitted by the `reference-redundant` built-in
 * rule (`plugins/core/analyzers/reference-redundant/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const REFERENCE_REDUNDANT_TEXTS = {
  /**
   * Diagnosis body (`<what>; <why>`). Kind-agnostic wording ("links", not
   * "reference"): the redundancy can span different link kinds (e.g.
   * `invokes` + `references` to one node), so the message never names a
   * single kind. The shared `formatFinding` helper wraps it with the
   * backtick subject (the resolved target); no `L<line>:` prefix because
   * the per-occurrence line numbers stay inline in the rendered
   * occurrence list. Remediation lives in `fix.summary`, not the message.
   * Occurrences are grouped BY TRIGGER: each distinct trigger text
   * appears once with its line numbers collapsed into one paren list. The
   * source node is the finding's own node, so it never appears.
   */
  message: 'Redundant links; the target is reached {{count}} times: {{occurrences}}',
  /**
   * Remediation hint surfaced via `Issue.fix.summary`. Phrased as
   * optional: severity is `info` and keeping multiple forms can be
   * deliberate, so the hint offers consolidation OR keeping the overlap.
   */
  fixSummary: 'Consolidate the links into one, or keep the overlap deliberately.',
  /** Inline separator between trigger groups in the message. */
  occurrenceSeparator: ', ',
  /** Per-trigger formatting: the trigger once, its lines grouped. */
  occurrence: '`{{trigger}}` (L{{lines}})',
  /** Placeholder for an occurrence whose extractor recorded no line. */
  lineUnknown: '?',
} as const;
