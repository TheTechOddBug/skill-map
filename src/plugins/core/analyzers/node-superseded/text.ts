/**
 * User-facing strings emitted by the `node-superseded` built-in rule
 * (`plugins/core/analyzers/node-superseded/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const NODE_SUPERSEDED_TEXTS = {
  /** `<path> is superseded by <supersededBy>` */
  message: '{{path}} is superseded by {{supersededBy}}',
} as const;
