/**
 * User-facing strings emitted by the `annotation-stale` built-in rule
 * (`plugins/core/analyzers/annotation-stale/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const ANNOTATION_STALE_TEXTS = {
  // Compact finding grammar: the affected node is the finding's own
  // node, so its path never appears in the message.
  /** body changed since last bump */
  bodyDrift: 'Sidecar `.sm` is stale: body changed since last bump.',
  /** frontmatter changed since last bump */
  frontmatterDrift: 'Sidecar `.sm` is stale: frontmatter changed since last bump.',
  /** both body and frontmatter changed */
  bothDrift: 'Sidecar `.sm` is stale: body and frontmatter changed since last bump.',
  // Tooltips for the `card.footer.right` clock chip emitted alongside
  // the issue. Lists only the drifted face(s), in-sync faces are
  // omitted so the operator immediately sees what's modified without
  // scanning prose. No `{{path}}` placeholder, the chip already sits
  // on the affected node. The hint `sm bump <path>` keeps `<path>` as
  // a literal placeholder the operator substitutes.
  bodyTooltip:
    'Sidecar drift since last bump:\n  • body\nRun `sm bump <path>` to refresh.',
  frontmatterTooltip:
    'Sidecar drift since last bump:\n  • frontmatter\nRun `sm bump <path>` to refresh.',
  bothTooltip:
    'Sidecar drift since last bump:\n  • body\n  • frontmatter\nRun `sm bump <path>` to refresh.',
} as const;
