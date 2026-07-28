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
  labelJobsOverdue: 'jobs overdue',
  labelPlugins: 'plugins',
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
  jobGcStragglers: '{{count}} orphaned content {{noun}}, run `sm jobs prune`',
  jobsOverdueOk: 'no running job past its advisory estimate',
  /**
   * One warn per running job whose elapsed time exceeds its extension's
   * ADVISORY probExpectedDurationSeconds (Decision #139: TTL-less jobs
   * never auto-expire, this check is the operator escape hatch). Purely
   * advisory, never mutates state.
   */
  jobsOverdueWarn:
    'job {{id}} has been running {{elapsedSeconds}}s (advisory estimate {{estimateSeconds}}s); ' +
    'if the agent is gone, resolve it with `sm jobs fail {{id}}` or `sm jobs cancel {{id}}`',
  contentNounSingular: 'row',
  contentNounPlural: 'rows',

  pluginsOk: 'no plugins in error state',
  pluginsErrored: '{{list}}, run `sm plugins doctor`',

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

  /** No plugin grant was skipped: either none recorded, or all verified. */
  trustScopeOk: 'plugin trust grants verified for this checkout',
  /**
   * Grants exist but were made elsewhere. Never accusatory: copying,
   * restoring or re-cloning a project produces this exactly like a
   * hostile repo would, and from here they are indistinguishable.
   */
  trustScopeForeign:
    'plugin trust granted in a different copy of this project, not loaded: {{list}}. ' +
    'Re-grant what you still want with `sm plugins trust <id>`.',
  /** The environment, not the data: re-granting cannot help here. */
  trustScopeAnchorUnusable:
    'this filesystem reports no creation time for .skill-map/, so plugin trust cannot be ' +
    'anchored to this checkout (known on /mnt/... under WSL, /proc, /sys)',
} as const;
