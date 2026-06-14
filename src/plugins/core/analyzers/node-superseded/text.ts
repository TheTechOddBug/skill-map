/**
 * User-facing strings emitted by the `node-superseded` built-in rule
 * (`plugins/core/analyzers/node-superseded/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const NODE_SUPERSEDED_TEXTS = {
  /**
   * Diagnosis body (`<what>; <why>`). The shared `formatFinding` helper
   * wraps it with the backtick subject (the superseding artifact); the
   * superseded node is the finding's own node, so its path never appears.
   */
  message: 'Superseded; a newer node supersedes this one',
} as const;
