/**
 * User-facing strings emitted by the `link-conflict` built-in rule
 * (`plugins/core/analyzers/link-conflict/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const LINK_CONFLICT_TEXTS = {
  /**
   * Compact finding grammar: line 1 = the disputed target, line 2 =
   * the short diagnosis. The source is the finding's own node, so it
   * never appears in the message.
   */
  message: '{{target}}:\nDetectors disagree on link kind ({{kindList}}).',
} as const;
