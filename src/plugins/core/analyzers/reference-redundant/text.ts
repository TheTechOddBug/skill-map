/**
 * User-facing strings emitted by the `reference-redundant` built-in
 * rule (`plugins/core/analyzers/reference-redundant/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const REFERENCE_REDUNDANT_TEXTS = {
  /**
   * Multi-form / multi-occurrence reference message. Short and direct:
   * names the duplicated target + count and lists each occurrence
   * (trigger + line) so the operator sees the offending spots at a
   * glance. The source node is the finding's own node, so it is not
   * repeated here.
   */
  message:
    'Duplicate reference to {{resolvedTarget}} ({{count}} occurrences): {{occurrences}}.',
  /** Inline separator between occurrences in the message. */
  occurrenceSeparator: ', ',
  /** Per-occurrence formatting (trigger + line). */
  occurrence:
    '`{{trigger}}` ({{kind}}, line {{line}})',
  /** Per-occurrence formatting when the extractor did not record a line. */
  occurrenceUnknownLine:
    '`{{trigger}}` ({{kind}}, unknown line)',
} as const;
