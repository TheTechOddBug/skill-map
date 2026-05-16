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
} as const;
