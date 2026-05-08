/**
 * CLI strings emitted by `sm scan` and the `sm scan compare-with`
 * sub-verb (`cli/commands/scan.ts`, `cli/commands/scan-compare.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const SCAN_TEXTS = {
  // --- scan command ----------------------------------------------------
  watchCannotCombine:
    '--watch cannot be combined with --no-built-ins, --dry-run, --changed, or --allow-empty.\n',

  changedWithoutBuiltIns:
    '--changed and --no-built-ins cannot be combined: --no-built-ins yields a zero-filled ScanResult, leaving nothing to merge against.\n',

  scanFailure: 'sm scan: {{message}}\n',

  guardWipeRefused:
    'sm scan: refusing to wipe a populated DB ({{existing}} rows in scan_*) ' +
    'with a zero-result scan. Pass --allow-empty to override. ' +
    'If this is unexpected, double-check the root paths.\n',

  jsonSelfValidationFailed:
    'sm scan: internal — scan-result failed self-validation: {{errors}}\n',

  /**
   * Header summary line. `glyph` is ✓ (green) on success or ✕ (red)
   * when error-severity issues fired; `counts` is the comma-separated
   * `N nodes · M links · K issues` block (issues count colored
   * yellow / red by the caller); `duration` is the dim `in <time>`
   * suffix; `rootsSuffix` is empty for a single root or
   * `  (<N> roots)` for multi-root scans.
   */
  scannedSummary: '  {{glyph}}  {{counts}}   {{duration}}{{rootsSuffix}}\n',
  /** Body line directly under the header — final DB path (dim). */
  persistedTo: '     {{dbPath}}\n',
  /** Body line for dry-run mode — same indent, marker tail. */
  wouldPersist: '     would persist to {{dbPath}}  (dry-run)\n',

  // --- scan compare-with sub-verb --------------------------------------
  compareErrorPrefix: 'sm scan compare-with: {{message}}\n',

  compareDumpNotFound: 'dump file not found: {{path}}',

  compareDumpReadFailed: 'could not read dump file {{path}}: {{message}}',

  compareDumpInvalidJson: 'dump file is not valid JSON: {{message}}',

  compareDumpSchemaMismatch: 'dump does not conform to scan-result.schema.json: {{errors}}',

  // --- scan compare-with delta render (human-readable output) ----------
  compareDeltaSummary:
    'Delta vs {{comparedWith}}: ' +
    '{{nodesAdded}} nodes added, {{nodesRemoved}} removed, {{nodesChanged}} changed; ' +
    '{{linksAdded}} links added, {{linksRemoved}} removed; ' +
    '{{issuesAdded}} issues added, {{issuesRemoved}} removed.',

  compareDeltaNoDifferences: '(no differences)',

  compareDeltaNodesHeader: '## nodes',
  compareDeltaLinksHeader: '## links',
  compareDeltaIssuesHeader: '## issues',

  /** `+ <path> (<kind>)` — added node row. */
  compareDeltaNodeAdded: '+ {{path}} ({{kind}})',
  /** `- <path> (<kind>)` — removed node row. */
  compareDeltaNodeRemoved: '- {{path}} ({{kind}})',
  /** `~ <path> (<reason> changed)` — changed node row. */
  compareDeltaNodeChanged: '~ {{path}} ({{reason}} changed)',

  /** `+ <source> --<kind>--> <target>` — added link row. */
  compareDeltaLinkAdded: '+ {{source}} --{{kind}}--> {{target}}',
  /** `- <source> --<kind>--> <target>` — removed link row. */
  compareDeltaLinkRemoved: '- {{source}} --{{kind}}--> {{target}}',

  /** `+ [<severity>] <ruleId>: <message>` — added issue row. */
  compareDeltaIssueAdded: '+ [{{severity}}] {{ruleId}}: {{message}}',
  /** `- [<severity>] <ruleId>: <message>` — removed issue row. */
  compareDeltaIssueRemoved: '- [{{severity}}] {{ruleId}}: {{message}}',
} as const;
