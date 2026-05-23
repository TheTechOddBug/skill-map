/**
 * User-facing strings emitted by the `redundant-target-reference`
 * built-in rule (`plugins/core/analyzers/redundant-target-reference/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const REDUNDANT_TARGET_REFERENCE_TEXTS = {
  /**
   * Multi-form / multi-occurrence reference message. Lists each
   * occurrence (trigger + line) so the operator sees the full
   * authorial surface without having to grep the body.
   */
  message:
    '{{source}} references {{resolvedTarget}} via {{count}} occurrences: {{occurrences}}. Consider consolidating to a single form to reduce maintenance surface and avoid duplicate inlining at runtime.',
  /** Inline separator between occurrences in the message. */
  occurrenceSeparator: ', ',
  /** Per-occurrence formatting (trigger + line). */
  occurrence:
    '`{{trigger}}` ({{kind}}, line {{line}})',
  /** Per-occurrence formatting when the extractor did not record a line. */
  occurrenceUnknownLine:
    '`{{trigger}}` ({{kind}}, unknown line)',
} as const;
