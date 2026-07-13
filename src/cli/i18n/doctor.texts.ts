/**
 * Strings for `sm doctor` (`cli/commands/doctor.ts`). Same `tx(template,
 * vars)` convention as every `*.texts.ts` peer; templates carry a
 * `{{glyph}}` placeholder and stay color-free per
 * `context/cli-output-style.md` §4.1.
 */

export const DOCTOR_TEXTS = {
  // One glyph row per check (§3.5): `<glyph>  <label padded>  <message>`.
  checkRow: '{{glyph}}  {{label}}  {{message}}\n',

  labelDb: 'db integrity',
  labelMigrations: 'migrations',
  labelHistory: 'history',
  labelJobContents: 'job contents',
  labelJobGc: 'job gc',
  labelPlugins: 'plugins',
  labelRunner: 'llm runner',
  labelProviders: 'providers',

  dbOk: 'PRAGMA quick_check ok',
  dbCorrupt: 'quick_check failed: {{detail}}',

  migrationsOk: 'schema up to date (version {{version}})',
  migrationsPending: '{{count}} pending ({{names}}), run `sm db migrate`',

  historyOk: 'no orphan history rows',
  historyOrphans: '{{count}} orphan {{noun}}, run `sm orphans`',
  historyNounSingular: 'issue',
  historyNounPlural: 'issues',

  jobContentsOk: 'state_jobs and state_job_contents consistent',
  jobContentsMissing:
    '{{count}} {{noun}} missing the content row (DB corruption), affected jobs fail at claim',
  jobNounSingular: 'job',
  jobNounPlural: 'jobs',

  jobGcOk: 'no orphaned content rows',
  jobGcStragglers: '{{count}} orphaned content {{noun}}, run `sm job prune`',
  contentNounSingular: 'row',
  contentNounPlural: 'rows',

  pluginsOk: 'no plugins in error state',
  pluginsErrored: '{{list}}, run `sm plugins doctor`',

  runnerOk: '{{version}} on PATH',
  runnerOkNoVersion: 'claude binary on PATH',
  runnerMissing:
    'claude binary not on PATH, `sm job run` is unavailable (queue and Skill-agent flows still work)',

  providersOk: 'every detected provider matched at least one node',
  providersNoScan: 'no scan persisted yet, detection check skipped',
  providersEmpty: '{{id}} detected ({{marker}}) but matched no nodes',

  summaryOk: '{{glyph}}  All checks green.\n',
  summaryWarn: '{{glyph}}  {{warnings}} {{noun}}.\n',
  summaryError: '{{glyph}}  {{errors}} {{errorNoun}}, {{warnings}} {{warnNoun}}.\n',
  warningNounSingular: 'warning',
  warningNounPlural: 'warnings',
  errorNounSingular: 'error',
  errorNounPlural: 'errors',
} as const;
