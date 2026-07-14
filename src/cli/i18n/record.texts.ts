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
  /**
   * Detail rendered through `reportInvalid` when a finder report's
   * `findings[]` uses a kernel-reserved type slug (spec
   * `findings/report.schema.json`: extensions MUST NOT emit them).
   */
  reservedFindingTypes:
    'findings[] uses the reserved type slug(s) {{slugs}} ' +
    '(injection-detected / content-suspicious / content-malformed are kernel-derived and MUST NOT be emitted by extensions)',

  // --- success lines (human mode) ----------------------------------------
  completedLine: '{{glyph}}  recorded {{execId}}: job {{id}} completed\n',
  failedLine: '{{glyph}}  recorded {{execId}}: job {{id}} failed ({{reason}})\n',
} as const;
