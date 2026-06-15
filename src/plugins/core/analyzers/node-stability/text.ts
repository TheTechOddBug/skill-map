/**
 * User-facing strings emitted by the `node-stability` built-in analyzer
 * (`plugins/core/analyzers/node-stability/index.ts`).
 *
 * Only `deprecated` raises a finding (experimental is a chip-only badge),
 * so this catalog carries the one issue body. The inspector "Set stability"
 * button strings live with the action that self-projects it
 * (`plugins/core/actions/node-set-stability/text.ts`).
 *
 * Convention: flat string templates. The shared `formatFinding` helper
 * wraps the body below; the finding carries no subject (the node path lives
 * in `nodeIds`).
 */

export const NODE_STABILITY_TEXTS = {
  /** Issue body (`<what>; <why>`) for a deprecated-marked node. */
  deprecated: 'Marked deprecated; avoid using it',
} as const;
