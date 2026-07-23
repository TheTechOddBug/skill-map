/**
 * `GET /api/contributions/registered` and
 * `GET /api/contributions/:pluginId/:contributionId?path=...`,
 * Phase 3 of the View contribution system.
 *
 * The first endpoint is a pure projection of
 * `kernel.getRegisteredViewContributions()`, the runtime catalog
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
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import type { Kernel, IRegisteredViewContribution } from '../../kernel/index.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { bffReadVersionCheck } from '../util/db-read-check.js';
import { tx } from '../../kernel/util/tx.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { parseRequiredString } from '../util/parse-query.js';
import type { IRouteDeps } from './deps.js';

/**
 * Qualified-id alphabet, mirror of how the kernel composes
 * `<pluginId>/<extensionId>/<contributionId>` keys. Restricting each
 * URL segment to this set BEFORE the kernel lookup rejects slashes,
 * spaces, ANSI escapes, and other control bytes at the edge of the
 * BFF so the catalog query and the error message both stay clean.
 */
const QUALIFIED_ID_SEGMENT = /^[A-Za-z0-9._-]+$/;

function parseQualifiedIdSegment(value: string, name: string): string {
  if (!QUALIFIED_ID_SEGMENT.test(value)) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.qualifiedIdMalformed, {
        name,
        value: sanitizeForTerminal(value),
      }),
    });
  }
  return value;
}

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
 * host parses `payload` against the slot's payload schema (it
 * already trusts the wire since AJV ran at emit time, but defence
 * in depth keeps the UI honest).
 */
export interface IContributionLookupItem {
  pluginId: string;
  extensionId: string;
  nodePath: string;
  contributionId: string;
  slot: string;
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
  // 1. Catalog projection, mirror of `/api/annotations/registered`.
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
  //    `<pluginId>/<extensionId>/<contributionId>`, three path
  //    segments. Filters by qualified id + node path.
  app.get('/api/contributions/:pluginId/:extensionId/:contributionId', async (c) => {
    // M2, validate every URL segment against the qualified-id alphabet
    // BEFORE the kernel lookup. A segment containing a slash, control
    // char, or ANSI escape rejects with 400 and never reaches storage.
    const pluginId = parseQualifiedIdSegment(c.req.param('pluginId'), 'pluginId');
    const extensionId = parseQualifiedIdSegment(c.req.param('extensionId'), 'extensionId');
    const contributionId = parseQualifiedIdSegment(c.req.param('contributionId'), 'contributionId');
    const nodePath = parseRequiredString(c.req.query('path'), 'path');

    // The catalog gives us the qualified id → slot mapping. If the
    // catalog has no matching entry, the URL triple is unknown, reject
    // without touching the DB. Audit L5, URL params are decoded by
    // Hono before reaching here; wrap each segment through
    // `sanitizeForTerminal` before interpolating into the error message
    // so a request with ANSI escapes (rejected by the segment validator
    // above anyway, but kept defensively) cannot repaint a terminal
    // viewing the BFF's stderr-mirrored error log.
    const catalogEntry = deps.kernel
      .getRegisteredViewContributions()
      .find(
        (e) =>
          e.pluginId === pluginId &&
          e.extensionId === extensionId &&
          e.contributionId === contributionId,
      );
    if (!catalogEntry) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.contributionUnknown, {
          pluginId: sanitizeForTerminal(pluginId),
          extensionId: sanitizeForTerminal(extensionId),
          contributionId: sanitizeForTerminal(contributionId),
        }),
      });
    }

    const rows =
      (await tryWithSqlite(
        { databasePath: deps.options.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
        (adapter) =>
          adapter.contributions.lookup(pluginId, contributionId, nodePath, extensionId),
      )) ?? [];

    const items: IContributionLookupItem[] = rows.map((r) => ({
      pluginId: r.pluginId,
      extensionId: r.extensionId,
      nodePath: r.nodePath,
      contributionId: r.contributionId,
      slot: r.slot,
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
