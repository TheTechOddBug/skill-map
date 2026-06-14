/**
 * User-facing strings emitted by the `link-conflict` built-in rule
 * (`plugins/core/analyzers/link-conflict/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const LINK_CONFLICT_TEXTS = {
  /**
   * Diagnosis body (`<what>; <why>`). The shared `formatFinding` helper
   * wraps it with the backtick subject (the disputed target); the source
   * is the finding's own node, so it never appears in the message.
   */
  message: 'Conflicting link kind; detectors disagree ({{kindList}})',
} as const;
