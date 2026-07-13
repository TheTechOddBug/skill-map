/**
 * CLI strings emitted by `sm refresh` and `sm refresh --stale`
 * (`cli/commands/refresh.ts`).
 *
 * `sm refresh` is the granular companion to the enrichment layer
 * (spec § A.8). It re-runs Extractors against a single node (or the
 * set of nodes carrying at least one stale enrichment row) so the
 * kernel-curated overlay refreshes against the current body, THEN
 * executes every enabled enrichment Action (Model A, e.g. the
 * provenance verifier `github/enrichment`) against the node, upserting
 * validated reports into `state_enrichments`. Network-declaring
 * Actions are gated by the committed `allowNetworkActions` project
 * policy (default off → skipped with a directed advisory).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const REFRESH_TEXTS = {
  // --- argument validation --------------------------------------------------
  /**
   * §3.1b two-line block. Mutex between the positional <node.path> and
   * the `--stale` batch flag; hint names the two valid invocations.
   */
  nodeAndStaleMutex:
    '{{glyph}}  --stale cannot be combined with a positional <node.path>.\n' +
    '   {{hint}}\n',
  nodeAndStaleMutexHint:
    'Run `sm refresh <node.path>` for a single refresh, or `sm refresh --stale` to refresh every node with a stale row.',

  /**
   * §3.1b two-line block. Headline names the missing input on one
   * sentence-cased line; the hint enumerates the two valid invocations.
   */
  noTargetSpecified:
    '{{glyph}}  Pass <node.path> for a single-node refresh, or --stale for batch mode.\n' +
    '   {{hint}}\n',
  noTargetSpecifiedHint:
    'Examples: `sm refresh path/to/node.md` (single), `sm refresh --stale` (every stale enrichment row).',

  // --- node lookup ----------------------------------------------------------
  /**
   * Two-line shape: ✕ glyph + headline on the first line, dim hint on
   * the second. Glyph and indent are wrapped in color at the call site.
   */
  nodeNotFound:
    '{{glyph}}  Node not found: {{nodePath}}\n' +
    '   {{hint}}\n',
  nodeNotFoundHint:
    'Run `sm scan` first, then retry with the path as it appears in `sm list`.',

  // --- happy path -----------------------------------------------------------
  /** Success line for `sm refresh <node.path>`. */
  refreshSuccessSingle:
    '{{glyph}}  {{count}} enrichment {{noun}} from {{nodePath}}\n',
  /** Success line for `sm refresh --stale` over a non-empty stale set. */
  refreshSuccessStale:
    '{{glyph}}  {{count}} enrichment {{noun}} across {{nodeCount}} {{nodeNoun}}\n',
  /** Success line for `sm refresh --stale` when no row is stale. */
  refreshSuccessNoStale: '{{glyph}}  No stale enrichment rows.\n',

  refreshNounSingular: 'row',
  refreshNounPlural: 'rows',
  refreshNodeNounSingular: 'node',
  refreshNodeNounPlural: 'nodes',

  // --- enrichment Actions (Model A) -----------------------------------------
  /**
   * §3.1b two-line advisory (exit stays 0): an enabled Action declares
   * `io: ['network']` but the committed `allowNetworkActions` project
   * policy is off, so the execution is refused. Emitted once per
   * skipped action, naming the config key in the hint.
   */
  networkActionsPolicySkip:
    '{{glyph}}  Skipped {{actionId}}: network actions are disabled in this project.\n' +
    '   {{hint}}\n',
  networkActionsPolicySkipHint:
    'Set `allowNetworkActions` to true in .skill-map/settings.json (committed project policy) to let it run.',

  /**
   * Warn advisory: an enrichment Action's `invoke()` threw. Remote
   * failures are reports by contract, so a throw is an action defect;
   * the refresh keeps going (no row, no execution) and exits 0.
   */
  enricherInvokeFailed:
    '{{glyph}}  {{actionId}} failed for {{nodePath}}: {{message}}\n',

  /**
   * Warn advisory: the Action's returned report failed validation
   * against its own report schema. A failed execution row is recorded
   * (`report-invalid`, mirroring the record path); no state row lands.
   */
  enricherReportInvalid:
    '{{glyph}}  {{actionId}} report rejected for {{nodePath}}: {{errors}}\n',

  // --- failures -------------------------------------------------------------
  refreshFailed: '{{glyph}}  sm refresh: {{message}}\n',

  /**
   * Error-envelope `message` body for `--json` failures. Used as the
   * `error.message` value when the verb cannot locate the project DB
   * (the `--json` consumer cannot rely on the human glyph + hint).
   */
  jsonErrorDbMissing:
    'Project database not found. Run `sm init` before `sm refresh`.',
  jsonErrorNodeNotFound: 'Node not found: {{nodePath}}',

  /**
   * Sub-detail composed inside `refreshFailed` when the failure is a
   * filesystem read on a specific node body. Catalogued separately so the
   * "read failed for <path>: <err>" copy lives in the i18n surface, not
   * in a TS string template.
   */
  readFailedDetail: 'read failed for {{path}}: {{message}}',
} as const;
