/**
 * `GET /api/nodes`, paginated, filtered list of persisted nodes.
 * `GET /api/nodes/:pathB64`, single-node detail bundle (mirrors `sm show --json`).
 *
 * **List filtering** funnels through `urlParamsToExportQuery` →
 * `applyExportQuery`, which means `/api/nodes` and `sm export` share
 * one filter grammar. The `hasIssues=false` post-filter handles the
 * one case the kernel grammar can't express (negation).
 *
 * **Pagination** applies only to the list route. Defaults: `offset=0`,
 * `limit=100`. `limit > 1000` rejects with `bad-query` (caps the cost
 * of a single response). `/api/links` and `/api/issues` do NOT
 * paginate at 14.2, typical scopes have at most a few hundred rows.
 *
 * **Single route** uses base64url-encoded `node.path` as the route
 * param. Malformed pathB64 → `not-found` (treating it as "no such
 * node" is gentler than yelling "bad input"). Missing node → same.
 *
 * **Single route response shape** (Step 14.5.a, locked):
 *
 *   ```
 *   {
 *     schemaVersion: '1',
 *     kind: 'node',
 *     item: Node,                                  // (+ optional `body` / `raw`)
 *     links: { incoming: Link[], outgoing: Link[] },
 *     issues: Issue[]
 *   }
 *   ```
 *
 *   Pre-14.5.a the handler emitted `{ item: { node, linksOut, linksIn,
 *   issues } }`, the `INodeBundle` shape passed straight through. No
 *   prod consumer ever ran against it (the SPA's `INodeDetailApi`
 *   model already declared the new shape, and the only `getNode`
 *   call sites today are tests and the `StaticDataSource` which
 *   already produces the new shape). The 14.5.a flip is therefore a
 *   bug fix, not a breaking change for any deployed surface.
 *
 * **`?include=body` (Step 14.5.a)**, opt-in flag that adds `item.body`
 * to the response. The body is read from disk on demand (the kernel
 * persists `body_hash` only, see `node-body.ts` for the rationale).
 * Without the flag the handler never touches the filesystem; with it,
 * `body` is the post-frontmatter content as a UTF-8 string, or `null`
 * when the file is missing / unreadable. The Inspector view passes the
 * flag; the auto-rename UI and other future single-node consumers can
 * skip it.
 *
 * **`?include=raw`**, opt-in flag that adds `item.raw`: the on-disk
 * file VERBATIM (frontmatter block included), or `null` when missing /
 * unreadable. Consumer: the inspector's Raw toggle, whose line-number
 * gutter must match the FILE-absolute `L<n>` lines findings report
 * (`link.schema.json#/properties/location`). Composable with `body`
 * (`?include=body,raw`); both ride the same single disk read.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { applyExportQuery } from '../../kernel/index.js';
import type { IPersistedContribution } from '../../kernel/ports/storage.js';
import type { IFindingSeverityCount } from '../../kernel/types/storage.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { foldFindingsIntoSeverityChips } from '../../plugins/core/analyzers/issue-counter/severity-fold.js';
import { bffReadVersionCheck } from '../util/db-read-check.js';
import { tx } from '../../kernel/util/tx.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { buildListEnvelope, REST_ENVELOPE_SCHEMA_VERSION } from '../envelope.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { readNodeFileRaw, stripFrontmatter } from '../node-body.js';
import { decodeNodePath, PathCodecError } from '../path-codec.js';
import {
  filterNodesWithoutIssues,
  urlParamsToExportQuery,
} from '../query-adapter.js';
import { parseCsv, parsePagination } from '../util/parse-query.js';
import {
  BFF_MAX_BULK_CONTRIBUTIONS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from '../limits.js';
import type { IRouteDeps } from './deps.js';

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
      // Malformed pathB64 surfaces as 404, from the client's view there's
      // no such node either way. The thrown error message is logged via
      // `formatErrorMessage` in `app.onError`.
      if (err instanceof PathCodecError) {
        throw new HTTPException(404, { message: SERVER_TEXTS.pathB64Malformed });
      }
      throw err;
    }
    const result = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
      async (adapter) => {
        const b = await adapter.scans.findNode(nodePath);
        if (!b) {
          return {
            bundle: null,
            isFavorite: false,
            contributions: [],
            tags: [] as string[],
            findingCounts: { warn: 0, error: 0 } as IFindingSeverityCount,
          } as const;
        }
        const favSet = await adapter.favorites.listPaths();
        // Phase 3, single-node responses ALWAYS embed contributions
        // for that node, regardless of `bff.maxBulkContributions` (the
        // cap only governs the bulk list path).
        const contributions = await adapter.contributions.listForNode(b.node.path);
        const tagRows = await adapter.tags.listForNode(b.node.path);
        // Read-time aggregate: fresh open findings summed into
        // issue-counter's severity chips below (see issue-counter/severity-fold).
        const findingCounts =
          (await adapter.findings.countUnresolvedByPath([b.node.path])).get(b.node.path) ??
          ({ warn: 0, error: 0 } as IFindingSeverityCount);
        return {
          bundle: b,
          isFavorite: favSet.has(b.node.path),
          contributions,
          tags: tagRows.map((r) => r.tag),
          findingCounts,
        } as const;
      },
    );
    const bundle = result?.bundle ?? null;
    const isFavorite = result?.isFavorite ?? false;
    const contributions = result?.contributions ?? [];
    const tags = result?.tags ?? [];
    const findingCounts = result?.findingCounts ?? { warn: 0, error: 0 };
    if (!bundle) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.nodeNotFound, { path: sanitizeForTerminal(nodePath) }),
      });
    }
    // Fold the node's fresh open findings into issue-counter's aggregate
    // warn / error chips (spec/view-slots.md §card.footer.right). NOT a
    // chip filter: it sums a second real source, it never silences a chip.
    const foldedContributions = foldFindingsIntoSeverityChips(
      contributions,
      findingCounts,
      deps.contributionsRegistry,
      nodePath,
    );
    const decoratedNode = { ...bundle.node, isFavorite, contributions: foldedContributions, tags };
    const includes = parseIncludes(c.req.query('include'));
    // `body` and `raw` share one guarded disk read: `raw` is the file
    // verbatim (frontmatter included, so the inspector's Raw gutter
    // matches the file-absolute `L<n>` lines findings report), `body`
    // is the same bytes with the frontmatter block stripped.
    const wantsFile = includes.has('body') || includes.has('raw');
    const rawFile = wantsFile ? await readNodeFileRaw(deps.runtimeContext.cwd, nodePath) : null;
    const item = wantsFile
      ? {
          ...decoratedNode,
          ...(includes.has('body')
            ? { body: rawFile === null ? null : stripFrontmatter(rawFile) }
            : {}),
          ...(includes.has('raw') ? { raw: rawFile } : {}),
        }
      : decoratedNode;
    return c.json({
      schemaVersion: REST_ENVELOPE_SCHEMA_VERSION,
      kind: 'node' as const,
      item,
      links: { incoming: bundle.linksIn, outgoing: bundle.linksOut },
      issues: bundle.issues,
      kindRegistry: deps.kindRegistry,
      providerRegistry: deps.providerRegistry,
      contributionsRegistry: deps.contributionsRegistry,
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
      { databasePath: deps.options.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
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

    // hasIssues=false is the one filter the kernel grammar can't carry,
    // applied here as a post-filter against the already-narrowed subset.
    let nodes = subset.nodes;
    if (filters.hasIssues === false) {
      nodes = filterNodesWithoutIssues(nodes, scan.issues);
    }

    const total = nodes.length;
    const pageNodes = nodes.slice(offset, offset + limit);

    // Phase 3 / View contribution system, embed per-node
    // contributions for the page slice IFF `limit ≤
    // BFF_MAX_BULK_CONTRIBUTIONS`. Above the cap, omit; the UI falls
    // back to the lazy `/api/contributions/:pluginId/:contributionId
    // ?path=` endpoint per node. Single-node responses ignore the cap.
    //
    // The bulk fetch happens in a separate `tryWithSqlite` open
    // (cheap, same DB; the previous open already returned). A future
    // refactor could fold both opens into one but the structural cost
    // today is negligible.
    const contributionsOmitted = limit > BFF_MAX_BULK_CONTRIBUTIONS;
    const pagePaths = pageNodes.map((n) => n.path);
    const { contributionsByPath, tagsByPath, findingCountsByPath } =
      (await tryWithSqlite(
        { databasePath: deps.options.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
        async (adapter) => {
          const contribByPath = contributionsOmitted
            ? new Map<string, IPersistedContribution[]>()
            : await groupContributionsByPath(
                await adapter.contributions.listForPaths(pagePaths),
              );
          const tagByPath = groupTagsByPath(
            await adapter.tags.listForPaths(pagePaths),
          );
          // Findings only matter when contributions are embedded (the fold
          // below rides on them); above the bulk cap the whole
          // contributions array is omitted, so skip the query entirely.
          const findingByPath = contributionsOmitted
            ? new Map<string, IFindingSeverityCount>()
            : await adapter.findings.countUnresolvedByPath(pagePaths);
          return {
            contributionsByPath: contribByPath,
            tagsByPath: tagByPath,
            findingCountsByPath: findingByPath,
          };
        },
      )) ?? {
        contributionsByPath: new Map<string, IPersistedContribution[]>(),
        tagsByPath: new Map<string, string[]>(),
        findingCountsByPath: new Map<string, IFindingSeverityCount>(),
      };
    const items = pageNodes.map((n) => ({
      ...n,
      isFavorite: favSet.has(n.path),
      // Fold fresh open findings into issue-counter's aggregate severity
      // chips (spec/view-slots.md §card.footer.right). When contributions
      // are omitted (above the bulk cap) there is nothing to fold into.
      contributions: contributionsOmitted
        ? []
        : foldFindingsIntoSeverityChips(
            contributionsByPath.get(n.path) ?? [],
            findingCountsByPath.get(n.path) ?? { warn: 0, error: 0 },
            deps.contributionsRegistry,
            n.path,
          ),
      tags: tagsByPath.get(n.path) ?? [],
    }));

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
        providerRegistry: deps.providerRegistry,
        contributionsRegistry: deps.contributionsRegistry,
      }),
    );
  });
}

/**
 * Parse the comma-separated `?include=` query param into a set of
 * include flags. Unknown values are silently ignored, callers branch
 * on `set.has('body')`, etc., so a future `?include=summary,body`
 * value lands without churning every existing call site. An absent /
 * empty param resolves to an empty set.
 */
function parseIncludes(raw: string | undefined): ReadonlySet<string> {
  return new Set(parseCsv(raw));
}

/**
 * Group bulk tag rows by node path into a flat `string[]` per node.
 * Used by the bulk `/api/nodes` route to attach `tags` to every page
 * item without one query per node. Tags are deduplicated per node (the
 * PK already prevents duplicates at the DB layer; the dedup here is
 * defensive against legacy callers that bypass the persistence
 * projection) and sorted ascending.
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
 * Group bulk contribution rows by node path. Mirrors the prior inline
 * grouping under the bulk `/api/nodes` route; pulled into a helper
 * because the route now also groups tags and the chained Map building
 * was getting noisy.
 */
async function groupContributionsByPath(
  rows: readonly IPersistedContribution[],
): Promise<Map<string, IPersistedContribution[]>> {
  const byPath = new Map<string, IPersistedContribution[]>();
  for (const r of rows) {
    const list = byPath.get(r.nodePath);
    if (list) list.push(r);
    else byPath.set(r.nodePath, [r]);
  }
  return byPath;
}
