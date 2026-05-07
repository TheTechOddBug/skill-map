/**
 * `GET /api/nodes` — paginated, filtered list of persisted nodes.
 * `GET /api/nodes/:pathB64` — single-node detail bundle (mirrors `sm show --json`).
 *
 * **List filtering** funnels through `urlParamsToExportQuery` →
 * `applyExportQuery`, which means `/api/nodes` and `sm export` share
 * one filter grammar. The `hasIssues=false` post-filter handles the
 * one case the kernel grammar can't express (negation).
 *
 * **Pagination** applies only to the list route. Defaults: `offset=0`,
 * `limit=100`. `limit > 1000` rejects with `bad-query` (caps the cost
 * of a single response). `/api/links` and `/api/issues` do NOT
 * paginate at 14.2 — typical scopes have at most a few hundred rows.
 *
 * **Single route** uses base64url-encoded `node.path` as the route
 * param. Malformed pathB64 → `not-found` (treating it as "no such
 * node" is gentler than yelling "bad input"). Missing node → same.
 *
 * **Single route response shape** (Step 14.5.a — locked):
 *
 *   ```
 *   {
 *     schemaVersion: '1',
 *     kind: 'node',
 *     item: Node,                                  // (+ optional `body`)
 *     links: { incoming: Link[], outgoing: Link[] },
 *     issues: Issue[]
 *   }
 *   ```
 *
 *   Pre-14.5.a the handler emitted `{ item: { node, linksOut, linksIn,
 *   issues } }` — the `INodeBundle` shape passed straight through. No
 *   prod consumer ever ran against it (the SPA's `INodeDetailApi`
 *   model already declared the new shape, and the only `getNode`
 *   call sites today are tests and the `StaticDataSource` which
 *   already produces the new shape). The 14.5.a flip is therefore a
 *   bug fix, not a breaking change for any deployed surface.
 *
 * **`?include=body` (Step 14.5.a)** — opt-in flag that adds `item.body`
 * to the response. The body is read from disk on demand (the kernel
 * persists `body_hash` only — see `node-body.ts` for the rationale).
 * Without the flag the handler never touches the filesystem; with it,
 * `body` is the post-frontmatter content as a UTF-8 string, or `null`
 * when the file is missing / unreadable. The Inspector view passes the
 * flag; the auto-rename UI and other future single-node consumers can
 * skip it.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { applyExportQuery } from '../../kernel/index.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { tx } from '../../kernel/util/tx.js';
import { buildListEnvelope, REST_ENVELOPE_SCHEMA_VERSION } from '../envelope.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { readNodeBody } from '../node-body.js';
import { decodeNodePath, PathCodecError } from '../path-codec.js';
import {
  filterNodesWithoutIssues,
  urlParamsToExportQuery,
} from '../query-adapter.js';
import { parseCsv, parsePagination } from '../util/parse-query.js';
import type { IRouteDeps } from './deps.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export function registerNodesRoutes(app: Hono, deps: IRouteDeps): void {
  // Single-node route registered FIRST so the `:pathB64` segment doesn't
  // get shadowed by the literal `/api/nodes` prefix.
  // Complexity (9) comes from the four exit branches the route models
  // (path decode error, DB-missing/null bundle, body include, decorated
  // happy path) plus the `try/catch` around the codec. Each branch is a
  // direct return; an extracted helper would just push the discriminator
  // out one level and obscure the request lifecycle.
  // eslint-disable-next-line complexity
  app.get('/api/nodes/:pathB64', async (c) => {
    const pathB64 = c.req.param('pathB64');
    let nodePath: string;
    try {
      nodePath = decodeNodePath(pathB64);
    } catch (err) {
      // Malformed pathB64 surfaces as 404 — from the client's view there's
      // no such node either way. The thrown error message is logged via
      // `formatErrorMessage` in `app.onError`.
      if (err instanceof PathCodecError) {
        throw new HTTPException(404, { message: SERVER_TEXTS.pathB64Malformed });
      }
      throw err;
    }
    const result = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      async (adapter) => {
        const b = await adapter.scans.findNode(nodePath);
        if (!b) return { bundle: null, isFavorite: false } as const;
        const favSet = await adapter.favorites.listPaths();
        return { bundle: b, isFavorite: favSet.has(b.node.path) } as const;
      },
    );
    const bundle = result?.bundle ?? null;
    const isFavorite = result?.isFavorite ?? false;
    if (!bundle) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.nodeNotFound, { path: nodePath }),
      });
    }
    const decoratedNode = { ...bundle.node, isFavorite };
    const includes = parseIncludes(c.req.query('include'));
    const item = includes.has('body')
      ? { ...decoratedNode, body: await readNodeBody(deps.runtimeContext.cwd, nodePath) }
      : decoratedNode;
    return c.json({
      schemaVersion: REST_ENVELOPE_SCHEMA_VERSION,
      kind: 'node' as const,
      item,
      links: { incoming: bundle.linksIn, outgoing: bundle.linksOut },
      issues: bundle.issues,
      kindRegistry: deps.kindRegistry,
    });
  });

  // Complexity (9) comes from the export-query parsing, pagination
  // parsing, parallel DB load (scan + favorites set), `hasIssues=false`
  // post-filter, page-slice + isFavorite decoration, envelope build.
  // Each step is a contiguous data transform; extracting helpers would
  // splay the request shape across multiple files.
  // eslint-disable-next-line complexity
  app.get('/api/nodes', async (c) => {
    // `urlParamsToExportQuery` consumes `URLSearchParams` because the
    // CLI export grammar already speaks that shape (`sm export
    // --filter=...`). Stay on the `URLSearchParams` view for the
    // export-query parsing; the simpler scalars (offset, limit,
    // include) read through `c.req.query(...)` per L5.
    const params = new URL(c.req.url).searchParams;
    const { query, filters } = urlParamsToExportQuery(params);
    const { offset, limit } = parsePagination(c.req.query(), {
      limit: DEFAULT_LIMIT,
      max: MAX_LIMIT,
    });

    const opened = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      async (adapter) => {
        const [l, fs] = await Promise.all([
          adapter.scans.load(),
          adapter.favorites.listPaths(),
        ]);
        return { loaded: l, favSet: fs };
      },
    );
    const scan = opened?.loaded ?? { nodes: [], links: [], issues: [] };
    const favSet = opened?.favSet ?? new Set<string>();
    const subset = applyExportQuery(scan, query);

    // hasIssues=false is the one filter the kernel grammar can't carry —
    // applied here as a post-filter against the already-narrowed subset.
    let nodes = subset.nodes;
    if (filters.hasIssues === false) {
      nodes = filterNodesWithoutIssues(nodes, scan.issues);
    }

    const total = nodes.length;
    // Decorate only the page slice — the favorites Set lookup is O(1)
    // per node, but skipping the off-page rows still saves pointless
    // object allocations for large scans.
    const items = nodes
      .slice(offset, offset + limit)
      .map((n) => ({ ...n, isFavorite: favSet.has(n.path) }));

    return c.json(
      buildListEnvelope({
        kind: 'nodes',
        items,
        filters: {
          kind: filters.kinds ?? null,
          hasIssues: filters.hasIssues ?? null,
          path: filters.pathGlobs ?? null,
        },
        total,
        page: { offset, limit },
        kindRegistry: deps.kindRegistry,
      }),
    );
  });
}

/**
 * Parse the comma-separated `?include=` query param into a set of
 * include flags. Unknown values are silently ignored — callers branch
 * on `set.has('body')`, etc., so a future `?include=summary,body`
 * value lands without churning every existing call site. An absent /
 * empty param resolves to an empty set.
 */
function parseIncludes(raw: string | undefined): ReadonlySet<string> {
  return new Set(parseCsv(raw));
}
