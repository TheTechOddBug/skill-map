/**
 * `GET /api/contributions/registered` and
 * `GET /api/contributions/:pluginId/:contributionId?path=...` —
 * Phase 3 of the View contribution system.
 *
 * The first endpoint is a pure projection of
 * `kernel.getRegisteredViewContributions()` — the runtime catalog
 * populated once by `registerEnabledExtensions` after every plugin
 * loads, frozen, never mutated. Mirrors `routes/annotations.ts` for
 * the parallel annotation-contributions surface.
 *
 * The second endpoint is the lazy per-node lookup the UI's slot host
 * uses when a user opens an inspector for a node that wasn't part of
 * the bulk page slice (or when the bulk endpoint omitted contributions
 * because `limit > bff.maxBulkContributions`). The route enforces
 * `pluginId` ↔ namespace at the URL level: a request for
 * `/api/contributions/:pluginId/:contributionId` receives ONLY rows
 * whose `plugin_id` matches the URL segment. No cross-plugin reads.
 *
 * Cold-start posture: when `scan_contributions` is missing (fresh DB
 * before first scan, or migration not yet applied), the catalog
 * endpoint returns `{ items: [], counts: { total: 0 } }` and the
 * lookup endpoint returns 404. Mirror of the `tryWithSqlite`
 * graceful-null pattern used elsewhere in the BFF.
 */

import type { Hono } from 'hono';

import type { Kernel, IRegisteredViewContribution } from '../../kernel/index.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import type { IRouteDeps } from './deps.js';

/**
 * REST envelope `kind` discriminator. Listed in
 * `rest-envelope.schema.json#/properties/kind/enum`. New variant
 * landed alongside the View contribution system.
 */
const REGISTERED_ENVELOPE_KIND = 'contributions.registered' as const;

export interface IContributionsRegisteredEnvelope {
  schemaVersion: '1';
  kind: typeof REGISTERED_ENVELOPE_KIND;
  items: IRegisteredViewContribution[];
  counts: { total: number };
}

/**
 * Wire shape returned per match by the lazy lookup endpoint. Keeps
 * the shape close to `IPersistedContribution` from the storage layer
 * but excludes `emittedAt` (UI does not need it for rendering;
 * cache-busting happens via the SSE refresh signal). The UI's slot
 * host parses `payload` against the contract's payload schema (it
 * already trusts the wire since AJV ran at emit time, but defence
 * in depth keeps the UI honest).
 */
export interface IContributionLookupItem {
  pluginId: string;
  extensionId: string;
  nodePath: string;
  contributionId: string;
  contract: string;
  payload: unknown;
}

export interface IContributionsLookupEnvelope {
  schemaVersion: '1';
  kind: 'contributions.lookup';
  items: IContributionLookupItem[];
  counts: { total: number };
}

export interface IContributionsRouteDeps extends IRouteDeps {
  kernel: Kernel;
}

export function registerContributionsRoutes(
  app: Hono,
  deps: IContributionsRouteDeps,
): void {
  // 1. Catalog projection — mirror of `/api/annotations/registered`.
  app.get('/api/contributions/registered', (c) => {
    // Copy the frozen catalog into a fresh array so a downstream
    // response transformer cannot mutate the kernel's frozen view.
    const items = [...deps.kernel.getRegisteredViewContributions()];
    const envelope: IContributionsRegisteredEnvelope = {
      schemaVersion: '1',
      kind: REGISTERED_ENVELOPE_KIND,
      items,
      counts: { total: items.length },
    };
    return c.json(envelope);
  });

  // 2. Lazy per-node lookup. URL shape mirrors the qualified id
  //    `<pluginId>/<extensionId>/<contributionId>` — three path
  //    segments. Filters by qualified id + node path.
  app.get('/api/contributions/:pluginId/:extensionId/:contributionId', async (c) => {
    const pluginId = c.req.param('pluginId');
    const extensionId = c.req.param('extensionId');
    const contributionId = c.req.param('contributionId');
    const nodePath = c.req.query('path');
    if (typeof nodePath !== 'string' || nodePath.length === 0) {
      return c.json(
        { error: 'missing-path', message: 'Required query parameter: path' },
        400,
      );
    }

    // The catalog gives us the qualified id → contract mapping. If the
    // catalog has no matching entry, the URL triple is unknown — reject
    // without touching the DB.
    const catalogEntry = deps.kernel
      .getRegisteredViewContributions()
      .find(
        (e) =>
          e.pluginId === pluginId &&
          e.extensionId === extensionId &&
          e.contributionId === contributionId,
      );
    if (!catalogEntry) {
      return c.json(
        {
          error: 'unknown-contribution',
          message: `No registered contribution: ${pluginId}/${extensionId}/${contributionId}`,
        },
        404,
      );
    }

    const rows =
      (await tryWithSqlite(
        { databasePath: deps.options.dbPath, autoBackup: false },
        (adapter) =>
          adapter.contributions.lookup(pluginId, contributionId, nodePath, extensionId),
      )) ?? [];

    const items: IContributionLookupItem[] = rows.map((r) => ({
      pluginId: r.pluginId,
      extensionId: r.extensionId,
      nodePath: r.nodePath,
      contributionId: r.contributionId,
      contract: r.contract,
      payload: r.payload,
    }));

    const envelope: IContributionsLookupEnvelope = {
      schemaVersion: '1',
      kind: 'contributions.lookup',
      items,
      counts: { total: items.length },
    };
    return c.json(envelope);
  });
}
