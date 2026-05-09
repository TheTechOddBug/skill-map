/**
 * Strings emitted by `cli/commands/history.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const HISTORY_TEXTS = {
  noExecutionsFound: 'No executions found.\n',

  invalidIsoDateTime:
    '{{glyph}}  {{flag}}: expected an ISO-8601 date-time, got "{{value}}".\n',
  statusEmpty:
    '{{glyph}}  --status: expected one or more values.\n' +
    '   {{hint}}\n',
  statusEmptyHint: 'Allowed: {{allowed}}.',
  statusInvalid:
    '{{glyph}}  --status: invalid value "{{value}}".\n' +
    '   {{hint}}\n',
  statusInvalidHint: 'Allowed: {{allowed}}.',

  periodInvalid:
    '{{glyph}}  --period: invalid value "{{value}}".\n' +
    '   {{hint}}\n',
  periodInvalidHint: 'Allowed: {{allowed}}.',
  schemaValidationFailed:
    '{{glyph}}  internal: history-stats output failed schema validation — {{errors}}\n',

  // --- renderStats: sectioned layout (matches `sm plugins doctor`) -----
  statsAllTimeWindow: '(all time)',
  /** One-line dense header: `sm history stats — N executions · M.M% error rate`. */
  statsHeader: 'sm history stats — {{summary}}\n\n',
  /** Section heading rendered before each indented block. */
  statsSectionHeader: '  {{title}}\n',
  /** Two-column field row inside a section, label padded by the renderer. */
  statsFieldRow: '    {{label}}  {{value}}\n',
  statsSectionTitleWindow: 'Window',
  statsSectionTitleTotals: 'Totals',
  statsSectionTitleTopActions: 'Top actions (by tokens)',
  statsSectionTitleTopNodes: 'Top nodes',
  statsSectionTitleFailures: 'Failures by reason',
  statsLabelSince: 'Since',
  statsLabelUntil: 'Until',
  statsLabelExecutions: 'Executions',
  statsLabelTokens: 'Tokens',
  statsLabelDuration: 'Duration',
  /** `N (X ok · Y failed · Z cancelled)` — only the populated buckets render. */
  statsExecutionsCount: '{{count}}{{breakdown}}',
  statsTokensSplit: '{{in}} in / {{out}} out',
  /** Per-action row: `<id>@<version>  N runs  ·  T_in/T_out`. */
  statsTopActionsRow: '    {{id}}  {{runs}} {{runsLabel}}  ·  {{tokens}}\n',
  /** Per-node row: `<path>  N runs`. */
  statsTopNodesRow: '    {{path}}  {{runs}} {{runsLabel}}\n',
  /** Per-reason row: `<reason>  N`. */
  statsFailuresRow: '    {{reason}}  {{count}}\n',
  /** Singular / plural for the runs column in the top tables. */
  statsRunsSingular: 'run',
  statsRunsPlural: 'runs',

  /**
   * Status cell composition: `<status> (<failureReason>)` when a failure
   * reason is present, plain `<status>` otherwise. Caller picks the
   * variant.
   */
  statusWithReason: '{{status}} ({{reason}})',

  // --- renderTable labels ------------------------------------------------
  tableHeaderId: 'ID',
  tableHeaderStarted: 'STARTED',
  tableHeaderAction: 'ACTION',
  tableHeaderStatus: 'STATUS',
  tableHeaderDuration: 'DUR',
  tableHeaderTokens: 'TOKENS',
  tableHeaderNodes: 'NODES',
  /** Footer line under the table: count + plural-correct noun. */
  tableFooterCount: '{{count}} {{noun}}\n',
  tableFooterNounSingular: 'execution',
  tableFooterNounPlural: 'executions',
  /** Footer tip — printed dim under the count. */
  tableFooterTip:
    'Tip: `sm history stats` for aggregated counts and top actions.\n',
} as const;
