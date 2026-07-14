/**
 * CLI strings emitted by `sm findings` (`cli/commands/findings.ts`).
 *
 * `sm findings` reads `state_findings` from the DB: the judgments
 * recorded by probabilistic finder Analyzers plus the kernel-derived
 * safety rows. Advisory by construction, exit 0 regardless of content;
 * the deterministic sibling with exit-code semantics is `sm check`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const FINDINGS_CLI_TEXTS = {
  noFindings: '{{glyph}}  No findings.\n',

  /** Header summary line: `sm findings: 2 warnings · 1 info`. */
  summaryHeader: 'sm findings: {{summary}}\n\n',
  /**
   * Summary fragments joined by ` · `, each colored at the call site.
   * `{{plural}}` is `''` / `'s'` resolved by count (info has no plural
   * form), mirroring `sm check`'s header grammar.
   */
  summaryErrorFragment: '{{count}} error{{plural}}',
  summaryWarningFragment: '{{count}} warning{{plural}}',
  summaryInfoFragment: '{{count}} info',
  /** Section heading: one per node with at least one finding. */
  fileSection: '  {{file}}\n',
  /**
   * Finding row inside a node section:
   * `⚠  plug/finder  contradiction  message  (85%)`.
   * Glyph is the severity marker (✕ / ⚠ / ℹ) wrapped in color at the
   * call site; `extensionId` and `type` are padded by the renderer so
   * messages align; `confidence` renders dim; `{{staleTag}}` carries the
   * optional yellow ` (stale)` marker under `--stale`.
   */
  findingRow: '    {{glyph}}  {{extensionId}}  {{type}}  {{message}}  {{confidence}}{{staleTag}}\n',
  /** Confidence column value, composed dim at the call site. */
  confidenceValue: '({{percent}}%)',
  /** Marker appended (yellow) to a stale row when `--stale` includes it. */
  staleTag: '  (stale)',
  /**
   * Optional detail line under a finding row (the finder's longer
   * evidence), rendered dim. `{{indent}}` aligns it under the message
   * column.
   */
  detailLine: '       {{detail}}\n',
  /** Footer hint, separated from the body by a blank line. */
  tipLine:
    '\nTip: `sm show <path>` shows a node\'s findings in context; findings are advisory and never gate exit codes.\n',

  // --- sm findings prune ---------------------------------------------------
  pruneNone: '{{glyph}}  No stale findings.\n',
  pruneConfirm:
    'sm findings prune is about to delete {{count}} stale finding{{plural}} ' +
    '(body changed since the judgment, or the node left the scan).\n' +
    'Fresh findings are never touched. Proceed?',
  pruneAborted: '{{glyph}}  sm findings prune: aborted by user. No rows deleted.\n',
  pruneSummary: '{{glyph}}  Deleted {{deleted}} stale finding{{plural}}.\n',
  pruneSummaryDryRun:
    '{{glyph}}  Would delete {{wouldDelete}} stale finding{{plural}}{{dryTag}}\n',
  pruneDryRunTag: '  (dry-run)',

  // --- flag validation (exit 2) ------------------------------------------
  errBadSeverity:
    '{{glyph}}  --severity: invalid value "{{value}}".\n' +
    '   {{hint}}\n',
  errBadSeverityHint: 'Allowed: info, warn, error (minimum severity, e.g. warn keeps warn + error).',
  errBadSince:
    '{{glyph}}  --since: cannot parse "{{value}}" as a date.\n' +
    '   {{hint}}\n',
  errBadSinceHint: 'Pass an ISO date, e.g. 2026-07-01 or 2026-07-01T12:00:00Z.',
  errBadThreshold:
    '{{glyph}}  --threshold: invalid value "{{value}}".\n' +
    '   {{hint}}\n',
  errBadThresholdHint: 'Pass a number between 0 and 1, e.g. 0.7.',
} as const;
