/**
 * Strings emitted by `cli/commands/record.ts` (`sm record`, the job
 * callback). English-only catalog per the project i18n stance; interpolated
 * by `kernel/util/tx.ts`.
 */

export const RECORD_TEXTS = {
  // --- operational errors (exit 2 / 4 / 5) -------------------------------
  errPrefix: '{{glyph}}  sm record: {{message}}\n',
  errBadStatus: '--status must be completed or failed, got {{status}}',
  errNeedReport: "--status completed requires --report <path|-> (the agent's report)",
  errBadNumber: '{{flag}} must be a non-negative integer, got {{value}}',
  errJobNotFound: 'job {{id}} not found',
  errNonceMismatch: 'nonce does not match job {{id}}',
  errNotRunning: 'job {{id}} is not in running state (status {{status}})',
  errReportRead: 'cannot read the report from {{source}} ({{detail}})',
  errReportSchemaUnresolved:
    'cannot resolve the report schema for extension {{extension}} ({{detail}})',
  reportInvalid: 'report failed schema validation: {{errors}}',
  // The reserved-finding-type detail moved to the shared record core
  // (`core/jobs/i18n/record-outcome.texts.ts`) with `record-outcome.ts`.

  // --- success lines (human mode) ----------------------------------------
  completedLine: '{{glyph}}  recorded {{execId}}: job {{id}} completed\n',
  failedLine: '{{glyph}}  recorded {{execId}}: job {{id}} failed ({{reason}})\n',

  /**
   * Tags write-through advisories (spec/job-lifecycle.md §Tags
   * write-through): the applied line echoes the node's FULL merged tag
   * list; the consent line explains why nothing was written (the report
   * still carries the tags).
   */
  tagsApplied: '{{glyph}}  tags on {{node}}: {{tags}}\n',
  tagsConsentMissing:
    '{{glyph}}  tags not applied to {{node}}: no standing .sm consent (allowEditSmFiles); the report keeps them\n',
} as const;
