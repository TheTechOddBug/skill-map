/**
 * User-facing strings emitted by the `job-orphan-file` built-in rule
 * (`plugins/core/analyzers/job-orphan-file/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const JOB_ORPHAN_FILE_TEXTS = {
  /**
   * `<path>.md` lives under `.skill-map/jobs/` but no `state_jobs.filePath`
   * row references it. Run `sm job prune --orphan-files` to remove.
   */
  message:
    'Orphan job file: {{filePath}} is not referenced by any state_jobs row. Run `sm job prune --orphan-files` to remove it.',
} as const;
