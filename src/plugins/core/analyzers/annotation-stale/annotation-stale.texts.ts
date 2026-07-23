/**
 * User-facing strings emitted by the `annotation-stale` built-in rule
 * (`plugins/core/analyzers/annotation-stale/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const ANNOTATION_STALE_TEXTS = {
  // Tooltips for the `card.footer.right` clock chip / inspector header
  // badge (the analyzer's ONLY surfaces since the info issue was retired,
  // user call 2026-07-20). Lists only the drifted face(s), in-sync faces
  // are omitted so the operator immediately sees what's modified without
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
