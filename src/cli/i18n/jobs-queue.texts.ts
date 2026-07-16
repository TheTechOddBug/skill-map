/**
 * Strings emitted by `cli/commands/job-queue.ts` (`sm jobs submit / list /
 * show`). English-only catalog per the project i18n stance; interpolated
 * by `kernel/util/tx.ts`.
 */

export const JOBS_QUEUE_TEXTS = {
  // --- submit: operational errors ----------------------------------------
  submitErrPrefix: '{{glyph}}  sm jobs submit: {{message}}\n',
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
  // over a node NO matching finder ever judged (no rows at all, fresh or
  // stale) has nothing to fix, so submit refuses (exit 2) instead of
  // rendering an empty section. Stale rows are NOT a cause: they ride the
  // injection flagged and the agent verifies them against the current body.
  submitErrNoFindings:
    'no findings to resolve for {{finders}} on {{node}}; run the finder first',

  // --- submit: human summary lines ---------------------------------------
  submitQueuedLine: '{{glyph}}  queued {{id}}  {{node}}\n',
  submitDuplicateLine:
    '{{glyph}}  duplicate: active job {{id}} already covers {{node}}\n',
  // Fixer supersede advisory (`spec/job-lifecycle.md` §Findings injection for
  // fixers · Supersede): a fixer submit whose finding set / body changed since
  // a sibling job was queued CANCELS that stale queued job and enqueues the
  // new one. Human mode only (stderr); the new job id still rides stdout, and
  // --json stays the plain new Job. The identical-request and running-job
  // refusals are NOT supersessions, they reuse submitDuplicateLine (exit 3).
  submitSupersededLine: '{{glyph}}  superseded queued job {{id}}\n',
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
  showErrNotFound: '{{glyph}}  sm jobs show: job {{id}} not found\n',
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

  previewErrNotFound: '{{glyph}}  sm jobs preview: job {{id}} not found\n',
  previewErrContentMissing:
    '{{glyph}}  sm jobs preview: job {{id}} has no stored content (state_job_contents row missing)\n',
  previewErrNeedTarget: '{{glyph}}  sm jobs preview: pass <job.id> or --last\n',
  previewErrTargetConflict: '{{glyph}}  sm jobs preview: pass either <job.id> or --last, not both\n',
  previewErrNoJobs: '{{glyph}}  sm jobs preview: no jobs submitted yet, nothing to preview\n',

  // --- claim -------------------------------------------------------------
  // claim writes the raw id (plain) or the {id,nonce,content} JSON to
  // stdout; an empty queue exits 1 with no output. The only claim-owned
  // strings are the missing-content corruption surface (spec
  // job-lifecycle.md §Atomic claim · Missing content row at claim).
  claimErrContentMissing:
    '{{glyph}}  sm jobs claim: job {{id}} has no stored content (state_job_contents row missing); marked failed / job-file-missing\n',
  claimContentMissingDetail: 'state_job_contents row missing for the claimed job',

  // --- status ------------------------------------------------------------
  statusErrNotFound: '{{glyph}}  sm jobs status: job {{id}} not found\n',
  statusSingleLine: 'job {{id}}  {{status}}\n',
  statusCounts:
    'queued     {{queued}}\n' +
    'running    {{running}}\n' +
    'completed  {{completed}}\n' +
    'failed     {{failed}}\n' +
    'cancelled  {{cancelled}}\n',

  // --- cancel ------------------------------------------------------------
  cancelErrPrefix: '{{glyph}}  sm jobs cancel: {{message}}\n',
  cancelErrNeedTarget: 'pass <job.id> or --all',
  cancelErrTargetConflict: 'pass either <job.id> or --all, not both',
  cancelErrNotFound: 'job {{id}} not found',
  cancelErrAlreadyTerminal: 'job {{id}} is already terminal',
  cancelOneLine: '{{glyph}}  cancelled {{id}}\n',
  cancelAllSummary: '{{glyph}}  cancelled {{count}} active job(s)\n',

  // --- fail --------------------------------------------------------------
  failErrPrefix: '{{glyph}}  sm jobs fail: {{message}}\n',
  failErrNeedTarget: 'pass <job.id> or --all',
  failErrTargetConflict: 'pass either <job.id> or --all, not both',
  failErrNotFound: 'job {{id}} not found',
  failErrAlreadyTerminal: 'job {{id}} is already terminal',
  failOneLine: '{{glyph}}  failed {{id}}\n',
  failAllSummary: '{{glyph}}  failed {{count}} active job(s)\n',
} as const;
