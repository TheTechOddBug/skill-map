/**
 * `GET /api/nodes/:pathB64/findings`, the per-node judgment tray
 * (Step 16 piece 1, `spec/cli-contract.md` §Serve route table).
 *
 * Mirrors the `sm findings -n <path>` view semantics 1:1 through the
 * SHARED kernel helper (`kernel/jobs/findings-view.ts`, single source):
 *
 *   - DEFAULT view: the needs-attention rows (open + non-stale
 *     `human-decision`), with the excluded-count honesty triple
 *     (`counts.dismissedExcluded` / `counts.fixedExcluded` /
 *     `counts.staleExcluded`) reporting what the default view held back
 *     under the same filters. Dismissed rows (their class matches an
 *     active sidecar suppression, read from the write-through
 *     `scan_nodes.annotations_json` mirror) hide with top precedence.
 *   - `?dismissed=1` / `?fixed=1` / `?stale=1` are bucket FILTERS (only
 *     that bucket, together their union), mirroring the CLI flags; under
 *     an explicit bucket filter every excluded count is 0.
 *
 * Wire shape: the `kind: 'findings'` list variant of
 * `rest-envelope.schema.json`. Each item is one `state_findings` row
 * projection (the `sm findings --json` row shape plus the derived
 * `stale` boolean); the internal `bodyHashAtGeneration` is NOT exposed.
 *
 * 404 rules: malformed `pathB64`, unknown node, and missing DB all
 * answer 404 `not-found` (the resource isn't there, uniformly).
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import {
  countDismissedHidden,
  countFixedHidden,
  countStaleHidden,
  isFindingSuppressed,
  partitionFindingsView,
  type IFindingsBucketFlags,
  type ISuppressionEntry,
  type TFindingSuppressedTest,
} from '../../kernel/jobs/index.js';
import type { IFindingRecord } from '../../kernel/types/storage.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { buildListEnvelope } from '../envelope.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { bffReadVersionCheck } from '../util/db-read-check.js';
import type { IRouteDeps } from './deps.js';
import { decodePathB64Or404 } from './node-loader.js';

/**
 * One wire finding row: the stored record minus the internal
 * `bodyHashAtGeneration` stamp (`rest-envelope.schema.json` locks the
 * item shape with `additionalProperties: false`).
 */
export type TFindingWireRow = Omit<IFindingRecord, 'bodyHashAtGeneration'>;

/** Project a stored row onto the wire shape (drop the internal stamp). */
function toWireRow(finding: IFindingRecord): TFindingWireRow {
  const { bodyHashAtGeneration: _internal, ...wire } = finding;
  return wire;
}

/** `?dismissed=1` / `?fixed=1` / `?stale=1` bucket flags (mirrors `?fresh=1`). */
function parseBucketFlags(query: (name: string) => string | undefined): IFindingsBucketFlags {
  return {
    dismissed: query('dismissed') === '1',
    fixed: query('fixed') === '1',
    stale: query('stale') === '1',
  };
}

export function registerNodeFindingsRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/nodes/:pathB64/findings', async (c) => {
    const nodePath = decodePathB64Or404(c.req.param('pathB64'));
    const flags = parseBucketFlags((name) => c.req.query(name));

    // ONE read-posture open for the node-existence check, the findings
    // rows, and the node's suppressions (the read-time dismissal lens,
    // sourced from the write-through `scan_nodes.annotations_json` mirror,
    // zero file reads). `includeStale: true` because the adapter hides
    // stale rows by default and the shared view helper partitions them.
    const loaded = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
      async (adapter) => {
        const bundle = await adapter.scans.findNode(nodePath);
        if (!bundle) return null;
        return {
          rows: await adapter.findings.list({ nodeId: nodePath, includeStale: true }),
          suppressions:
            (await adapter.findings.suppressionsByPath([nodePath])).get(nodePath) ??
            ([] as ISuppressionEntry[]),
        };
      },
    );
    // Missing DB (tryWithSqlite -> null) and unknown node collapse to the
    // same 404, per the route-table contract.
    if (loaded === null) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.nodeNotFound, { path: sanitizeForTerminal(nodePath) }),
      });
    }

    const isSuppressed: TFindingSuppressedTest = (f) =>
      isFindingSuppressed(f.extensionId, f.type, loaded.suppressions);
    const { shown, hidden } = partitionFindingsView(loaded.rows, flags, isSuppressed);
    return c.json(
      buildListEnvelope<TFindingWireRow>({
        kind: 'findings',
        items: shown.map(toWireRow),
        filters: { dismissed: flags.dismissed, fixed: flags.fixed, stale: flags.stale },
        // No pagination on this endpoint: `total` keeps the `sm findings
        // --json` meaning (the returned rows), like the CLI's `total`.
        total: shown.length,
        excluded: {
          dismissedExcluded: countDismissedHidden(hidden, isSuppressed),
          fixedExcluded: countFixedHidden(hidden, isSuppressed),
          staleExcluded: countStaleHidden(hidden, isSuppressed),
        },
        kindRegistry: deps.kindRegistry,
        providerRegistry: deps.providerRegistry,
        contributionsRegistry: deps.contributionsRegistry,
      }),
    );
  });
}
