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
  submitErrExtensionNotFound: 'extension {{extension}} not found',
  // The parenthetical stays Action-worded on purpose: the conformance case
  // `extension-mode-routing-deterministic` pins the phrases
  // "only probabilistic extensions are queued" and
  // "deterministic actions run in-process".
  submitErrExtensionNotProbabilistic:
    'extension {{extension}} is {{mode}}; only probabilistic extensions are queued (deterministic actions run in-process)',
  // Cross-kind collision: one extension id resolves to a probabilistic
  // Action AND a probabilistic Analyzer. The `<kind>:` prefixed forms are
  // always accepted, so the advisory names both disambiguators.
  submitErrAmbiguousExtension:
    'extension {{extension}} matches both a probabilistic action and a probabilistic analyzer; ' +
    'disambiguate with action:{{actionId}} or analyzer:{{analyzerId}}',
  submitErrPromptUnresolved:
    'cannot resolve the prompt template for {{extension}} ({{detail}})',
  submitErrReportSchemaUnresolved:
    'cannot resolve the report schema for {{extension}} ({{detail}})',
  submitErrNodeNotFound: 'node {{node}} is not in the latest scan',
  submitErrNodeVirtual: 'node {{node}} is virtual (no backing file to render)',
  submitErrNodeDrifted:
    'node {{node}} changed on disk since the last scan; run sm scan and resubmit',
  submitErrNodeUnreadable:
    'node {{node}} cannot be read from disk ({{detail}}); run sm scan to refresh the graph',
  submitReadNotOnDisk: 'file missing or not readable as a node',
  submitErrBadTtl: '--ttl must be an integer number of seconds, got {{value}}',
  submitErrBadPriority: '--priority must be an integer, got {{value}}',
  // Fixer refusal (`spec/job-lifecycle.md` §Findings injection for fixers):
  // a probabilistic Action declaring `precondition.analyzerIds` submitted
  // over a node with no current non-stale matching findings has nothing to
  // fix, so submit refuses (exit 2) instead of rendering an empty section.
  submitErrNoFindings:
    'no findings to resolve for {{finders}} on {{node}}; run the finder first, or the node changed since it ran',

  // --- submit: human summary lines ---------------------------------------
  submitQueuedLine: '{{glyph}}  queued {{id}}  {{node}}\n',
  submitDuplicateLine:
    '{{glyph}}  duplicate: active job {{id}} already covers {{node}}\n',
  submitDriftLine:
    '{{glyph}}  drift: {{node}} changed on disk since the last scan (run sm scan)\n',
  submitUnreadableLine:
    '{{glyph}}  unreadable: {{node}} cannot be read from disk ({{detail}})\n',
  submitNoFindingsLine:
    '{{glyph}}  no findings: {{node}} has no {{finders}} findings to resolve\n',
  submitAllSummary:
    '{{glyph}}  submitted {{submitted}}, refused {{refused}} (of {{total}} matching node(s))\n',
  submitAllNoMatch: '{{glyph}}  no nodes match the precondition for {{extension}}\n',

  // --- list --------------------------------------------------------------
  listEmpty: '{{glyph}}  no jobs{{suffix}}\n',
  listHeader: '{{id}}  {{status}}  {{priority}}  {{extension}}  {{node}}\n',
  listRow: '{{id}}  {{status}}  {{priority}}  {{extension}}  {{node}}\n',
  listFilterSuffix: ' matching the filter',

  // --- show --------------------------------------------------------------
  showErrNotFound: '{{glyph}}  sm job show: job {{id}} not found\n',
  showDetail:
    'job {{id}}\n' +
    '  status       {{status}}\n' +
    '  extension    {{extension}}\n' +
    '  kind         {{kind}}\n' +
    '  node         {{node}}\n' +
    '  priority     {{priority}}\n' +
    '  ttl          {{ttl}}\n' +
    '  contentHash  {{contentHash}}\n' +
    '  createdAt    {{createdAt}}\n' +
    '  claimedAt    {{claimedAt}}\n' +
    '  finishedAt   {{finishedAt}}\n' +
    '  runner       {{runner}}\n',
  showValueNone: '(none)',
  /** TTL detail value for an armed job; TTL-less jobs render showValueNone. */
  showTtlSeconds: '{{seconds}}s',

  previewErrNotFound: '{{glyph}}  sm job preview: job {{id}} not found\n',
  previewErrContentMissing:
    '{{glyph}}  sm job preview: job {{id}} has no stored content (state_job_contents row missing)\n',
  previewErrNeedTarget: '{{glyph}}  sm job preview: pass <job.id> or --last\n',
  previewErrTargetConflict: '{{glyph}}  sm job preview: pass either <job.id> or --last, not both\n',
  previewErrNoJobs: '{{glyph}}  sm job preview: no jobs submitted yet, nothing to preview\n',

  // --- claim -------------------------------------------------------------
  // claim writes the raw id (plain) or the {id,nonce,content} JSON to
  // stdout; an empty queue exits 1 with no output. The only claim-owned
  // strings are the missing-content corruption surface (spec
  // job-lifecycle.md §Atomic claim · Missing content row at claim).
  claimErrContentMissing:
    '{{glyph}}  sm job claim: job {{id}} has no stored content (state_job_contents row missing); marked failed / job-file-missing\n',
  claimContentMissingDetail: 'state_job_contents row missing for the claimed job',

  // --- status ------------------------------------------------------------
  statusErrNotFound: '{{glyph}}  sm job status: job {{id}} not found\n',
  statusSingleLine: 'job {{id}}  {{status}}\n',
  statusCounts:
    'queued     {{queued}}\n' +
    'running    {{running}}\n' +
    'completed  {{completed}}\n' +
    'failed     {{failed}}\n' +
    'cancelled  {{cancelled}}\n',

  // --- cancel ------------------------------------------------------------
  cancelErrPrefix: '{{glyph}}  sm job cancel: {{message}}\n',
  cancelErrNeedTarget: 'pass <job.id> or --all',
  cancelErrTargetConflict: 'pass either <job.id> or --all, not both',
  cancelErrNotFound: 'job {{id}} not found',
  cancelErrAlreadyTerminal: 'job {{id}} is already terminal',
  cancelOneLine: '{{glyph}}  cancelled {{id}}\n',
  cancelAllSummary: '{{glyph}}  cancelled {{count}} active job(s)\n',

  // --- fail --------------------------------------------------------------
  failErrPrefix: '{{glyph}}  sm job fail: {{message}}\n',
  failErrNeedTarget: 'pass <job.id> or --all',
  failErrTargetConflict: 'pass either <job.id> or --all, not both',
  failErrNotFound: 'job {{id}} not found',
  failErrAlreadyTerminal: 'job {{id}} is already terminal',
  failOneLine: '{{glyph}}  failed {{id}}\n',
  failAllSummary: '{{glyph}}  failed {{count}} active job(s)\n',
} as const;
