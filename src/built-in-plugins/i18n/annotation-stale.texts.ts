/**
 * User-facing strings emitted by the `annotation-stale` built-in rule
 * (`built-in-plugins/rules/annotation-stale/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const ANNOTATION_STALE_TEXTS = {
  /** body changed since last bump */
  bodyDrift: '{{path}}: sidecar `.sm` is stale (body changed since last bump).',
  /** frontmatter changed since last bump */
  frontmatterDrift:
    '{{path}}: sidecar `.sm` is stale (frontmatter changed since last bump).',
  /** both body and frontmatter changed */
  bothDrift:
    '{{path}}: sidecar `.sm` is stale (body and frontmatter changed since last bump).',
} as const;
