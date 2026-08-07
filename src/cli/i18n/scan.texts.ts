/**
 * CLI strings emitted by `sm scan` and the `sm scan compare-with`
 * sub-verb (`cli/commands/scan.ts`, `cli/commands/scan-compare.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const SCAN_TEXTS = {
  // --- scan command ----------------------------------------------------
  /**
   * Per-flag rejection messages for `sm scan --watch` combos. The
   * watcher is incremental-only and always persists, so flags that
   * change those invariants are mutually exclusive with `--watch`.
   * Each entry follows the §3.1b two-line block (headline + dim hint)
   * so the user can act without re-reading `--help`.
   */
  watchVsNoBuiltIns:
    '{{glyph}}  --watch cannot be combined with --no-built-ins.\n' +
    '   {{hint}}\n',
  watchVsNoBuiltInsHint:
    'Drop --no-built-ins or use --watch alone. The watcher always persists, an empty pipeline has nothing to persist.',
  watchVsDryRun:
    '{{glyph}}  --watch cannot be combined with --dry-run.\n' +
    '   {{hint}}\n',
  watchVsDryRunHint:
    'Drop --dry-run or use --watch alone. The watcher always persists each incremental batch.',
  watchVsChanged:
    '{{glyph}}  --watch cannot be combined with --changed.\n' +
    '   {{hint}}\n',
  watchVsChangedHint:
    'Drop --changed or use --watch alone. The watcher is incremental by definition.',
  watchVsAllowEmpty:
    '{{glyph}}  --watch cannot be combined with --allow-empty.\n' +
    '   {{hint}}\n',
  watchVsAllowEmptyHint:
    'Drop --allow-empty or use --watch alone. The watcher never produces a zero-result wipe.',
  watchVsFull:
    '{{glyph}}  --watch cannot be combined with --full.\n' +
    '   {{hint}}\n',
  watchVsFullHint:
    'Drop --full or use --watch alone. The watcher is incremental by definition; run a one-shot `sm scan --full` first if you need a clean rebuild.',

  changedWithoutBuiltIns:
    '{{glyph}}  --changed and --no-built-ins cannot be combined.\n' +
    '   {{hint}}\n',
  changedWithoutBuiltInsHint:
    '--no-built-ins yields a zero-filled ScanResult, leaving nothing to merge against.',

  fullWithChanged:
    '{{glyph}}  --full and --changed cannot be combined.\n' +
    '   {{hint}}\n',
  fullWithChangedHint:
    '--changed is the explicit alias of the incremental default and --full forces a complete re-extraction; pick one.',

  scanFailure: '{{glyph}}  sm scan: {{message}}\n',

  guardWipeRefused:
    '{{glyph}}  Refusing to wipe a populated DB ({{existing}} rows in scan_*) with a zero-result scan.\n' +
    '   {{hint}}\n',
  guardWipeRefusedHint:
    'Pass --allow-empty to override. If this is unexpected, double-check the root paths.',

  jsonSelfValidationFailed:
    '{{glyph}}  sm scan: internal: scan-result failed self-validation: {{errors}}\n',

  /**
   * Header summary line. `glyph` is ✓ (green) on success or ✕ (red)
   * when error-severity issues fired; `counts` is the comma-separated
   * `N nodes · M links · K issues` block (issues count colored
   * yellow / red by the caller); `duration` is the dim `in <time>`
   * suffix; `rootsSuffix` is empty for a single root or
   * `  (<N> roots)` for multi-root scans.
   */
  scannedSummary: '  {{glyph}}  {{counts}}   {{duration}}{{rootsSuffix}}\n',
  /** Body line directly under the header, final DB path (dim). */
  persistedTo: '     {{dbPath}}\n',
  /** Body line for dry-run mode, same indent, marker tail. */
  wouldPersist: '     would persist to {{dbPath}}  (dry-run)\n',
  /**
   * Count-row nouns for the `{{counts}}` block in `scannedSummary`.
   * The caller selects the singular / plural form on `count === 1`
   * (English plural rule), so both forms live in the catalog instead of
   * being hand-suffixed with `s` at the call site (per the i18n
   * contract: catalog strings, no `${word}s` interpolation). `info` is
   * uncountable in English (no `infos`), so it carries a single form;
   * `countNoIssues` is the all-clean placeholder.
   */
  countNodeNounSingular: 'node',
  countNodeNounPlural: 'nodes',
  countLinkNounSingular: 'link',
  countLinkNounPlural: 'links',
  countErrorNounSingular: 'error',
  countErrorNounPlural: 'errors',
  countWarningNounSingular: 'warning',
  countWarningNounPlural: 'warnings',
  countInfoNoun: 'info',
  countNoIssues: '0 issues',
  /**
   * Truncation notice, printed when the walker stopped accepting files
   * because the walk ceiling `--max-scan` (or the `scan.maxScan`
   * setting) was reached and extra files were dropped. `{{glyph}}` is
   * the yellow warning glyph, `{{limit}}` the effective ceiling,
   * `{{source}}` either `--max-scan` or `scan.maxScan`. The hint names
   * both escape routes the user has: editing `.skillmapignore`
   * (preferred) or raising the ceiling with `--max-scan <N>`.
   */
  scanCappedNotice:
    '{{glyph}}  {{limit}} files reached ({{source}}), the recommended maximum; extra files were left out of the map.\n' +
    '     {{hint}}\n',
  scanCappedNoticeHint:
    'Having this many files is not recommended. Filter noisy folders with .skillmapignore (e.g. node_modules/, dist/, build/), or raise the limit with --max-scan <N>. Files past the limit are not scanned, analyzed, or reference-validated.',
  /**
   * Advisory (INFO, stderr) printed when the scanned corpus has more
   * nodes than the effective map render cap (`--max-nodes` or
   * `scan.maxNodes`). Benign: nothing is dropped, the full corpus is
   * still scanned and reference-validated, only the graph view paginates.
   * `{{glyph}}` is the cyan info glyph, `{{nodes}}` the corpus node count,
   * `{{cap}}` the effective render cap, `{{source}}` either `--max-nodes`
   * or `scan.maxNodes`, `{{hint}}` the dim lever line.
   */
  scanRenderCapNotice:
    '{{glyph}}  {{nodes}} nodes exceed the map render cap ({{cap}}, {{source}}); the map projects {{cap}} at a time.\n' +
    '     {{hint}}\n',
  scanRenderCapNoticeHint:
    'Nothing is dropped: the full corpus is scanned and reference-validated, only the graph view is capped. Raise it with --max-nodes <N>, or narrow by folder in the UI.',
  /**
   * File-size skip notice, printed (WARN, stderr) when the walker
   * skipped one or more files for exceeding `scan.maxFileSizeBytes`.
   * `{{glyph}}` is the yellow warning glyph, `{{count}}`/`{{noun}}` the
   * skipped-file tally, `{{files}}` the pre-rendered list of
   * `path (size)` rows, `{{hint}}` the dim escape-route line.
   */
  scanSkippedFilesNotice:
    '{{glyph}}  Skipped {{count}} {{noun}} over the size limit (scan.maxFileSizeBytes):\n' +
    '{{files}}' +
    '     {{hint}}\n',
  // The per-file `     - path (size)\n` rows that fill `{{files}}` are
  // rendered by `kernel/util/format-oversized.ts:formatOversizedFileRows`,
  // shared with `sm watch` / `sm serve` so the three surfaces never drift.
  scanSkippedFileNounSingular: 'file',
  scanSkippedFileNounPlural: 'files',
  scanSkippedFilesNoticeHint:
    'Raise scan.maxFileSizeBytes to include these, or add them to .skillmapignore to skip them on purpose.',
  /**
   * Validation message for an invalid `--max-scan` value. Surfaced as a
   * §3.1b two-line block.
   */
  maxScanInvalid:
    '{{glyph}}  --max-scan must be an integer >= 1 (got `{{value}}`).\n' +
    '   {{hint}}\n',
  maxScanInvalidHint:
    'Pass a positive integer, e.g. --max-scan 5000.',
  /**
   * Validation message for an invalid `--max-nodes` value. Surfaced as a
   * §3.1b two-line block.
   */
  maxNodesInvalid:
    '{{glyph}}  --max-nodes must be an integer >= 1 (got `{{value}}`).\n' +
    '   {{hint}}\n',
  maxNodesInvalidHint:
    'Pass a positive integer, e.g. --max-nodes 256.',

  // --- scan compare-with sub-verb --------------------------------------
  compareErrorPrefix: 'sm scan compare-with: {{message}}\n',

  compareDumpNotFound: 'dump file not found: {{path}}',

  compareDumpReadFailed: 'could not read dump file {{path}}: {{message}}',

  compareDumpInvalidJson: 'dump file is not valid JSON: {{message}}',

  compareDumpSchemaMismatch: 'dump does not conform to scan-result.schema.json: {{errors}}',

  // --- scan compare-with delta render (human-readable output) ----------
  /**
   * Header summary line. `glyph` is ✓ when the two snapshots match,
   * `~` (yellow) when there's any drift. The dim `vs <path>` tail
   * orients the user without dominating the eye.
   */
  compareDeltaSummary:
    '{{glyph}}  Delta {{comparedTag}}\n' +
    '     {{nodesLine}}\n' +
    '     {{linksLine}}\n' +
    '     {{issuesLine}}',
  compareDeltaComparedTag: 'vs {{comparedWith}}',
  /** Per-row breakdown templates, composed at the call site with mid-dot separators. */
  compareDeltaNodesLine: 'nodes:  {{added}} added · {{removed}} removed · {{changed}} changed',
  compareDeltaLinksLine: 'links:  {{added}} added · {{removed}} removed',
  compareDeltaIssuesLine: 'issues: {{added}} added · {{removed}} removed',

  compareDeltaNoDifferences: '{{glyph}}  (no differences)',

  compareDeltaNodesHeader: '## nodes',
  compareDeltaLinksHeader: '## links',
  compareDeltaIssuesHeader: '## issues',

  /** `+ <path> (<kind>)`, added node row. */
  compareDeltaNodeAdded: '+ {{path}} ({{kind}})',
  /** `- <path> (<kind>)`, removed node row. */
  compareDeltaNodeRemoved: '- {{path}} ({{kind}})',
  /** `~ <path> (<reason> changed)`, changed node row. */
  compareDeltaNodeChanged: '~ {{path}} ({{reason}} changed)',

  /** `+ <source> --<kind>--> <target>`, added link row. */
  compareDeltaLinkAdded: '+ {{source}} --{{kind}}--> {{target}}',
  /** `- <source> --<kind>--> <target>`, removed link row. */
  compareDeltaLinkRemoved: '- {{source}} --{{kind}}--> {{target}}',

  /** `+ [<severity>] <analyzerId>: <message>`, added issue row. */
  compareDeltaIssueAdded: '+ [{{severity}}] {{analyzerId}}: {{message}}',
  /** `- [<severity>] <analyzerId>: <message>`, removed issue row. */
  compareDeltaIssueRemoved: '- [{{severity}}] {{analyzerId}}: {{message}}',
} as const;
