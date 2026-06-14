/**
 * User-facing strings emitted by the `reference-broken` built-in rule
 * (`plugins/core/analyzers/reference-broken/index.ts`). Issue messages
 * land in `scan_issues.message` and surface through `sm check` /
 * `sm show` / `sm export`, so the same i18n discipline as the CLI
 * catalogs applies.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const REFERENCE_BROKEN_TEXTS = {
  /**
   * Compact finding grammar: line 1 = the unresolved target, line 2 =
   * the short diagnosis plus WHERE the reference sits (`{{where}}` is
   * the pre-rendered location suffix below, or empty when the link
   * carries no line info). The source is the finding's own node, so it
   * never appears in the message.
   */
  message: '{{target}}:\nBroken {{kindLabel}}{{where}}.',
  /** Location suffix, one detection site. */
  whereSingle: ' (line {{lines}})',
  /** Location suffix, several detection sites. */
  wherePlural: ' (lines {{lines}})',
  /**
   * Human noun per link kind for the message above. Fallback for an
   * off-catalog kind: `<kind> link` (composed in the analyzer).
   */
  kindLabels: {
    references: 'reference',
    mentions: 'mention',
    invokes: 'invocation',
    supersedes: 'supersession',
    points: 'pointer',
  } as Record<string, string>,
  kindLabelFallback: '{{kind}} link',
  // Tooltips for the per-node view-contribution badges. Singular vs
  // plural keeps the count grammar correct without a sub-template.
  alertTooltipSingle:
    'This node has a broken reference. Open the inspector for details.',
  alertTooltipMany:
    'This node has {{count}} broken references. Open the inspector for details.',
} as const;
