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
    'sm refresh: --stale cannot be combined with a positional <node.path>.\n',

  noTargetSpecified:
    'sm refresh: pass <node.path> for a single-node refresh, or --stale to ' +
    'refresh every node with a stale enrichment row.\n',

  // --- node lookup ----------------------------------------------------------
  nodeNotFound:
    'sm refresh: node not found in the persisted scan: {{nodePath}}\n' +
    'Run `sm scan` first, then retry with the path as it appears in `sm list`.\n',

  // --- happy path -----------------------------------------------------------
  refreshingNode: 'Refreshing enrichments for {{nodePath}}\n',
  refreshingStale:
    'Refreshing {{count}} stale enrichment row(s) across {{nodeCount}} node(s).\n',

  refreshingStaleNone:
    'sm refresh --stale: no stale enrichment rows in the DB. Nothing to do.\n',

  // --- summary --------------------------------------------------------------
  detPersisted:
    'Persisted {{detCount}} enrichment row(s).\n',

  // --- failures -------------------------------------------------------------
  refreshFailed: 'sm refresh: {{message}}\n',

  /**
   * Sub-detail composed inside `refreshFailed` when the failure is a
   * filesystem read on a specific node body. Catalogued separately so the
   * "read failed for <path>: <err>" copy lives in the i18n surface, not
   * in a TS string template.
   */
  readFailedDetail: 'read failed for {{path}}: {{message}}',
} as const;
