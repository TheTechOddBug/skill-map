/**
 * Strings emitted by `cli/commands/job-queue.ts` (`sm job submit / list /
 * show`). English-only catalog per the project i18n stance; interpolated
 * by `kernel/util/tx.ts`.
 */

export const JOBS_QUEUE_TEXTS = {
  // --- submit: operational errors ----------------------------------------
  submitErrPrefix: '{{glyph}}  sm job submit: {{message}}\n',
  submitErrNeedTarget: 'pass -n <node.path> or --all',
  submitErrTargetConflict: '-n and --all are mutually exclusive',
  submitErrRunUnsupported:
    '--run is not available in this build (the job runner ships in a later Step 10 sub-step); enqueue without --run',
  submitErrActionNotFound: 'action {{action}} not found',
  submitErrActionNotProbabilistic:
    'action {{action}} is {{mode}}; only probabilistic actions are queued (deterministic actions run in-process)',
  submitErrPromptUnresolved:
    'cannot resolve the prompt template for {{action}} ({{detail}})',
  submitErrNodeNotFound: 'node {{node}} is not in the latest scan',
  submitErrNodeVirtual: 'node {{node}} is virtual (no backing file to render)',
  submitErrBadTtl: '--ttl must be an integer number of seconds, got {{value}}',
  submitErrBadPriority: '--priority must be an integer, got {{value}}',

  // --- submit: human summary lines ---------------------------------------
  submitQueuedLine: '{{glyph}}  queued {{id}}  {{node}}\n',
  submitDuplicateLine:
    '{{glyph}}  duplicate: active job {{id}} already covers {{node}}\n',
  submitAllSummary:
    '{{glyph}}  submitted {{submitted}}, refused {{refused}} (of {{total}} matching node(s))\n',
  submitAllNoMatch: '{{glyph}}  no nodes match the precondition for {{action}}\n',

  // --- list --------------------------------------------------------------
  listEmpty: '{{glyph}}  no jobs{{suffix}}\n',
  listHeader: '{{id}}  {{status}}  {{priority}}  {{action}}  {{node}}\n',
  listRow: '{{id}}  {{status}}  {{priority}}  {{action}}  {{node}}\n',
  listFilterSuffix: ' matching the filter',

  // --- show --------------------------------------------------------------
  showErrNotFound: '{{glyph}}  sm job show: job {{id}} not found\n',
  showDetail:
    'job {{id}}\n' +
    '  status       {{status}}\n' +
    '  action       {{action}}\n' +
    '  node         {{node}}\n' +
    '  priority     {{priority}}\n' +
    '  ttl          {{ttl}}s\n' +
    '  contentHash  {{contentHash}}\n' +
    '  createdAt    {{createdAt}}\n' +
    '  claimedAt    {{claimedAt}}\n' +
    '  finishedAt   {{finishedAt}}\n' +
    '  runner       {{runner}}\n',
  showValueNone: '(none)',
} as const;
