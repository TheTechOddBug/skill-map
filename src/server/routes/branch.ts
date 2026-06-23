/**
 * `GET /api/branch?path=<prefix>&path=<prefix>&limit=<n>`, branch
 * projection for the graph map.
 *
 * `path` is REPEATABLE: the response is the UNION of the subtrees under
 * every given prefix (forward-slash folder prefix; absent or all-empty =
 * whole corpus), capped at `limit` nodes. Direct shape (NO envelope
 * wrap, like `/api/scan`, so the SPA branches on `schemaVersion` +
 * `kind` exactly as it does for the scan payload):
 *
 *   ```
 *   {
 *     schemaVersion: '1',
 *     kind: 'branch',
 *     branch: { paths, total, rendered, truncated, cap },
 *     nodes: Node[],
 *     links: Link[],
 *     issues: Issue[]
 *   }
 *   ```
 *
 * Scoping + capping happen entirely in SQL (`port.scans.loadBranch`) so
 * a 50K corpus never hydrates into memory:
 *
 *   - A node is in the branch when, for ANY requested prefix, its
 *     `path === prefix` or starts with `prefix + '/'`. The per-prefix
 *     subtrees are UNIONed. `nodes` is the first `rendered` union nodes
 *     in stable path order (`ORDER BY path`).
 *   - `links` carries only edges whose source AND target are both in
 *     `nodes`; `issues` only those whose `nodeIds` intersect `nodes`.
 *   - `total` is the union node count BEFORE the cap; `cap` is the
 *     effective limit; `rendered` is `min(total, cap)`; `truncated` is
 *     `total > cap`. `paths` echoes the (filtered, de-duped) requested
 *     prefixes; the whole-corpus case echoes `[]`.
 *
 * `cap` / `limit`: the default cap is the scan's effective
 * `maxRenderNodes` (`scan_meta.max_render_nodes`, design default 256
 * when never scanned). A `limit` query param can only LOWER the cap, it
 * clamps to `[1, maxRenderNodes]` (it never raises above the scan's
 * recorded cap). A non-integer or `< 1` `limit` rejects with 400
 * `bad-query` (mirrors the `nodes.ts` integer-parse gate).
 *
 * Node decoration mirrors `/api/scan`: `isFavorite` + `tags` + embedded
 * `contributions`. Contributions MUST be embedded (not lazy-fetched): the
 * map node cards render their footer / badge slots through the
 * view-contribution hosts, which read `node.contributions` directly. DB
 * absent → empty branch (zero nodes, `total: 0`, `truncated: false`,
 * `cap` = default maxRenderNodes).
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import type { Issue, Link, Node } from '../../kernel/index.js';
import type { IPersistedContribution } from '../../kernel/ports/storage.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { tx } from '../../kernel/util/tx.js';
import { REST_ENVELOPE_SCHEMA_VERSION } from '../envelope.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import type { IRouteDeps } from './deps.js';

/**
 * Design default for the render cap when the DB is absent (no scan_meta
 * to read). Mirrors `scan.maxNodes` (256) and the kernel-side fallback
 * in `loadEffectiveMaxRenderNodes`.
 */
const DEFAULT_MAX_RENDER_NODES = 256;

interface IBranchResponse {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: 'branch';
  branch: {
    paths: string[];
    total: number;
    rendered: number;
    truncated: boolean;
    cap: number;
  };
  nodes: Node[];
  links: Link[];
  issues: Issue[];
}

export function registerBranchRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/branch', async (c) => {
    // `path` is REPEATABLE: `c.req.queries('path')` returns every value
    // for the key (`[]` when absent). Drop empty strings, an all-empty /
    // absent set is the whole-corpus case. No trimming: a folder prefix
    // is matched verbatim against `scan_nodes.path`.
    const prefixes = c.req.queries('path')?.filter((p) => p.length > 0) ?? [];
    // Parse `limit` BEFORE opening the DB so a malformed value fails fast
    // with 400 regardless of DB state. `undefined` = use the scan's cap.
    const limitOverride = parseLimit(c.req.query('limit'));

    const loaded = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      async (adapter) => {
        const maxRenderNodes = await adapter.scans.effectiveMaxRenderNodes();
        // A `limit` query param can only LOWER the cap: clamp to
        // [1, maxRenderNodes]. Absent → the scan's full cap.
        const cap =
          limitOverride === undefined
            ? maxRenderNodes
            : Math.min(limitOverride, maxRenderNodes);
        const [branch, favSet] = await Promise.all([
          adapter.scans.loadBranch(prefixes, cap),
          adapter.favorites.listPaths(),
        ]);
        // Per-node tags + contributions for the rendered slice (bulk, one
        // round-trip each). Contributions MUST be embedded: the map node
        // cards render their footer / badge slots from `node.contributions`
        // via the view-contribution hosts, which never lazy-fetch. Mirrors
        // the `/api/scan` decoration.
        const paths = branch.nodes.map((n) => n.path);
        const [tagRows, contribRows] = await Promise.all([
          adapter.tags.listForPaths(paths),
          adapter.contributions.listForPaths(paths),
        ]);
        return { branch, favSet, tagRows, contribRows, cap };
      },
    );

    return c.json(buildBranchResponse(prefixes, loaded));
  });
}

/**
 * Materialise the branch response from the optionally-loaded projection.
 * Pulled out of the handler so the route body stays under the
 * per-function complexity cap; the DB-absent branch (null `loaded`) and
 * the populated branch share the envelope assembly here.
 */
function buildBranchResponse(
  prefixes: string[],
  loaded: {
    branch: { nodes: Node[]; links: Link[]; issues: Issue[]; total: number; paths: string[] };
    favSet: Set<string>;
    tagRows: readonly { nodePath: string; tag: string }[];
    contribRows: readonly IPersistedContribution[];
    cap: number;
  } | null,
): IBranchResponse {
  if (loaded === null) {
    // DB file absent → empty branch. `cap` reflects the design default
    // so the SPA reads the same field shape as on a populated DB.
    // `paths` echoes the (filtered) requested prefixes, de-duped for
    // parity with the populated branch (which echoes the de-duped set
    // the storage layer scoped on).
    return {
      schemaVersion: REST_ENVELOPE_SCHEMA_VERSION,
      kind: 'branch',
      branch: { paths: [...new Set(prefixes)], total: 0, rendered: 0, truncated: false, cap: DEFAULT_MAX_RENDER_NODES },
      nodes: [],
      links: [],
      issues: [],
    };
  }
  const { branch, favSet, tagRows, contribRows, cap } = loaded;
  const tagsByPath = groupTagsByPath(tagRows);
  const contribByPath = groupContribsByPath(contribRows);
  const nodes = branch.nodes.map((n) => ({
    ...n,
    isFavorite: favSet.has(n.path),
    tags: tagsByPath.get(n.path) ?? [],
    contributions: contribByPath.get(n.path) ?? [],
  }));
  const rendered = nodes.length;
  return {
    schemaVersion: REST_ENVELOPE_SCHEMA_VERSION,
    kind: 'branch',
    branch: {
      // Echo the de-duped prefixes the storage layer actually scoped on.
      paths: branch.paths,
      total: branch.total,
      rendered,
      truncated: branch.total > cap,
      cap,
    },
    nodes,
    links: branch.links,
    issues: branch.issues,
  };
}

/**
 * Parse the optional `limit` query param into a positive integer, or
 * `undefined` when absent (meaning "use the scan's effective cap"). A
 * non-integer or `< 1` value throws `HTTPException(400)` (mirrors the
 * strict integer gate in `parse-query.ts`). The upper clamp against
 * `maxRenderNodes` happens in the route (it needs the DB-read cap), so
 * this helper only enforces the lower bound + integer shape.
 */
function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  const trimmed = raw.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== trimmed) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.branchInvalidLimit, { value: raw }),
    });
  }
  return parsed;
}

/**
 * Group bulk tag rows into a flat `string[]` per node, deduped and
 * sorted ascending. Mirror of the helper on `/api/scan` / `/api/nodes`.
 */
function groupTagsByPath(
  rows: readonly { nodePath: string; tag: string }[],
): Map<string, string[]> {
  const buckets = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = buckets.get(r.nodePath);
    if (set) set.add(r.tag);
    else buckets.set(r.nodePath, new Set([r.tag]));
  }
  const out = new Map<string, string[]>();
  for (const [path, set] of buckets) out.set(path, [...set].sort());
  return out;
}

/**
 * Group bulk contribution rows by node path, preserving load order.
 * Mirror of the helper on `/api/scan`; the view-contribution hosts read
 * `node.contributions` to render the card footer / badge slots.
 */
function groupContribsByPath(
  rows: readonly IPersistedContribution[],
): Map<string, IPersistedContribution[]> {
  const out = new Map<string, IPersistedContribution[]>();
  for (const r of rows) {
    const list = out.get(r.nodePath);
    if (list) list.push(r);
    else out.set(r.nodePath, [r]);
  }
  return out;
}
