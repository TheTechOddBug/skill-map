/**
 * CLI strings emitted by `sm init`, `cli/commands/init.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 *
 * Where the live mode would render plural-vs-singular text (e.g.
 * "1 entry" / "N entries"), we keep TWO templates and let the caller
 * pick. Conditional logic does not live inside the template.
 */

export const INIT_TEXTS = {
  alreadyInitialised:
    '{{glyph}}  sm init: {{settingsPath}} already exists.\n' +
    '   {{hint}}\n',
  alreadyInitialisedHint: 'Pass --force to overwrite.',

  /**
   * The scope ignore file (`.skill-map/.gitignore`) covering the
   * generated artifacts. One template for both the created and the
   * topped-up branch: the operator cares that the file now covers the
   * N generated artifacts, not which of the two paths got them there.
   */
  scopeGitignoreWritten:
    '{{glyph}}  Wrote {{path}} ({{count}} generated artifacts kept out of git)\n',

  initialised: '{{glyph}}  Initialised {{skillMapDir}}\n',

  /**
   * Emitted under `--force` when a prior DB exists and we wipe it before
   * provisioning the fresh one. Matches the greenfield posture: --force
   * means "reset every project artefact" (settings + DB), so the first
   * scan never inherits stale rows from a pre-current schema.
   */
  removedPriorDb: '{{glyph}}  Removed prior DB at {{path}} (--force reset)\n',

  runningFirstScan: '\nRunning first scan...\n',

  configLoadFailure: '{{glyph}}  sm init: {{message}}\n',

  scanFailed: '{{glyph}}  sm init: scan failed: {{message}}\n',


  // --- dry-run previews --------------------------------------------------
  dryRunHeader: '(dry-run, no files written, no DB provisioned)\n',
  dryRunWouldCreateDir: 'would create   {{path}}/\n',
  dryRunWouldWriteFile: 'would write    {{path}}\n',
  dryRunWouldOverwriteFile: 'would overwrite {{path}}\n',
  dryRunWouldWriteScopeGitignore:
    'would write    {{path}} ({{count}} generated artifacts)\n',
  dryRunWouldLeaveScopeGitignoreUnchanged:
    'would leave    {{path}} unchanged (entries already present)\n',
  dryRunWouldTopUpScopeGitignore:
    'would update   {{path}} (add {{count}}: {{entries}})\n',
  dryRunWouldProvisionDb:
    'would provision DB at {{path}} (apply pending migrations)\n',
  dryRunWouldRunFirstScan: 'would run first scan (no persistence in dry-run)\n',
  dryRunWouldSkipFirstScan: 'would skip first scan (--no-scan)\n',
} as const;
