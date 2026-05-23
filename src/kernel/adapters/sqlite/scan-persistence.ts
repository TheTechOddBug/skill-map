/**
 * `persistScanResult`, driven adapter that writes a `ScanResult` into the
 * `scan_*` tables. Replace-all semantics: every scan is a fresh snapshot,
 * so prior rows are deleted before insert. The whole write happens inside
 * a single transaction so a partial failure leaves the DB on the previous
 * snapshot.
 *
 * Incremental scans (`sm scan --changed`) load the prior snapshot,
 * merge unchanged nodes back in, recompute counts, and call this with
 * the merged ScanResult. The replace-all stays, the merge
 * happens upstream.
 *
 * After the transaction commits we run `PRAGMA wal_checkpoint(TRUNCATE)`
 * to force the WAL contents into the main `.db` file and truncate
 * `<db>-wal` to zero bytes. SQLite only auto-checkpoints once the WAL
 * crosses `wal_autocheckpoint` (default 1000 pages); for typical small
 * scans the WAL never crosses that threshold, so the main `.db` lags
 * arbitrarily far behind and external read-only tools (sqlitebrowser,
 * DBeaver) opening the file see stale state. `sm scan` is a single-
 * writer one-shot, so the truncate cost is negligible (~ms on small
 * DBs) and there are no concurrent readers to contend with.
 */

import { sql, type Insertable, type Kysely, type Transaction } from 'kysely';

import type {
  IEnrichmentRecord,
  IExtractorRunRecord,
  RenameOp,
} from '../../orchestrator.js';
import type { IContributionRecord } from './contributions.js';
import { replaceAllScanContributions } from './contributions.js';
import type { ITagRecord } from './tags.js';
import { replaceAllScanTags } from './tags.js';
import type { Issue, Link, Node, ScanResult } from '../../types.js';
import { STORAGE_TEXTS } from '../../i18n/storage.texts.js';
import { tx } from '../../util/tx.js';
import {
  findStrandedStateOrphans,
  migrateNodeFks,
  type IMigrateNodeFksReport,
} from './history.js';
import type {
  IDatabase,
  INodeEnrichmentsTable,
  IScanExtractorRunsTable,
  IScanIssuesTable,
  IScanLinksTable,
  IScanMetaTable,
  IScanNodesTable,
} from './schema.js';

// Complexity counter ticks up with each optional sweep parameter; the
// algorithm is a single linear flow (rename heuristic → orphan stranding
// detection → replace-all scan zone → contributions sweep → tags →
// favorites). Splitting it into helpers would scatter the txn-bound
// invariant ("everything in one transaction or nothing") for no real
// clarity win.
export async function persistScanResult(
  db: Kysely<IDatabase>,
  result: ScanResult,
  renameOps: RenameOp[] = [],
  extractorRuns: IExtractorRunRecord[] = [],
  enrichments: IEnrichmentRecord[] = [],
  contributions: IContributionRecord[] = [],
  registeredContributionKeys: ReadonlySet<string> = new Set(),
  freshlyRunTuples: ReadonlySet<string> = new Set(),
): Promise<{ renames: IMigrateNodeFksReport[] }> {
  const scannedAt = validateScannedAt(result.scannedAt);

  const renames: IMigrateNodeFksReport[] = [];
  await db.transaction().execute(async (trx) => {
    // Migrate state_* FKs FIRST so a failure here rolls back BEFORE
    // the scan zone is wiped. Rename heuristic guarantees ops are
    // all-or-nothing (per `spec/db-schema.md` §Rename detection); the
    // same tx wraps the whole sequence.
    await applyRenames(trx, renameOps, renames);

    // Orphan persistence. Re-emits an `orphan` issue for every
    // `state_*` row whose `node_id` is no longer in the live set,
    // unless the per-scan rename heuristic already covered it.
    await appendStrandedOrphans(trx, result);

    await replaceAllScanZone(trx, result, scannedAt, extractorRuns);

    // Phase 3 / View contribution system, `scan_contributions`.
    // NOT pure replace-all (the way scan_links / scan_issues are):
    // the watcher's cached-pass leaves the buffer empty for cached
    // nodes (no `extract()` call → no `emitContribution`), so a
    // wipe-all would silently drop their valid prior rows. The
    // adapter does orphan + catalog sweeps + upsert instead. Pass
    // the live node paths so it can drop disappeared-node rows.
    const livePathsForContrib = new Set(result.nodes.map((n) => n.path));
    await replaceAllScanContributions(
      trx,
      contributions,
      livePathsForContrib,
      registeredContributionKeys,
      freshlyRunTuples,
    );

    // Tags · dual-source, `scan_node_tags`. Replace-all per scan;
    // projected from BOTH `frontmatter.tags` (source='author') and
    // `sidecar.annotations.tags` (source='user') for every live node.
    // Cached nodes' tag rows are projected the same way (the cached
    // Node still carries frontmatter + sidecar in memory), so the
    // table stays consistent regardless of cache hit / miss.
    const tagRecords = nodesToTagRecords(result.nodes);
    await replaceAllScanTags(trx, tagRecords, livePathsForContrib);

    // --- A.8 enrichment layer -----------------------------------------------
    // Universal enrichment table is NOT replace-all, probabilistic rows
    // must survive across scans (preserving the LLM cost). The flow is:
    //
    //   1. Drop rows whose `node_path` is no longer in the live set
    //      (the file disappeared and rename migration didn't claim it,
    //      replace-all already handled the equivalent on `scan_nodes`).
    //   2. Migrate `node_path` for high/medium-confidence renames so the
    //      enrichment audit trail tracks the file like `state_*` rows do.
    //   3. Upsert one row per `(nodePath, extractorId)` pair from this
    //      scan's `enrichments[]`. Conflict on the PRIMARY KEY pisar the
    //      prior row (body / value / stale all refresh to current).
    //   4. Sweep probabilistic rows: any prob row whose
    //      `body_hash_at_enrichment` no longer equals the live node's
    //      `body_hash` AND was NOT just upserted → flag `stale = 1`.
    //      Deterministic rows are never stale-flagged: they regenerate
    //      via the A.9 cache on the next scan and pisar via PK conflict.
    await upsertEnrichmentLayer(trx, result, renameOps, enrichments);
    await flagStaleProbabilisticEnrichments(trx, result, enrichments);
  });

  // Force the WAL into the main `.db` file so external read-only tools
  // see the snapshot immediately. Run on the top-level handle, NOT inside
  // the transaction, `wal_checkpoint` is meaningless mid-transaction.
  // `:memory:` doesn't use WAL, so the pragma is a no-op there.
  await sql`PRAGMA wal_checkpoint(TRUNCATE)`.execute(db);

  return { renames };
}

/**
 * Spec contract (`scan-result.schema.json#/properties/scannedAt`):
 * Unix milliseconds, integer ≥ 0. The DB column is INTEGER too, so
 * there's nothing to convert, just guard against malformed callers
 * and return the value unchanged.
 */
function validateScannedAt(scannedAt: number): number {
  if (!Number.isInteger(scannedAt) || scannedAt < 0) {
    throw new Error(
      tx(STORAGE_TEXTS.scanPersistInvalidScannedAt, { value: JSON.stringify(scannedAt) }),
    );
  }
  return scannedAt;
}

/**
 * Walk the per-scan rename ops and migrate every `state_*` row's
 * `node_id` to the new path. Pushes one report per op into the
 * outer `renames` accumulator (the caller surfaces the list to
 * the persist envelope).
 */
async function applyRenames(
  trx: Transaction<IDatabase>,
  renameOps: RenameOp[],
  renames: IMigrateNodeFksReport[],
): Promise<void> {
  for (const op of renameOps) {
    const report = await migrateNodeFks(trx, op.from, op.to);
    renames.push(report);
  }
}

/**
 * Sweep `state_*` for stranded rows whose `node_id` is not in the
 * live set and append an `orphan` issue for each path not already
 * carried by an analyzer-emitted `orphan` issue. Mutates
 * `result.issues` (and `result.stats.issuesCount`) in-place so the
 * augmented list survives into the wire envelope.
 *
 * Without this sweep, a state row stranded by a deletion 2+ scans
 * ago becomes invisible (the `orphan` issue from the deletion-scan
 * disappears with the next replace-all on `scan_issues`), making
 * `sm orphans reconcile` impossible to invoke. Spec language: "the
 * kernel emits an issue (...) until the user runs `sm orphans
 * reconcile` or accepts the orphan", accomplished by re-emitting on
 * every scan as long as the stranded refs persist.
 */
async function appendStrandedOrphans(
  trx: Transaction<IDatabase>,
  result: ScanResult,
): Promise<void> {
  const livePaths = new Set(result.nodes.map((n) => n.path));
  const knownOrphanPaths = collectKnownOrphanPaths(result.issues);
  const stranded = await findStrandedStateOrphans(trx, livePaths);
  for (const path of stranded) {
    if (knownOrphanPaths.has(path)) continue;
    result.issues.push({
      analyzerId: 'orphan',
      severity: 'info',
      nodeIds: [path],
      message: `Orphan history: ${path} has stranded state_* references but no live node.`,
      data: { path },
    });
  }
  result.stats.issuesCount = result.issues.length;
}

function collectKnownOrphanPaths(issues: readonly ScanResult['issues'][number][]): Set<string> {
  const out = new Set<string>();
  for (const issue of issues) {
    if (issue.analyzerId !== 'orphan') continue;
    const dataPath = issue.data?.['path'];
    if (typeof dataPath === 'string') out.add(dataPath);
  }
  return out;
}

/**
 * Replace-all on the four `scan_*` tables, issues, links, nodes, meta
 * plus the fine-grained `scan_extractor_runs` cache. Order: deletes
 * in a fixed sequence (no FKs across these tables today, so the order
 * is just for stable query plans), then inserts. `scan_extractor_runs`
 * is reset together so rows for extractors uninstalled since the last
 * scan disappear automatically; the insert below carries forward only
 * the pairs the orchestrator decided to keep (cached) or freshly ran.
 */
async function replaceAllScanZone(
  trx: Transaction<IDatabase>,
  result: ScanResult,
  scannedAt: number,
  extractorRuns: IExtractorRunRecord[],
): Promise<void> {
  await trx.deleteFrom('scan_issues').execute();
  await trx.deleteFrom('scan_links').execute();
  await trx.deleteFrom('scan_nodes').execute();
  await trx.deleteFrom('scan_meta').execute();
  await trx.deleteFrom('scan_extractor_runs').execute();

  if (result.nodes.length > 0) {
    await trx
      .insertInto('scan_nodes')
      .values(result.nodes.map((n) => nodeToRow(n, scannedAt)))
      .execute();
  }
  if (result.links.length > 0) {
    await trx
      .insertInto('scan_links')
      .values(result.links.map(linkToRow))
      .execute();
  }
  if (result.issues.length > 0) {
    await trx
      .insertInto('scan_issues')
      .values(result.issues.map(issueToRow))
      .execute();
  }
  await trx.insertInto('scan_meta').values(metaToRow(result)).execute();
  if (extractorRuns.length > 0) {
    await trx
      .insertInto('scan_extractor_runs')
      .values(extractorRuns.map(extractorRunToRow))
      .execute();
  }
}

/**
 * Steps 2 + 1 + 3 of the A.8 enrichment layer: migrate `node_path` for
 * renames first (so step 1 doesn't delete what step 2 would have
 * preserved), then drop enrichments whose node disappeared, then upsert
 * the fresh enrichment records carried by this scan.
 *
 * Stale-flagging of probabilistic rows is deliberately a separate
 * helper so this function stays focused on the pisar-the-row path.
 */
async function upsertEnrichmentLayer(
  trx: Transaction<IDatabase>,
  result: ScanResult,
  renameOps: RenameOp[],
  enrichments: IEnrichmentRecord[],
): Promise<void> {
  const enrichmentLivePaths = new Set(result.nodes.map((n) => n.path));

  // Step 2, migrate renames before step 1 would delete them.
  for (const op of renameOps) {
    await trx
      .updateTable('node_enrichments')
      .set({ nodePath: op.to })
      .where('nodePath', '=', op.from)
      .execute();
  }

  // Step 1, drop enrichments whose node disappeared.
  if (enrichmentLivePaths.size > 0) {
    const liveList = [...enrichmentLivePaths];
    await trx
      .deleteFrom('node_enrichments')
      .where('nodePath', 'not in', liveList)
      .execute();
  } else {
    await trx.deleteFrom('node_enrichments').execute();
  }

  // Step 3, upsert fresh enrichments. Composite-PK conflict refreshes
  // every non-key column.
  for (const enrichment of enrichments) {
    const row = enrichmentToRow(enrichment);
    await trx
      .insertInto('node_enrichments')
      .values(row)
      .onConflict((oc) =>
        oc.columns(['nodePath', 'extractorId']).doUpdateSet({
          bodyHashAtEnrichment: row.bodyHashAtEnrichment,
          valueJson: row.valueJson,
          stale: row.stale,
          enrichedAt: row.enrichedAt,
          isProbabilistic: row.isProbabilistic,
        }),
      )
      .execute();
  }
}

/**
 * Step 4 of the A.8 enrichment layer, flag every probabilistic row
 * whose `body_hash_at_enrichment` no longer matches the live node body
 * AND was NOT just upserted by `upsertEnrichmentLayer`. Deterministic
 * rows are never stale-flagged (they regenerate via the A.9 cache on
 * the next scan).
 */
async function flagStaleProbabilisticEnrichments(
  trx: Transaction<IDatabase>,
  result: ScanResult,
  enrichments: IEnrichmentRecord[],
): Promise<void> {
  const refreshedKeys = new Set<string>();
  for (const e of enrichments) {
    refreshedKeys.add(`${e.nodePath}\x00${e.extractorId}`);
  }

  // Probs are sparse (one per LLM-extractor per node), so fetch all
  // and decide in JS, cheap at any practical project size.
  const probRows = await trx
    .selectFrom('node_enrichments')
    .select(['nodePath', 'extractorId', 'bodyHashAtEnrichment', 'stale'])
    .where('isProbabilistic', '=', 1)
    .execute();
  const liveBodyHashByPath = new Map<string, string>();
  for (const node of result.nodes) liveBodyHashByPath.set(node.path, node.bodyHash);

  for (const row of probRows) {
    if (refreshedKeys.has(`${row.nodePath}\x00${row.extractorId}`)) continue;
    const liveBody = liveBodyHashByPath.get(row.nodePath);
    // No live body → already swept by upsertEnrichmentLayer step 1.
    if (liveBody === undefined) continue;
    const shouldBeStale = liveBody !== row.bodyHashAtEnrichment;
    const alreadyStale = row.stale === 1;
    if (shouldBeStale && !alreadyStale) {
      await trx
        .updateTable('node_enrichments')
        .set({ stale: 1 })
        .where('nodePath', '=', row.nodePath)
        .where('extractorId', '=', row.extractorId)
        .execute();
    }
  }
}

/**
 * Project a `Node` to its `scan_nodes` row. The Node surface no
 * longer carries `title` / `description` / `stability` / `version`;
 * the indexed columns project from the canonical sources
 * (`frontmatter` for title/description, sidecar annotations for
 * stability/version) at write time. Columns stay so SQL queries
 * (`--sort-by`, faceted listings) keep working.
 *
 * Split into per-cluster projectors so each helper's `??` /
 * conditional chain stays under the lint cap.
 */
function nodeToRow(node: Node, scannedAt: number): Insertable<IScanNodesTable> {
  const fm = node.frontmatter ?? {};
  return {
    path: node.path,
    kind: node.kind,
    provider: node.provider,
    title: pickString(fm['name']),
    description: pickString(fm['description']),
    ...projectAnnotationColumns(node),
    ...projectSidecarPresence(node),
    ...projectSidecarJson(node),
    frontmatterJson: JSON.stringify(node.frontmatter ?? {}),
    bodyHash: node.bodyHash,
    frontmatterHash: node.frontmatterHash,
    bytesFrontmatter: node.bytes.frontmatter,
    bytesBody: node.bytes.body,
    bytesTotal: node.bytes.total,
    ...projectTokenCounts(node),
    linksOutCount: node.linksOutCount,
    linksInCount: node.linksInCount,
    externalRefsCount: node.externalRefsCount,
    // JSON-serialise the per-URL array. NULL when absent / empty so
    // the column stays sparse for nodes whose bodies have no http(s)
    // URLs at all. Round-tripped by `rowToNode` on load.
    externalRefsJson:
      node.externalRefs && node.externalRefs.length > 0
        ? JSON.stringify(node.externalRefs)
        : null,
    scannedAt,
  };
}

function projectAnnotationColumns(
  node: Node,
): Pick<Insertable<IScanNodesTable>, 'stability' | 'version'> {
  const ann = node.sidecar?.annotations ?? {};
  return {
    stability: pickStability(ann['stability']),
    version: pickIntegerVersion(ann['version']),
  };
}

/**
 * Step 9.6.2, sidecar denormalisation. `node.sidecar` may be absent
 * on legacy / test-built nodes; treat that as "no sidecar
 * information available", which lands as `sidecar_present = 0`.
 */
function projectSidecarPresence(
  node: Node,
): Pick<Insertable<IScanNodesTable>, 'sidecarPresent' | 'sidecarStatus'> {
  return {
    sidecarPresent: node.sidecar?.present ? 1 : 0,
    sidecarStatus: node.sidecar?.status ?? null,
  };
}

/**
 * R15 closure (2026-05-07), persist the full parsed YAML root so
 * `rowToNode` can rehydrate `sidecar.root` on read. NULL when no
 * sidecar is present or when the sidecar failed to parse (kernel
 * sets `node.sidecar.root = null` in both cases).
 */
function projectSidecarJson(
  node: Node,
): Pick<Insertable<IScanNodesTable>, 'annotationsJson' | 'sidecarRootJson'> {
  const ann = node.sidecar?.annotations;
  const root = node.sidecar?.root;
  return {
    annotationsJson:
      ann && Object.keys(ann).length > 0 ? JSON.stringify(ann) : null,
    sidecarRootJson:
      root && Object.keys(root).length > 0 ? JSON.stringify(root) : null,
  };
}

function projectTokenCounts(
  node: Node,
): Pick<Insertable<IScanNodesTable>, 'tokensFrontmatter' | 'tokensBody' | 'tokensTotal'> {
  return {
    tokensFrontmatter: node.tokens?.frontmatter ?? null,
    tokensBody: node.tokens?.body ?? null,
    tokensTotal: node.tokens?.total ?? null,
  };
}

/** Coerce to a non-empty string or `null`. */
function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Project `annotations.stability` to a row column value (enum or null). */
function pickStability(v: unknown): 'experimental' | 'stable' | 'deprecated' | null {
  return v === 'experimental' || v === 'stable' || v === 'deprecated' ? v : null;
}

/** Project `annotations.version` to a row column value (integer ≥ 1 or null). */
function pickIntegerVersion(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null;
}

/**
 * Project tag rows for every live node. One row per `(node_path, tag,
 * source)` triple, gathered from BOTH `frontmatter.tags` (with
 * `source='author'`) and `sidecar.annotations.tags` (with
 * `source='user'`). Per-node intra-source dedup (same tag string twice
 * in the same array = one row); the same tag MAY appear under both
 * sources for the same node (the PK accepts the pair).
 */
function nodesToTagRecords(nodes: readonly Node[]): ITagRecord[] {
  const records: ITagRecord[] = [];
  for (const node of nodes) {
    pushTagRecords(records, node.path, node.frontmatter?.['tags'], 'author');
    pushTagRecords(records, node.path, node.sidecar?.annotations?.['tags'], 'user');
  }
  return records;
}

function pushTagRecords(
  out: ITagRecord[],
  nodePath: string,
  raw: unknown,
  source: 'author' | 'user',
): void {
  if (!Array.isArray(raw)) return;
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string' || item.length === 0) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push({ nodePath, tag: item, source });
  }
}

function linkToRow(link: Link): Insertable<IScanLinksTable> {
  return {
    sourcePath: link.source,
    targetPath: link.target,
    kind: link.kind,
    confidence: link.confidence,
    sourcesJson: JSON.stringify(link.sources),
    ...projectLinkTrigger(link),
    ...projectLinkLocation(link),
    // JSON-serialise the per-occurrence array. NULL when absent / empty
    // so the column stays sparse for synthetic links (frontmatter /
    // sidecar) that carry no body position.
    occurrencesJson:
      link.occurrences && link.occurrences.length > 0
        ? JSON.stringify(link.occurrences)
        : null,
    resolvedTarget: link.resolvedTarget ?? null,
    raw: link.raw ?? null,
  };
}

function projectLinkTrigger(
  link: Link,
): Pick<Insertable<IScanLinksTable>, 'originalTrigger' | 'normalizedTrigger'> {
  return {
    originalTrigger: link.trigger?.originalTrigger ?? null,
    normalizedTrigger: link.trigger?.normalizedTrigger ?? null,
  };
}

function projectLinkLocation(
  link: Link,
): Pick<Insertable<IScanLinksTable>, 'locationLine' | 'locationColumn' | 'locationOffset'> {
  return {
    locationLine: link.location?.line ?? null,
    locationColumn: link.location?.column ?? null,
    locationOffset: link.location?.offset ?? null,
  };
}

function metaToRow(result: ScanResult): Insertable<IScanMetaTable> {
  return {
    id: 1,
    rootsJson: JSON.stringify(result.roots),
    scannedAt: result.scannedAt,
    scannedByName: result.scannedBy?.name ?? 'skill-map',
    scannedByVersion: result.scannedBy?.version ?? 'unknown',
    scannedBySpecVersion: result.scannedBy?.specVersion ?? 'unknown',
    providersJson: JSON.stringify(result.providers),
    statsFilesWalked: result.stats.filesWalked,
    statsFilesSkipped: result.stats.filesSkipped,
    statsDurationMs: result.stats.durationMs,
  };
}

function extractorRunToRow(
  record: IExtractorRunRecord,
): Insertable<IScanExtractorRunsTable> {
  return {
    nodePath: record.nodePath,
    extractorId: record.extractorId,
    bodyHashAtRun: record.bodyHashAtRun,
    ranAt: record.ranAt,
    sidecarAnnotationsHashAtRun: record.sidecarAnnotationsHashAtRun,
  };
}

function enrichmentToRow(
  record: IEnrichmentRecord,
): Insertable<INodeEnrichmentsTable> {
  return {
    nodePath: record.nodePath,
    extractorId: record.extractorId,
    bodyHashAtEnrichment: record.bodyHashAtEnrichment,
    valueJson: JSON.stringify(record.value ?? {}),
    stale: 0,
    enrichedAt: record.enrichedAt,
    isProbabilistic: record.isProbabilistic ? 1 : 0,
  };
}

function issueToRow(issue: Issue): Insertable<IScanIssuesTable> {
  return {
    analyzerId: issue.analyzerId,
    severity: issue.severity,
    nodeIdsJson: JSON.stringify(issue.nodeIds),
    linkIndicesJson:
      issue.linkIndices && issue.linkIndices.length > 0
        ? JSON.stringify(issue.linkIndices)
        : null,
    message: issue.message,
    detail: issue.detail ?? null,
    fixJson: issue.fix ? JSON.stringify(issue.fix) : null,
    dataJson: issue.data ? JSON.stringify(issue.data) : null,
  };
}
