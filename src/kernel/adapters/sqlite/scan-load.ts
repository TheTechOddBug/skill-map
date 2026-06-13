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

import type { Kysely } from 'kysely';

import type { IPersistedEnrichment } from '../../orchestrator.js';
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
    const scannedBy: ScanScannedBy = {
      name: metaRow.scannedByName,
      version: metaRow.scannedByVersion,
      specVersion: metaRow.scannedBySpecVersion,
    };
    // Reconstruct the file-size skip envelope. `oversized_files_json`
    // is kernel-owned (only `metaToRow` writes it); NULL / legacy rows
    // come back as `[]`. The count column defaults to 0 in SQL, so it
    // stays consistent even on pre-feature DBs.
    const oversizedFiles = parseJsonArray<OversizedFile>(metaRow.oversizedFilesJson);
    return {
      schemaVersion: 1,
      scannedAt: metaRow.scannedAt,
      roots: parseJsonArray<string>(metaRow.rootsJson),
      providers: parseJsonArray<string>(metaRow.providersJson),
      scannedBy,
      // Resolved encoder of the prior scan (see project-config.schema.json
      // §tokenizer). NULL column → `undefined` domain field; the
      // orchestrator's tokenizer-change check compares this against the
      // freshly-resolved encoder and treats a missing prior value as a
      // change (forcing a token recompute).
      ...(metaRow.tokenizer !== null ? { tokenizer: metaRow.tokenizer } : {}),
      recommendedNodeLimit: metaRow.recommendedNodeLimit,
      overrideMaxNodes: metaRow.overrideMaxNodes,
      oversizedFiles,
      nodes,
      links,
      issues,
      stats: {
        filesWalked: metaRow.statsFilesWalked,
        filesSkipped: metaRow.statsFilesSkipped,
        filesOversized: metaRow.filesOversized,
        nodesCount: nodes.length,
        linksCount: links.length,
        issuesCount: issues.length,
        durationMs: metaRow.statsDurationMs,
      },
    };
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
    // Synthetic envelope, default to the design cap (256) so SPA reads
    // the same shape across cold-boot and pre-cap-aware DBs. A real
    // scan overwrites scan_meta with the live values on next run.
    recommendedNodeLimit: 256,
    overrideMaxNodes: null,
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
