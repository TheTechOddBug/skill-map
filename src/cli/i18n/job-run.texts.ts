/**
 * Strings emitted by `cli/commands/job-run.ts` (`sm job run`, the CLI
 * runner drain loop). English-only catalog per the project i18n stance;
 * interpolated by `kernel/util/tx.ts`.
 */

export const JOB_RUN_TEXTS = {
  // --- operational errors (exit 2) ----------------------------------------
  errPrefix: '{{glyph}}  sm job run: {{message}}\n',
  errTargetConflict: '--all and --max are mutually exclusive',
  errBadMax: '--max must be an integer >= 1, got {{value}}',
  errClaudeNotFound:
    '{{detail}}; install the Claude CLI, or drain the queue via sm job claim + sm record',

  // --- per-run progress (human mode, stderr) ------------------------------
  reapedLine: '{{glyph}}  reaped {{count}} expired running job(s)\n',
  queueEmpty: '{{glyph}}  queue empty, nothing to run\n',
  jobStartLine: '{{glyph}}  running {{id}}  {{action}}  {{node}}\n',
  jobCompletedLine: '{{glyph}}  {{id}} completed ({{execId}})\n',
  jobFailedLine: '{{glyph}}  {{id}} failed ({{reason}})\n',
  jobDiscardedLine:
    '{{glyph}}  {{id}} left the running state mid-run (cancelled, failed, or reaped); result discarded\n',
  summaryLine:
    '{{glyph}}  drained {{count}} job(s): {{completed}} completed, {{failed}} failed\n',

  // --- failure details stored in report_json ------------------------------
  detailContentMissing: 'state_job_contents row missing for the claimed job',
} as const;
