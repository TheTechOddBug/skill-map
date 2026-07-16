/**
 * Strings emitted by `cli/commands/jobs.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const JOBS_TEXTS = {
  pruneErrorPrefix: '{{glyph}}  sm jobs prune: {{message}}\n',

  // --- printPretty (sm jobs prune human output) ---------------------------
  pruneTagDryRun: 'sm jobs prune (dry-run)',
  pruneTagApply: 'sm jobs prune',
  pruneRetentionRow:
    '  {{label}} policy {{policy}}, {{rows}} row(s) {{rowsVerb}}\n',
  pruneContentsRow: '  content rows: {{count}} {{verb}}\n',

  pruneRowsVerbDryRun: 'would be deleted',
  pruneRowsVerbApply: 'deleted',
  pruneContentsVerbDryRun: 'would be collected',
  pruneContentsVerbApply: 'collected',

  pruneLabelCompleted: 'completed:',
  pruneLabelFailed: 'failed:   ',
  pruneLabelCancelled: 'cancelled:',

  pruneRetentionPolicyNever: 'never',
} as const;
