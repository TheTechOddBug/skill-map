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

  /**
   * Honest disclosure when the scan surface expanded beyond the cwd
   * via `scan.extraFolders`. The list of paths makes it obvious which
   * extra folders the operator just opted into.
   */
  includingExtraFoldersAdvisory: 'Including extra folders: {{paths}}',
  /**
   * Reference-paths walker hit `REFERENCE_WALK_MAX_FILES` and stopped
   * early. The set may be incomplete for link validation; `core/broken-ref`
   * still works against whatever made it in.
   */
  referenceWalkTruncated:
    'scan.referencePaths: walker truncated at the 50000-file safety cap. ' +
    'Some link targets may flag as broken even though they exist on disk. ' +
    'Trim the configured paths to dirs you actually need to validate against.',
  /**
   * One configured `scan.referencePaths` entry resolved to a path that
   * does not exist on disk. Surfaced once per missing root so the
   * operator notices a typo without the walker silently swallowing it.
   */
  referenceWalkMissingRoot:
    'scan.referencePaths: configured path "{{path}}" does not exist; skipped.',
} as const;
