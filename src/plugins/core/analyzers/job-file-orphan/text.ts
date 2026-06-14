/**
 * User-facing strings emitted by the `job-file-orphan` built-in rule
 * (`plugins/core/analyzers/job-file-orphan/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const JOB_FILE_ORPHAN_TEXTS = {
  /**
   * Diagnosis body (`<what>; <why>`): a `.md` under `.skill-map/jobs/`
   * that no `state_jobs.filePath` row references. The shared
   * `formatFinding` helper emits no subject (the file IS the finding's
   * own node); the remediation hint moves to `Issue.fix.summary` below.
   */
  message: 'Orphan job file; not referenced by any job',
  /** Remediation hint surfaced via `Issue.fix.summary`. */
  fixSummary: 'Run `sm job prune --orphan-files` to remove it.',
} as const;
