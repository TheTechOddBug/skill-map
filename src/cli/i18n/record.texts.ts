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
   * Tagger advisory (spec/job-lifecycle.md §Tags proposal): the record path
   * writes NO curation, so the line names what the model proposed and where
   * the human saves it. Nouns paired per the pluralisation convention.
   */
  tagsProposed:
    '{{glyph}}  {{count}} {{noun}} proposed for {{node}}: {{tags}}, review and save them in the tags editor\n',
  tagsNounSingular: 'tag',
  tagsNounPlural: 'tags',
} as const;
