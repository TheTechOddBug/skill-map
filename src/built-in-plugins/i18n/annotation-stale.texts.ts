/**
 * User-facing strings emitted by the `annotation-stale` built-in rule
 * (`built-in-plugins/analyzers/annotation-stale/index.ts`).
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
  // Tooltips for the `graph.node.alert` badge emitted alongside the
  // issue. No `{{path}}` placeholder because the badge already sits on
  // the affected node — the path is redundant. The hint `sm bump <path>`
  // keeps `<path>` as a literal placeholder the operator substitutes.
  bodyTooltip:
    'Sidecar `.sm` is stale: the node body changed since the last bump. Run `sm bump <path>` to refresh.',
  frontmatterTooltip:
    'Sidecar `.sm` is stale: the node frontmatter changed since the last bump. Run `sm bump <path>` to refresh.',
  bothTooltip:
    'Sidecar `.sm` is stale: both the body and the frontmatter changed since the last bump. Run `sm bump <path>` to refresh.',
} as const;
