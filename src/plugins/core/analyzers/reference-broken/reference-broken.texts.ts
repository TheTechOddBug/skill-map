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
   * Diagnosis body (`<what>; <why>`). The shared `formatFinding` helper
   * wraps it with the backtick subject (the unresolved target) and the
   * `L<line>:` location prefix; the source is the finding's own node, so
   * it never appears in the message.
   */
  message: 'Broken {{kindLabel}}; target not found in the graph or on disk',
  /**
   * Warn-tier variant for code-shaped `@`-trigger tokens (uppercase
   * identifier or npm-scope package, `kernel/util/code-shaped-token.ts`):
   * same diagnosis, plus the hint about WHY the severity is softer.
   */
  messageCodeShaped:
    'Broken {{kindLabel}}; target not found, and the token looks like a code identifier or npm package rather than a reference',
  /**
   * Remediation hint surfaced via `Issue.fix.summary`. Not autofixable:
   * the rule cannot tell which resolution the author wants. The folder
   * option maps to `scan.referencePaths` ("Folders for link validation"
   * in Settings), the rule's own escape hatch: it clears only PATH-style
   * breaks (the file exists on disk outside the indexed graph). A
   * trigger-style `/cmd` / `@agent` break is settled by the path/name or
   * removal options instead.
   */
  fixSummary:
    'Fix the path or name, remove the broken link, or add its folder under Folders for link validation.',
  /**
   * Warn-tier remediation: the dismiss escape hatch is the headline
   * option because the likeliest resolution for prose about code is
   * "this token is intentional, stop flagging it".
   */
  fixSummaryCodeShaped:
    'Dismiss this issue if the token is intentional prose, or fix the name / remove the mention.',
  /**
   * Human noun per link kind for the message above. Fallback for an
   * off-catalog kind: `<kind> link` (composed in the analyzer).
   */
  kindLabels: {
    references: 'reference',
    mentions: 'mention',
    invokes: 'invocation',
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
