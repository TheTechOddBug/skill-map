/**
 * CLI strings emitted by `sm refresh` and `sm refresh --stale`
 * (`cli/commands/refresh.ts`).
 *
 * `sm refresh` is the granular companion to the universal enrichment
 * layer (spec § A.8). It re-runs Extractors against a single node (or
 * the set of nodes carrying at least one stale enrichment row) so the
 * kernel-curated overlay refreshes against the current body. Extractors
 * are deterministic-only, so they always run for real and persist;
 * `--stale` is a no-op in this revision (no row is stale-flagged) and
 * is reserved for the future Action-issued probabilistic enrichment
 * revision.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const REFRESH_TEXTS = {
  // --- argument validation --------------------------------------------------
  nodeAndStaleMutex:
    '{{glyph}}  --stale cannot be combined with a positional <node.path>.\n',

  noTargetSpecified:
    '{{glyph}}  Pass <node.path> for a single-node refresh, or --stale\n' +
    '   to refresh every node with a stale enrichment row.\n',

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
