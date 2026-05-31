/**
 * CLI strings emitted by `sm watch` (alias `sm scan --watch`),
 * `cli/commands/watch.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const WATCH_TEXTS = {
  configLoadFailure: '{{glyph}}  sm watch: {{message}}\n',

  initialScanFailed: '{{glyph}}  sm watch: initial scan failed: {{message}}\n',

  batchFailed: '{{glyph}}  sm watch: batch failed: {{message}}\n',

  scanFailed: '{{glyph}}  sm watch: scan failed: {{message}}\n',

  watcherError: '{{glyph}}  sm watch: watcher error: {{message}}\n',

  starting: 'sm watch: starting on {{rootsCount}} root(s), debounce {{debounceMs}}ms\n',

  ready: 'sm watch: ready. Press Ctrl+C to stop.\n',

  stopped: 'sm watch: stopped after {{batchCount}} batch(es).\n',

  scannedSummary:
    '{{glyph}}  {{nodes}} {{nodesNoun}} · {{links}} {{linksNoun}} · {{issues}} {{issuesNoun}}   {{durationTag}}\n',
  scannedNounNodeSingular: 'node',
  scannedNounNodePlural: 'nodes',
  scannedNounLinkSingular: 'link',
  scannedNounLinkPlural: 'links',
  scannedNounIssueSingular: 'issue',
  scannedNounIssuePlural: 'issues',
  scannedDurationTag: 'in {{ms}}ms',

  priorSchemaValidationFailed:
    'prior scan-result loaded from DB failed schema validation: {{errors}}',

  breakerTripped:
    '{{glyph}}  sm watch: {{count}} consecutive batch failures, shutting down.\n' +
    '   {{hint}}\n',
  breakerTrippedHint: 'Last error: {{message}}',

  /**
   * §3.1b two-line block. Numeric-flag rejection; hint names the
   * accepted shape so the operator can re-run without `--help`.
   */
  maxConsecutiveFailuresInvalid:
    '{{glyph}}  sm watch: --max-consecutive-failures must be a non-negative integer (got {{raw}}).\n' +
    '   {{hint}}\n',
  maxConsecutiveFailuresInvalidHint:
    'Pass an integer >= 0 (0 disables the circuit-breaker; the default is 5).',

  /**
   * §3.1b two-line block. Validation rejection for `--max-nodes`.
   */
  maxNodesInvalid:
    '{{glyph}}  sm watch: --max-nodes must be an integer >= 1 (got {{raw}}).\n' +
    '   {{hint}}\n',
  maxNodesInvalidHint:
    'Pass a positive integer, e.g. --max-nodes 256.',

  /**
   * File-size skip WARN, emitted per batch (stderr) when the walker
   * skipped one or more files for exceeding `scan.maxFileSizeBytes`.
   * Mirrors `sm scan`'s notice. `{{files}}` is the pre-rendered list of
   * `path (size)` rows.
   */
  skippedFilesNotice:
    '{{glyph}}  Skipped {{count}} {{noun}} over the size limit (scan.maxFileSizeBytes):\n' +
    '{{files}}' +
    '     {{hint}}\n',
  // The per-file `     - path (size)\n` rows that fill `{{files}}` are
  // rendered by `kernel/util/format-oversized.ts:formatOversizedFileRows`,
  // shared with `sm scan` / `sm serve` so the three surfaces never drift.
  skippedFileNounSingular: 'file',
  skippedFileNounPlural: 'files',
  skippedFilesNoticeHint:
    'Raise scan.maxFileSizeBytes to include these, or add them to .skillmapignore to skip them on purpose.',
} as const;
