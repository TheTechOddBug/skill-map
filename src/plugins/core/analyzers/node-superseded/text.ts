/**
 * User-facing strings emitted by the `node-superseded` built-in rule
 * (`plugins/core/analyzers/node-superseded/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const NODE_SUPERSEDED_TEXTS = {
  /**
   * Compact finding grammar: line 1 = the superseding artifact, line
   * 2 = what it means. The superseded node is the finding's own node,
   * so its path never appears in the message.
   */
  message: '{{supersededBy}}:\nSupersedes this node.',
} as const;
