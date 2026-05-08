/**
 * CLI strings emitted by `sm list` (`cli/commands/list.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const LIST_TEXTS = {
  invalidSortBy:
    '--sort-by: invalid sort field "{{value}}". Allowed: {{allowed}}.\n',

  noNodesFound: 'No nodes found.\n',

  // --- renderTable column headers ----------------------------------------
  tableHeaderPath: 'PATH',
  tableHeaderKind: 'KIND',
  tableHeaderOut: 'OUT',
  tableHeaderIn: 'IN',
  tableHeaderExt: 'EXT',
  tableHeaderIssues: 'ISSUES',
  tableHeaderBytes: 'BYTES',

  /** Footer line: count of rendered nodes (`3 nodes` / `1 node`). */
  tableFooterCount: '{{count}} {{noun}}\n',
  tableFooterNounSingular: 'node',
  tableFooterNounPlural: 'nodes',
  /** Footer tip — printed dim under the count. */
  tableFooterTip:
    'Tip: `sm show <path>` for details, `sm check` for issues.\n',
} as const;
