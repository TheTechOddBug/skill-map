/**
 * Strings emitted from `core/runtime/scan-runner.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 *
 * Only the strings the runtime itself emits live here; the framing
 * messages around the runner outcome (success summaries, "Persisted to
 * <path>", `--json` self-validation failure, scan-failure prefix) live
 * in `cli/i18n/scan.texts.ts` because they belong to the CLI verb's
 * presentation layer.
 *
 * The watcher runtime keeps its own catalogue (`core/watcher/runtime.ts`
 * inline `RUNTIME_TEXTS`) — the strings are the same shape but the
 * surrounding context differs (a watcher tick vs a one-shot scan), so
 * sharing the catalogue would couple two runtimes that should remain
 * independent.
 */

export const SCAN_RUNNER_TEXTS = {
  /**
   * Emitted on stderr when the user passes `--changed` but no prior
   * snapshot exists in the DB. The runner falls back to a full scan.
   */
  changedNoPriorWarning: '--changed: no prior snapshot found; running full scan.\n',

  /**
   * Thrown as an `Error.message` when `--strict` is set and the
   * DB-resident prior `ScanResult` fails `scan-result.schema.json`
   * validation.
   */
  priorSchemaValidationFailed:
    'prior scan-result loaded from DB failed schema validation: {{errors}}. ' +
    'Run `sm db backup` then re-scan without --strict to rebuild from disk.',
} as const;
