/**
 * User-facing strings emitted by the `reference-redundant` built-in
 * rule (`plugins/core/analyzers/reference-redundant/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const REFERENCE_REDUNDANT_TEXTS = {
  /**
   * Compact finding grammar (subject first, `\n` renders as a line
   * break in the inspector and flattens to a space in `sm check`):
   *
   *   <resolvedTarget>:
   *   Duplicate reference (2): `references/x.md` (124, 145).
   *
   * Occurrences are grouped BY TRIGGER: each distinct trigger text
   * appears once with its line numbers collapsed into one paren list.
   * The source node is the finding's own node, so it never appears.
   */
  message: '{{resolvedTarget}}:\nDuplicate reference ({{count}}): {{occurrences}}.',
  /** Inline separator between trigger groups in the message. */
  occurrenceSeparator: ', ',
  /** Per-trigger formatting: the trigger once, its lines grouped. */
  occurrence: '`{{trigger}}` ({{lines}})',
  /** Placeholder for an occurrence whose extractor recorded no line. */
  lineUnknown: '?',
} as const;
