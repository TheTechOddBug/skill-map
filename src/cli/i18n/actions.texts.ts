/**
 * CLI strings emitted by `sm actions` (`cli/commands/actions.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const ACTIONS_TEXTS = {
  // --- list: table ---------------------------------------------------------
  tableHeaderId: 'ID',
  tableHeaderMode: 'MODE',
  tableHeaderDescription: 'DESCRIPTION',

  /** Footer line: count of rendered actions (`4 actions` / `1 action`). */
  tableFooterCount: '{{count}} {{noun}}\n',
  footerNounSingular: 'action',
  footerNounPlural: 'actions',
  /** Footer tip, printed dim under the count. */
  tableFooterTip:
    'Tip: `sm actions show <id>` for the full manifest; `sm jobs submit <id> -n <node>` to queue one.\n',

  /** Defensive: the built-ins always register actions, but stay friendly. */
  listEmpty: '{{glyph}}  No actions registered.\n',

  // --- show: errors --------------------------------------------------------
  showNotFound:
    '{{glyph}}  sm actions show: action {{id}} not found\n' +
    '   {{hint}}\n',
  showNotFoundHint: 'Run `sm actions list` to see the registered ids.',

  // --- show: detail block --------------------------------------------------
  showHeader: '  {{qualifiedId}}\n',
  fieldRow: '    {{label}}  {{value}}\n',
  sectionProbabilistic: '\n  Probabilistic\n',
  sectionPrecondition: '\n  Precondition\n',

  fieldPlugin: 'plugin',
  fieldMode: 'mode',
  fieldDescription: 'description',
  fieldWrites: 'writes',
  fieldSource: 'source',
  fieldExpectedDuration: 'expected duration',
  fieldPromptTemplate: 'prompt template',
  fieldReportSchema: 'report schema',
  fieldPrecondKind: 'kind',
  fieldPrecondProvider: 'provider',
  fieldPrecondAnalyzers: 'analyzers',

  expectedDurationValue: '{{n}}s',
  promptTemplateInline: 'inline (built-in)',

  /** Source label for actions bundled with the CLI (no on-disk plugin dir). */
  sourceBuiltIn: 'built-in',
} as const;
