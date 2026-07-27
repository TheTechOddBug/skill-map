/**
 * `loadScanResult`, driving inverse of `persistScanResult`. Reads the
 * `scan_*` tables and reconstructs a `ScanResult` shape so the
 * orchestrator can run an incremental scan (`sm scan --changed`) on
 * top of a prior snapshot.
 *
 * The reconstruction is faithful for everything that was actually
 * persisted: nodes (with triple-split bytes / tokens, denormalised
 * counts, JSON frontmatter), internal links (with regrouped
 * `trigger` / `location`, parsed `sources[]`), and issues
 * (with parsed `nodeIds` / `linkIndices` / `fix` / `data`).
 *
 * **Documented omission**: external pseudo-links (those whose target is
 * an `http://` / `https://` URL emitted by the external-url-counter
 * extractor) are NEVER persisted to `scan_links`, only their per-node
 * count survives in `scan_nodes.external_refs_count`. Therefore the
 * `result.links` returned by `loadScanResult` contains only internal
 * graph links, and `node.externalRefsCount` is the authoritative count
 * carried over from the prior scan. The orchestrator's incremental path
 * preserves that count for "unchanged" nodes and re-derives it for
 * new / modified nodes from a fresh extractor pass.
 *
 * Meta envelope: the `scan_meta` table persists `roots` /
 * `scannedAt` / `scannedBy` / `tokenizer` / `providers` /
 * `stats.filesWalked` / `stats.filesSkipped` / `stats.filesOversized` /
 * `stats.durationMs` / `oversizedFiles`. When the row exists, those fields come back
 * authoritatively. When it does not (DB
 * freshly migrated but never scanned, or a legacy DB never
 * re-persisted), the loader degrades to a synthetic envelope:
 *
 *   - `scannedAt` ← max(`scan_nodes.scanned_at`); falls back to `Date.now()`
 *     for empty snapshots so the field stays a positive integer.
 *   - `roots`     ← `['.']` to satisfy spec's `minItems: 1`. NOT
 *     load-bearing: the orchestrator's incremental path only reads
 *     `nodes` / `links` / `issues` from the prior; it never reuses the
 *     prior `roots`.
 *   - `providers` ← `[]`.
 *   - `stats`     ← zeros for `filesWalked` / `filesSkipped` /
 *     `durationMs`; the three count fields derive from row counts.
 *
 * Both branches keep `nodesCount` / `linksCount` / `issuesCount` derived
 * from `COUNT(*)` of the loaded rows, never persisted, always recomputed.
 */

import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import type { IPersistedEnrichment } from '../../orchestrator.js';
import type {
  IBranchProjection,
  IBranchScope,
  IIssueIncidenceCount,
  ILiteNode,
  INodeCounts,
} from '../../types/storage.js';
import { stripPrototypePollution } from '../../util/strip-prototype-pollution.js';
import type {
  Issue,
  IssueFix,
  IExternalRef,
  Link,
  LinkLocation,
  LinkOccurrence,
  LinkTrigger,
  Node,
  OversizedFile,
  ScanResult,
  ScanScannedBy,
  TripleSplit,
} from '../../types.js';
import type {
  IDatabase,
  IScanIssuesTable,
  IScanLinksTable,
  IScanMetaTable,
  IScanNodesTable,
} from './schema.js';
import type { Selectable } from 'kysely';
import {
  parseConfidence,
  parseLinkKind,
  parseSeverity,
} from '../../util/enum-parsers.js';
import { tx } from '../../util/tx.js';
import { STORAGE_TEXTS } from '../../i18n/storage.texts.js';

export async function loadScanResult(
  db: Kysely<IDatabase>,
): Promise<ScanResult> {
  const [nodeRows, linkRows, issueRows, metaRow] = await Promise.all([
    db.selectFrom('scan_nodes').selectAll().execute(),
    db.selectFrom('scan_links').selectAll().execute(),
    db.selectFrom('scan_issues').selectAll().execute(),
    db.selectFrom('scan_meta').selectAll().executeTakeFirst(),
  ]);

  // Defensive wrapper around `rowToNode` / `rowToLink` / `rowToIssue`:
  // each helper calls into the strict enum parsers (`parseConfidence`,
  // `parseLinkKind`, `parseSeverity`), which throw the bare "Invalid
  // <Enum> value ..." diagnostic when a column holds a value outside
  // the closed union. That message lands at the operator with zero
  // context when the underlying cause is version skew (an older CLI
  // reading a newer DB whose `scan_meta` row was lost to a manual
  // reset, so the version check returned `no-meta`). Wrap the row
  // mapping in one place and re-throw with the version-skew hint the
  // operator actually needs to recover. We do NOT swallow the cause,
  // the original parser message is interpolated so the diagnostic
  // signal stays intact for bug reports.
  let nodes: Node[];
  let links: Link[];
  let issues: Issue[];
  try {
    nodes = nodeRows.map(rowToNode);
    links = linkRows.map(rowToLink);
    issues = issueRows.map(rowToIssue);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      tx(STORAGE_TEXTS.scanLoadDbVersionLoadWrapped, { cause }),
      { cause: err },
    );
  }

  if (metaRow) {
    return buildScanResultFromMeta(metaRow, nodes, links, issues, {
      nodesCount: nodes.length,
      linksCount: links.length,
      issuesCount: issues.length,
    });
  }

  // Synthetic fallback: pre-5.1 DB or never-scanned scope.
  let scannedAt = 0;
  for (const row of nodeRows) {
    if (row.scannedAt > scannedAt) scannedAt = row.scannedAt;
  }
  if (scannedAt === 0) scannedAt = Date.now();

  return {
    schemaVersion: 1,
    scannedAt,
    roots: ['.'],
    providers: [],
    // Synthetic envelope, default to the design knobs (corpus ceiling
    // 5000, render cap 256, not truncated) so the SPA reads the same
    // shape across cold-boot and never-scanned scopes. A real scan
    // overwrites scan_meta with the live values on next run.
    scanCeiling: 5000,
    scanTruncated: false,
    maxRenderNodes: 256,
    oversizedFiles: [],
    nodes,
    links,
    issues,
    stats: {
      filesWalked: 0,
      filesSkipped: 0,
      filesOversized: 0,
      nodesCount: nodes.length,
      linksCount: links.length,
      issuesCount: issues.length,
      durationMs: 0,
    },
  };
}

function buildScanResultFromMeta(
  metaRow: Selectable<IScanMetaTable>,
  nodes: Node[],
  links: Link[],
  issues: Issue[],
  counts: { nodesCount: number; linksCount: number; issuesCount: number },
): ScanResult {
  const scannedBy: ScanScannedBy = {
    name: metaRow.scannedByName,
    version: metaRow.scannedByVersion,
    specVersion: metaRow.scannedBySpecVersion,
  };
  // `oversized_files_json` is kernel-owned (only `metaToRow` writes it);
  // NULL / legacy rows come back as `[]`. The count column defaults to 0
  // in SQL so it stays consistent on pre-feature DBs.
  const oversizedFiles = parseJsonArray<OversizedFile>(metaRow.oversizedFilesJson);
  return {
    schemaVersion: 1,
    scannedAt: metaRow.scannedAt,
    roots: parseJsonArray<string>(metaRow.rootsJson),
    providers: parseJsonArray<string>(metaRow.providersJson),
    scannedBy,
    // Resolved encoder of the prior scan (see project-config.schema.json
    // §tokenizer). A NULL column maps to an absent domain field; the
    // orchestrator's tokenizer-change check treats a missing prior value
    // as a change (forcing a token recompute).
    ...(metaRow.tokenizer !== null ? { tokenizer: metaRow.tokenizer } : {}),
    scanCeiling: metaRow.scanCeiling,
    scanTruncated: metaRow.scanTruncated === 1,
    maxRenderNodes: metaRow.maxRenderNodes,
    oversizedFiles,
    nodes,
    links,
    issues,
    stats: {
      filesWalked: metaRow.statsFilesWalked,
      filesSkipped: metaRow.statsFilesSkipped,
      filesOversized: metaRow.filesOversized,
      nodesCount: counts.nodesCount,
      linksCount: counts.linksCount,
      issuesCount: counts.issuesCount,
      durationMs: metaRow.statsDurationMs,
    },
  };
}

/**
 * Metadata-only `ScanResult`: every scalar field + real `COUNT(*)` stats
 * (passed in via `counts`), but empty `nodes` / `links` / `issues`
 * arrays. Reads only the single `scan_meta` row, never the node / link /
 * issue tables, so the BFF `GET /api/scan?meta=1` boot fetch stays cheap
 * on a 50K-node corpus. The SPA pairs it with `/api/folders` (tree) and
 * `/api/branch` (map). Falls back to the synthetic envelope (design
 * defaults: ceiling 5000, render cap 256, not truncated) when no
 * `scan_meta` row exists, mirroring `loadScanResult`.
 */
export async function loadScanMeta(
  db: Kysely<IDatabase>,
  counts: INodeCounts,
): Promise<ScanResult> {
  const metaRow = await db
    .selectFrom('scan_meta')
    .selectAll()
    .executeTakeFirst();
  const c = {
    nodesCount: counts.nodes,
    linksCount: counts.links,
    issuesCount: counts.issues,
  };
  if (metaRow) {
    return buildScanResultFromMeta(metaRow, [], [], [], c);
  }
  return {
    schemaVersion: 1,
    scannedAt: Date.now(),
    roots: ['.'],
    providers: [],
    scanCeiling: 5000,
    scanTruncated: false,
    maxRenderNodes: 256,
    oversizedFiles: [],
    nodes: [],
    links: [],
    issues: [],
    stats: {
      filesWalked: 0,
      filesSkipped: 0,
      filesOversized: 0,
      nodesCount: c.nodesCount,
      linksCount: c.linksCount,
      issuesCount: c.issuesCount,
      durationMs: 0,
    },
  };
}

/**
 * Design default for the map-render cap (`scan.maxNodes`), used when no
 * `scan_meta` row exists yet (DB freshly migrated / never scanned).
 * Mirrors the `256` literal in `src/config/defaults.json` and the
 * synthetic-envelope fallback in `loadScanResult` above.
 */
const DEFAULT_MAX_RENDER_NODES = 256;

/**
 * Lightweight `{ path, kind }[]` projection of `scan_nodes`, ordered by
 * `path` ASC. Backs the BFF `/api/folders` endpoint, which renders the
 * whole corpus (up to `scan.maxScan`) without hydrating the full
 * `ScanResult`. SELECTs only the two columns the folders tree needs, so
 * a 50K corpus stays cheap.
 */
/**
 * Distinct `scan_nodes.provider` values in the persisted scan. Backs
 * `sm doctor`'s "detected Providers that matched nothing" check: a
 * Provider whose on-disk markers exist but whose id never appears here
 * classified zero nodes.
 */
export async function loadDistinctNodeProviders(
  db: Kysely<IDatabase>,
): Promise<string[]> {
  const rows = await db
    .selectFrom('scan_nodes')
    .select('provider')
    .distinct()
    .execute();
  return rows.map((r) => r.provider);
}

export async function loadLiteNodes(
  db: Kysely<IDatabase>,
): Promise<ILiteNode[]> {
  const rows = await db
    .selectFrom('scan_nodes')
    .select([
      'path',
      'kind',
      'linksInCount',
      'linksOutCount',
      'tokensTotal',
      'modifiedAtMs',
      'sidecarStatus',
    ])
    .orderBy('path', 'asc')
    .execute();
  return rows.map((r) => ({
    path: r.path,
    kind: r.kind,
    linksInCount: r.linksInCount,
    linksOutCount: r.linksOutCount,
    tokensTotal: r.tokensTotal,
    modifiedAtMs: r.modifiedAtMs,
    sidecarStatus: r.sidecarStatus,
  }));
}

/**
 * Per-node issue incidence counts by severity, keyed by node path.
 *
 * `scan_issues.node_ids_json` is a JSON array (one issue can touch many
 * nodes); `json_each` expands it into one row per `(issue, node)` pair.
 * Grouping by `(value, severity)` yields the incidence count per node
 * per severity in a single SQL pass, never loading the full issue table
 * into memory (audit posture mirrors `listIssues`' `json_each` filter).
 *
 * Only `error` / `warn` severities are tallied, the SPA folders tree
 * badges ignore `info`. Nodes with no error / warn issue are absent
 * from the returned map (the caller defaults them to `{ error: 0,
 * warn: 0 }`).
 */
export async function loadIssueCountsByPath(
  db: Kysely<IDatabase>,
): Promise<Map<string, IIssueIncidenceCount>> {
  // Raw derived table: `json_each` explodes `node_ids_json` into one row
  // per `(issue, node)` pair, then `GROUP BY value, severity` tallies the
  // incidence per node per severity in SQL. Authored in snake_case (the
  // raw fragment bypasses Kysely's CamelCasePlugin, see the
  // storage-adapter header "Trap to avoid"). Filtering to error / warn
  // here keeps the result small (the SPA badges ignore `info`).
  const rows = await db
    .selectFrom(
      sql<{ value: string; severity: string; c: number }>`(
        SELECT je.value AS value, si.severity AS severity, COUNT(*) AS c
        FROM scan_issues si, json_each(si.node_ids_json) je
        WHERE si.severity IN ('error', 'warn')
        GROUP BY je.value, si.severity
      )`.as('incidence'),
    )
    .select(['value', 'severity', 'c'])
    .execute();
  const out = new Map<string, IIssueIncidenceCount>();
  for (const row of rows) {
    const bucket = out.get(row.value) ?? { error: 0, warn: 0 };
    if (row.severity === 'error') bucket.error = Number(row.c);
    else if (row.severity === 'warn') bucket.warn = Number(row.c);
    out.set(row.value, bucket);
  }
  return out;
}

/**
 * Effective map-render cap (`scan_meta.max_render_nodes`) recorded by the
 * latest scan. Returns `DEFAULT_MAX_RENDER_NODES` (256) when no meta row
 * exists (DB freshly migrated / never scanned). Backs the `/api/branch`
 * cap default + clamp ceiling.
 */
export async function loadEffectiveMaxRenderNodes(
  db: Kysely<IDatabase>,
): Promise<number> {
  const metaRow = await db
    .selectFrom('scan_meta')
    .select(['maxRenderNodes'])
    .executeTakeFirst();
  return metaRow?.maxRenderNodes ?? DEFAULT_MAX_RENDER_NODES;
}

/**
 * Override-scoped, capped graph projection for the BFF `/api/branch`
 * endpoint (`spec/cli-contract.md` §Map scope overrides).
 *
 * Scoping: a node's effective state is the override of its NEAREST
 * ancestor (self included) among the scope's include/exclude paths plus
 * the root (`rootExcluded`); no matching override = included. The
 * matching overrides for a node are mutually prefix-ordered, so
 * "nearest is an include `i`" is exactly "`i` matches AND no exclude
 * STRICTLY UNDER `i` matches", which compiles to a flat OR-of-ANDs
 * (see `applyBranchScope`). Per-path matching keeps the historical
 * shape: `path = p OR path LIKE p || '/%'`, the `'/%'` literal in the
 * template, each path bound as a parameter (no user input interpolated
 * into the SQL string). `_` / `%` glob metacharacters inside a real
 * path are not escaped, a node path almost never contains them, and a
 * stray match only ever widens the branch to a sibling under the same
 * parent, never leaks across the tree. Identical paths are de-duped
 * defensively before binding.
 *
 * Capping: `total` is a `COUNT(*)` over the scoped set (BEFORE the cap,
 * AFTER override evaluation); `nodes` is the same set `ORDER BY path
 * LIMIT limit`. `links` are the edges whose `source_path` AND resolved
 * target are both in the capped node set; `issues` are those whose
 * `node_ids_json` intersects it (`json_each` + `IN`). Every step runs
 * in SQL so the 50K corpus never hydrates into memory. The fully-
 * excluded scope (root excluded, no includes) short-circuits to an
 * empty projection without touching the DB.
 */
export async function loadBranch(
  db: Kysely<IDatabase>,
  scope: IBranchScope,
  limit: number,
): Promise<IBranchProjection> {
  // De-dup identical paths defensively, so a duplicated query value
  // does not duplicate its clause in the WHERE.
  const resolved: IBranchScope = {
    include: [...new Set(scope.include)],
    exclude: [...new Set(scope.exclude)],
    rootExcluded: scope.rootExcluded,
  };

  // Everything excluded and nothing rescued: the projection is empty by
  // construction; skip the queries (and the degenerate `1 = 0` WHERE).
  if (resolved.rootExcluded && resolved.include.length === 0) {
    return { nodes: [], links: [], issues: [], total: 0, paths: [] };
  }

  const total = await countBranchNodes(db, resolved);

  const nodeRows = await applyBranchScope(
    db.selectFrom('scan_nodes').selectAll(),
    resolved,
  )
    .orderBy('path', 'asc')
    .limit(limit)
    .execute();
  const nodes = nodeRows.map(rowToNode);
  const pathSet = new Set(nodes.map((n) => n.path));

  if (pathSet.size === 0) {
    return { nodes, links: [], issues: [], total, paths: resolved.include };
  }

  const paths = [...pathSet];
  const [linkRows, issueRows] = await Promise.all([
    db
      .selectFrom('scan_links')
      .selectAll()
      .where('sourcePath', 'in', paths)
      // Match the edge's RESOLVED endpoint, not the raw authored target.
      // Trigger-style links (`invokes` / `mentions`) store the trigger
      // (`/cmd`, `@agent`) in `target_path` and the real node path in
      // `resolved_target`; for path-style links the two are equal. Filtering
      // on `target_path` alone would drop every resolved trigger edge from
      // the branch, so they never reach the map (the regression this fixes).
      // `coalesce(resolved_target, target_path)` falls back to the raw target
      // for genuinely-broken links (`resolved_target` NULL), which then
      // correctly fall out because their raw target names no rendered node,
      // exactly as the UI's `resolveTopology` drops them when the map renders
      // the full `/api/scan` payload.
      .where(sql<string>`coalesce(resolved_target, target_path)`, 'in', paths)
      .execute(),
    db
      .selectFrom('scan_issues')
      .selectAll()
      .where(({ exists, selectFrom }) =>
        exists(
          selectFrom(
            sql<{ value: string }>`json_each(scan_issues.node_ids_json)`.as('je'),
          )
            .select(sql<number>`1`.as('one'))
            .where(sql.ref('je.value'), 'in', paths),
        ),
      )
      .execute(),
  ]);

  return {
    nodes,
    links: linkRows.map(rowToLink),
    issues: issueRows.map(rowToIssue),
    total,
    paths: resolved.include,
  };
}

/**
 * Count the nodes in the scoped set (BEFORE the render cap, AFTER
 * override evaluation). Shares the scope predicate with the page-slice
 * query so `total` and `nodes` agree on what "in the branch" means.
 */
async function countBranchNodes(
  db: Kysely<IDatabase>,
  scope: IBranchScope,
): Promise<number> {
  const row = await applyBranchScope(
    db.selectFrom('scan_nodes'),
    scope,
  )
    .select(({ fn }) => fn.countAll<number>().as('c'))
    .executeTakeFirst();
  return Number(row?.c ?? 0);
}

/**
 * Compile the map scope overrides into one flat WHERE
 * (`spec/cli-contract.md` §Map scope overrides, nearest-ancestor-wins):
 *
 *   visible(n) = (NOT rootExcluded AND no exclude matches n)
 *             OR any include i: (i matches n AND no exclude STRICTLY
 *                                under i matches n)
 *
 * The first disjunct is the "no override matches -> default include"
 * case plus every node whose nearest override is the (included) root;
 * it drops entirely when the root is excluded. The second covers nodes
 * whose nearest override is an include: because matching override paths
 * are mutually prefix-ordered, "nearest is `i`" reduces to "no exclude
 * deeper than `i` matches", and excludes NOT under `i` cannot outrank
 * it. The whole-corpus scope (root included, no excludes) applies no
 * WHERE at all, the historical fast path. Includes are redundant in
 * that scope and skipped. Extracted so the count query and the
 * page-slice query stay byte-for-byte identical in their scoping, a
 * drift would surface as `total` disagreeing with the returned node
 * set.
 */
function applyBranchScope<
  Q extends import('kysely').SelectQueryBuilder<IDatabase, 'scan_nodes', object>,
>(query: Q, scope: IBranchScope): Q {
  if (!scope.rootExcluded && scope.exclude.length === 0) return query;
  return query.where(({ eb, or, and, not }) => {
    const terms = [];
    if (!scope.rootExcluded) {
      // Default-include disjunct: no exclude matches the node.
      terms.push(
        and(scope.exclude.map((e) => not(matchesSubtree(eb, e)))),
      );
    }
    for (const include of scope.include) {
      // Nearest-override-is-this-include disjunct. Only excludes
      // STRICTLY under the include can outrank it.
      const deeper = scope.exclude.filter((e) => e.startsWith(`${include}/`));
      terms.push(
        and([
          matchesSubtree(eb, include),
          ...deeper.map((e) => not(matchesSubtree(eb, e))),
        ]),
      );
    }
    return or(terms);
  }) as Q;
}

/**
 * Per-path subtree predicate: `path = p OR path LIKE p || '/%'` (the
 * folder node itself plus every descendant). The `/%` lives in the
 * template, `p` binds separately, so no user input is interpolated into
 * the SQL.
 */
function matchesSubtree(
  eb: import('kysely').ExpressionBuilder<IDatabase, 'scan_nodes'>,
  path: string,
): import('kysely').Expression<import('kysely').SqlBool> {
  return eb.or([
    eb('path', '=', path),
    eb('path', 'like', sql<string>`${path} || '/%'`),
  ]);
}

/**
 * Convert a `scan_nodes` row to its `Node` domain shape. Exported so
 * read-side commands (`sm list`, `sm show`) can reuse the exact mapping
 * used by the incremental scan loader, keeping the two paths byte-aligned
 * with the spec's `node.schema.json`.
 */
// eslint-disable-next-line complexity
export function rowToNode(row: Selectable<IScanNodesTable>): Node {
  const bytes: TripleSplit = {
    frontmatter: row.bytesFrontmatter,
    body: row.bytesBody,
    total: row.bytesTotal,
  };
  // The Node surface no longer carries `title` / `description` /
  // `stability` / `version`. The DB columns stay populated for SQL
  // sorting / faceting; consumers that need the values read them via
  // the canonical sources on the Node, `frontmatter.{name,description}`
  // and `sidecar.annotations.{stability,version}`, both reconstituted
  // below. Read-side commands that prefer the SQL column projection
  // (faster than walking JSON) hit the row directly via the storage
  // adapter, not through `rowToNode`.
  const node: Node = {
    path: row.path,
    kind: row.kind,
    provider: row.provider,
    bodyHash: row.bodyHash,
    frontmatterHash: row.frontmatterHash,
    bytes,
    linksOutCount: row.linksOutCount,
    linksInCount: row.linksInCount,
    externalRefsCount: row.externalRefsCount,
    frontmatter: parseJsonObject(row.frontmatterJson),
    // Step 9.6.2, reconstitute the sidecar overlay from the
    // denormalised columns. Status is trusted as-stored (the kernel
    // wrote it from `computeDriftStatus`); annotations re-parse from
    // the JSON column.
    sidecar: {
      present: row.sidecarPresent === 1,
      status: row.sidecarStatus,
      annotations: row.annotationsJson === null ? null : parseJsonObject(row.annotationsJson),
      // R15 closure (2026-05-07), rehydrate the full parsed root from
      // the sibling JSON column. NULL when no sidecar is present, or
      // when the sidecar failed to parse on the scanning side.
      root: row.sidecarRootJson === null ? null : parseJsonObject(row.sidecarRootJson),
    },
  };
  if (
    row.tokensFrontmatter !== null &&
    row.tokensBody !== null &&
    row.tokensTotal !== null
  ) {
    node.tokens = {
      frontmatter: row.tokensFrontmatter,
      body: row.tokensBody,
      total: row.tokensTotal,
    };
  }
  if (row.externalRefsJson !== null) {
    // The column is kernel-owned: only `nodeToRow` writes it. Shape is
    // `IExternalRef[]` per the emit pipeline. Legacy DBs (pre-migration
    // 004) return NULL and `node.externalRefs` simply stays absent.
    const parsed = JSON.parse(row.externalRefsJson) as IExternalRef[];
    if (Array.isArray(parsed) && parsed.length > 0) node.externalRefs = parsed;
  }
  // File mtime: NULL for virtual / derived nodes (and legacy pre-column
  // rows) leaves `node.modifiedAtMs` absent.
  if (row.modifiedAtMs !== null) node.modifiedAtMs = row.modifiedAtMs;
  // Virtual / derived node identity, round-tripped so a DB-loaded prior
  // recognises synthetic nodes (`mcp://…`) and can carry them forward on a
  // cached scan. `virtual` is set only when true, and `derivedFrom` stays
  // absent for non-virtual nodes, matching the extractor emit shape. Guard on
  // `typeof === 'string'`, NOT `!== null`: a lite/partial projection that
  // omits the column yields `undefined`, and `JSON.parse(undefined)` would
  // throw "'undefined' is not valid JSON".
  if (row.virtual === 1) node.virtual = true;
  if (typeof row.derivedFromJson === 'string') {
    const parsed = JSON.parse(row.derivedFromJson) as string[];
    if (Array.isArray(parsed) && parsed.length > 0) node.derivedFrom = parsed;
  }
  return node;
}

/**
 * Convert a `scan_links` row to its `Link` domain shape. Exported for
 * read-side reuse (`sm show` lists in/out edges).
 */
// eslint-disable-next-line complexity
export function rowToLink(row: Selectable<IScanLinksTable>): Link {
  const ctx = `scan_links source=${row.sourcePath} target=${row.targetPath}`;
  const link: Link = {
    source: row.sourcePath,
    target: row.targetPath,
    kind: parseLinkKind(row.kind, `${ctx}.kind`),
    confidence: parseConfidence(row.confidence, `${ctx}.confidence`),
    sources: parseJsonArray<string>(row.sourcesJson),
  };
  if (row.originalTrigger !== null && row.normalizedTrigger !== null) {
    const trigger: LinkTrigger = {
      originalTrigger: row.originalTrigger,
      normalizedTrigger: row.normalizedTrigger,
    };
    link.trigger = trigger;
  }
  if (row.locationLine !== null) {
    const location: LinkLocation = { line: row.locationLine };
    if (row.locationColumn !== null) location.column = row.locationColumn;
    if (row.locationOffset !== null) location.offset = row.locationOffset;
    link.location = location;
  }
  if (row.occurrencesJson !== null) {
    // Pure JSON.parse, the column is owned by the kernel and only ever
    // populated by `linkToRow`. Shape is `LinkOccurrence[]` per the
    // emit / dedup pipeline; legacy DBs (pre-migration 002) return
    // NULL and `link.occurrences` simply stays absent.
    const parsed = JSON.parse(row.occurrencesJson) as LinkOccurrence[];
    if (Array.isArray(parsed) && parsed.length > 0) link.occurrences = parsed;
  }
  if (row.resolvedTarget !== null) link.resolvedTarget = row.resolvedTarget;
  if (row.raw !== null) link.raw = row.raw;
  return link;
}

/**
 * Convert a `scan_issues` row to its `Issue` domain shape. Exported for
 * read-side reuse (`sm check` and `sm show`).
 */
export function rowToIssue(row: Selectable<IScanIssuesTable>): Issue {
  const issue: Issue = {
    analyzerId: row.analyzerId,
    severity: parseSeverity(row.severity, `scan_issues analyzerId=${row.analyzerId}.severity`),
    nodeIds: parseJsonArray<string>(row.nodeIdsJson),
    message: row.message,
  };
  if (row.linkIndicesJson !== null) {
    issue.linkIndices = parseJsonArray<number>(row.linkIndicesJson);
  }
  if (row.detail !== null) issue.detail = row.detail;
  if (row.fixJson !== null) {
    issue.fix = JSON.parse(row.fixJson) as IssueFix;
  }
  if (row.dataJson !== null) {
    issue.data = JSON.parse(row.dataJson) as Record<string, unknown>;
  }
  return issue;
}

/**
 * Spec § A.9, load the fine-grained Extractor cache as a per-node map
 * from qualified extractor id (`<pluginId>/<id>`) to the run-time
 * hashes the extractor recorded on its last run. Empty map is the
 * default when the table is empty (fresh DB, never-scanned scope, or
 * every extractor has been uninstalled since the last scan).
 *
 * Returned shape: `Map<nodePath, Map<extractorId, IPriorExtractorRun>>`.
 * The inner value carries the body hash AND the sidecar-annotations
 * hash so the orchestrator can apply the widened cache key (both must
 * match for a cache hit).
 */
export interface IPriorExtractorRun {
  bodyHash: string;
  sidecarAnnotationsHash: string;
}

export async function loadExtractorRuns(
  db: Kysely<IDatabase>,
): Promise<Map<string, Map<string, IPriorExtractorRun>>> {
  const rows = await db
    .selectFrom('scan_extractor_runs')
    .select(['nodePath', 'extractorId', 'bodyHashAtRun', 'sidecarAnnotationsHashAtRun'])
    .execute();
  const result = new Map<string, Map<string, IPriorExtractorRun>>();
  for (const row of rows) {
    let perNode = result.get(row.nodePath);
    if (!perNode) {
      perNode = new Map<string, IPriorExtractorRun>();
      result.set(row.nodePath, perNode);
    }
    perNode.set(row.extractorId, {
      bodyHash: row.bodyHashAtRun,
      sidecarAnnotationsHash: row.sidecarAnnotationsHashAtRun,
    });
  }
  return result;
}

/**
 * Spec § A.8, load enrichment rows from `node_enrichments`.
 *
 * Returned in the order required by `mergeNodeWithEnrichments` callers:
 * grouped by `nodePath`, then sorted by `enrichedAt` ASC so a spread
 * merge yields last-write-wins per field. Stale rows are included by
 * default, the read-time merge filters them out (the helper takes
 * `includeStale` for the rare UI case that wants to display them).
 *
 * Pass `nodePath` to filter to a single node's enrichments, used by
 * `sm refresh <node>` to read only the rows it intends to refresh, and
 * by `sm show` to render a single node's overlay.
 */
export async function loadNodeEnrichments(
  db: Kysely<IDatabase>,
  nodePath?: string,
): Promise<IPersistedEnrichment[]> {
  let query = db
    .selectFrom('node_enrichments')
    .select([
      'nodePath',
      'extractorId',
      'bodyHashAtEnrichment',
      'valueJson',
      'stale',
      'enrichedAt',
      'isProbabilistic',
    ])
    .orderBy('nodePath', 'asc')
    .orderBy('enrichedAt', 'asc');
  if (nodePath !== undefined) {
    query = query.where('nodePath', '=', nodePath);
  }
  const rows = await query.execute();
  return rows.map((row) => ({
    nodePath: row.nodePath,
    extractorId: row.extractorId,
    bodyHashAtEnrichment: row.bodyHashAtEnrichment,
    // Audit M3: deep-strip `__proto__` / `constructor` / `prototype`
    // keys at every depth before the value flows into the read-time
    // merge in `mergeNodeWithEnrichments`. AJV at emit time does not
    // forbid these names; without the strip a hostile (or buggy)
    // extractor could persist a nested forbidden key that survived
    // the JSON round-trip and exploited a future deep merge.
    value: stripPrototypePollution(parseJsonObject(row.valueJson)) as Partial<Node>,
    stale: row.stale === 1,
    enrichedAt: row.enrichedAt,
    isProbabilistic: row.isProbabilistic === 1,
  }));
}

function parseJsonObject(s: string | null | undefined): Record<string, unknown> {
  if (s === null || s === undefined) return {};
  const parsed = JSON.parse(s) as unknown;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
}

/**
 * Tolerant of `null` / `undefined`: a missing column on a row from a
 * stale schema (pre-migration DB) shows up here as `undefined` and a
 * NULL JSON column comes through as `null`. Both collapse to `[]`
 * instead of crashing `JSON.parse("undefined")`. The strict shape is
 * still enforced for legitimate values, anything that parses to a
 * non-array also returns `[]`.
 */
function parseJsonArray<T>(s: string | null | undefined): T[] {
  if (s === null || s === undefined) return [];
  const parsed = JSON.parse(s) as unknown;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}
