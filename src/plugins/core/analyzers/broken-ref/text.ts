/**
 * User-facing strings emitted by the `broken-ref` built-in rule
 * (`plugins/core/analyzers/broken-ref/index.ts`). Issue messages land
 * in `scan_issues.message` and surface through `sm check` / `sm show` /
 * `sm export`, so the same i18n discipline as the CLI catalogs applies.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const BROKEN_REF_TEXTS = {
  /** `Broken <kind> reference from <source> → <target>` */
  message: 'Broken {{kind}} reference from {{source}} → {{target}}',
  // Tooltips for the per-node view-contribution badges. Singular vs
  // plural keeps the count grammar correct without a sub-template.
  alertTooltipSingle:
    'This node has a broken reference. Open the inspector for details.',
  alertTooltipMany:
    'This node has {{count}} broken references. Open the inspector for details.',
  // Fix-summary copy when the broken trigger has a same-named file on
  // disk that does not advertise `name:` in its frontmatter. Two
  // variants for single vs multiple candidates; same template family
  // as the alert tooltips above.
  hintSummarySingle:
    'Add `name: {{name}}` to the frontmatter of {{candidate}} so this reference resolves.',
  hintSummaryMany:
    'Add `name: {{name}}` to the frontmatter of one of these files so this reference resolves: {{candidates}}.',
} as const;
