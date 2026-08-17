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
 *
 * Whole-result fingerprint short-circuit: a fully-warm incremental scan
 * produces a result byte-identical to the stored snapshot, so rewriting
 * every `scan_*` row is pure waste. The persist computes a sha256 over
 * the canonical persisted content (`computeResultFingerprint`), compares
 * it with `scan_meta.result_fingerprint`, and when they match AND no
 * out-of-band inputs ride along (renames, enrichments), only the
 * `scan_meta` row refreshes (so `scanned_at` / duration still advance).
 * Any difference anywhere takes the full replace-all path; correctness
 * never depends on the skip.
 */

import { createHash } from 'node:crypto';

import { sql, type Insertable, type Kysely, type Transaction } from 'kysely';

import type {
  IEnrichmentRecord,
  IExtractorRunRecord,
  RenameOp,
} from '../../orchestrator.js';
import type {
  IContributionErrorRecord,
  IContributionRecord,
} from './contributions.js';
import {
  replaceAllScanContributionErrors,
  replaceAllScanContributions,
} from './contributions.js';
import type { IConfidenceAdjustment } from './link-scores.js';
import { replaceAllScanLinkScores } from './link-scores.js';
import { isNodelessTargetId } from '../../jobs/nodeless-target.js';
import { schemaFingerprint } from './schema-fingerprint.js';
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

/**
 * Optional side inputs `persistScanResult` writes alongside the core
 * `ScanResult`. Bundled into one bag (rather than a long positional
 * default list) so the function stays under the cyclomatic cap: each
 * default-valued parameter would count as a branch, and the persist
 * surface keeps growing (the latest addition is `linkScores`). Every
 * field is optional; `resolvePersistInputs` fills the empties so the
 * transaction body reads a fully-populated record. Mirror of the
 * `IPersistOptions` bag one layer up in `kernel/types/storage.ts`.
 */
export interface IPersistScanInputs {
  renameOps?: RenameOp[];
  extractorRuns?: IExtractorRunRecord[];
  enrichments?: IEnrichmentRecord[];
  contributions?: IContributionRecord[];
  registeredContributionKeys?: ReadonlySet<string>;
  freshlyRunTuples?: ReadonlySet<string>;
  /** View contributions REJECTED at emit time, surfaced by doctor. */
  contributionErrors?: IContributionErrorRecord[];
  /** Per-op confidence-attribution audit trail (`scan_link_scores`). */
  linkScores?: readonly IConfidenceAdjustment[];
}

/**
 * Refresh ONE node's denormalized `scan_nodes.annotations_json` mirror
 * from its just-written `.sm` annotations (`spec/db-schema.md`
 * §state_findings, read-time suppression lens). The write-through half of
 * `sm findings dismiss` / `undismiss`: the sidecar stays the source of
 * truth, this keeps the column fresh so read surfaces (the findings view,
 * the card counters) never need per-node file reads; `sm scan` remains the
 * wholesale refresher (a hand-edited `.sm` reconciles at the next scan).
 * `null` clears the column. A path not in the scan is a no-op.
 */
export async function updateNodeAnnotations(
  db: Kysely<IDatabase>,
  path: string,
  annotations: Record<string, unknown> | null,
): Promise<void> {
  await db
    .updateTable('scan_nodes')
    .set({ annotationsJson: annotations === null ? null : JSON.stringify(annotations) })
    .where('path', '=', path)
    .execute();
}

/**
 * Persist a scan into the `scan_*` / `state_*` zones inside one
 * transaction. The algorithm is a single linear flow (rename heuristic →
 * orphan stranding → replace-all scan zone → contribution sweeps →
 * link-score / tag replace-all → enrichment layer); the optional side
 * inputs ride in `inputs` so the signature stays under the complexity cap.
 */
export async function persistScanResult(
  db: Kysely<IDatabase>,
  result: ScanResult,
  inputs: IPersistScanInputs = {},
): Promise<{ renames: IMigrateNodeFksReport[] }> {
  const scannedAt = validateScannedAt(result.scannedAt);
  const resolved = resolvePersistInputs(inputs);
  const {
    renameOps,
    extractorRuns,
    enrichments,
    contributions,
    registeredContributionKeys,
    freshlyRunTuples,
    contributionErrors,
    linkScores,
  } = resolved;

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

    // Whole-result fingerprint (module doc): computed AFTER the orphan
    // sweep (which mutates `result.issues`) so identical inputs always
    // hash identically. On a match with no out-of-band inputs, refresh
    // ONLY `scan_meta` (scanned_at / duration advance, single-row
    // invariant holds) and keep the stale-flag sweep, which depends on
    // stored rows, not on this scan's writes.
    const fp = computeResultFingerprint(result, resolved);
    const stored = await readStoredResultFingerprint(trx);
    if (canSkipPersist(stored, fp, resolved)) {
      await trx
        .updateTable('scan_meta')
        .set(metaToRow(result, fp))
        .where('id', '=', 1)
        .execute();
      await flagStaleProbabilisticEnrichments(trx, result, enrichments);
      return;
    }

    await replaceAllScanZone(trx, result, scannedAt, extractorRuns, fp);

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

    // "off-shape visible" follow-up, `scan_contribution_errors`. Plain
    // REPLACE-ALL (delete all, then insert), unlike the sweep model
    // above: a rejected emission is a transient finding re-derived in
    // full on every scan, so there is no cached row to preserve.
    await replaceAllScanContributionErrors(trx, contributionErrors);

    // Confidence-attribution audit trail, `scan_link_scores`. Plain
    // REPLACE-ALL, same posture as `scan_contribution_errors`: each row
    // is one attributed `adjustConfidence` op a `score`-phase analyzer
    // emitted this scan, re-derived in full on every analyzer pass. The
    // fold into `link.confidence` already happened upstream; this only
    // PERSISTS the per-op attribution ("why is this link at X?").
    await replaceAllScanLinkScores(trx, linkScores);

    // Tags · single-source, `scan_node_tags`. Replace-all per scan;
    // projected from `sidecar.annotations.tags` (the only tag source)
    // for every live node. Cached nodes' tag rows are projected the
    // same way (the cached Node still carries its sidecar in memory),
    // so the table stays consistent regardless of cache hit / miss.
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
 * Fill every optional side input with its empty default so the persist
 * transaction body reads a fully-populated record. Object-spread merge
 * (not per-field `??`) keeps the cyclomatic count at 1, the same trick
 * `applyPersistDefaults` uses one layer up. Fresh `[]` / `new Set()`
 * instances per call so a consumer that mutates an accumulator cannot
 * leak state into a later persist.
 */
function resolvePersistInputs(inputs: IPersistScanInputs): Required<IPersistScanInputs> {
  return {
    renameOps: [],
    extractorRuns: [],
    enrichments: [],
    contributions: [],
    registeredContributionKeys: new Set(),
    freshlyRunTuples: new Set(),
    contributionErrors: [],
    linkScores: [],
    ...inputs,
  };
}

/**
 * Streaming sink for the canonical serialisation: fragments accumulate
 * into a bounded buffer that flushes into the running sha256. The
 * canonical text of a real corpus runs to megabytes; materialising it
 * as ONE string per scan was a measured top-3 warm-scan cost (~50 ms
 * serialise + GC churn on 1k nodes), so the writer streams instead.
 */
const FP_CHUNK_CHARS = 1 << 16;

interface ICanonicalSink {
  push(fragment: string): void;
}

/**
 * Deterministic JSON serialisation, streamed: object keys sorted,
 * arrays in order, `undefined` object entries dropped (mirroring
 * `JSON.stringify`). The fingerprint input must not depend on property
 * insertion order, which varies with the code path that built a
 * record. Emits byte-identical text to a key-sorted `JSON.stringify`.
 */
function writeCanonical(value: unknown, sink: ICanonicalSink): void {
  if (value === null || typeof value !== 'object') {
    sink.push(JSON.stringify(value) ?? 'null');
    return;
  }
  if (Array.isArray(value)) {
    sink.push('[');
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) sink.push(',');
      writeCanonical(value[i], sink);
    }
    sink.push(']');
    return;
  }
  writeCanonicalObject(value as Record<string, unknown>, sink);
}

function writeCanonicalObject(value: Record<string, unknown>, sink: ICanonicalSink): void {
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  sink.push('{');
  for (let i = 0; i < entries.length; i += 1) {
    if (i > 0) sink.push(',');
    sink.push(`${JSON.stringify(entries[i]![0])}:`);
    writeCanonical(entries[i]![1], sink);
  }
  sink.push('}');
}

/**
 * Meta content that participates in the fingerprint: everything
 * `metaToRow` writes EXCEPT the per-invocation volatile columns
 * (`scannedAt`, `statsDurationMs`) and the two fingerprints themselves
 * (`schemaFingerprint` is a build constant; `resultFingerprint` is the
 * output). Derived from the row itself so a future meta column
 * automatically participates unless explicitly excluded here.
 */
function metaContentForFingerprint(result: ScanResult): Record<string, unknown> {
  const {
    scannedAt: _scannedAt,
    statsDurationMs: _durationMs,
    schemaFingerprint: _schemaFp,
    resultFingerprint: _resultFp,
    ...content
  } = metaToRow(result, null);
  return content;
}

/**
 * sha256 over the canonical persisted content of a scan, in fixed
 * order: nodes, links, issues (AFTER the stranded-orphan sweep),
 * extractor runs WITHOUT `ranAt` (stamped `Date.now()` every scan and
 * never read back), contributions, contribution errors, link scores,
 * the projected tag records, the meta content tuple, and the sorted
 * registered-contribution catalog. Everything the full persist path
 * writes is either covered here or excluded by the skip gate
 * (`canSkipPersist`): renames and enrichments are out-of-band inputs
 * that force the full path regardless of the fingerprint.
 */
function computeResultFingerprint(
  result: ScanResult,
  inputs: Required<IPersistScanInputs>,
): string {
  const runsSansRanAt = inputs.extractorRuns.map(({ ranAt: _ranAt, ...rest }) => rest);
  // `emittedAt` is canonicalized OUT of contributions and contribution
  // errors for the same reason `ranAt` is out of extractor runs: it is
  // a wall-clock provenance stamp refreshed on every emission, never
  // read back for decisions, and explicitly excluded from what the BFF
  // hands the UI (`server/routes/contributions.ts`, `routes/plugins.ts`);
  // its only consumer is a stable-sort tiebreak in the doctor listing.
  // Keeping it in the input would make the fingerprint never match.
  const contribsSansEmittedAt = inputs.contributions.map(({ emittedAt: _e, ...rest }) => rest);
  const errorsSansEmittedAt = inputs.contributionErrors.map(({ emittedAt: _e, ...rest }) => rest);
  const composite = [
    result.nodes,
    result.links,
    result.issues,
    runsSansRanAt,
    contribsSansEmittedAt,
    errorsSansEmittedAt,
    inputs.linkScores,
    nodesToTagRecords(result.nodes),
    metaContentForFingerprint(result),
    [...inputs.registeredContributionKeys].sort(),
    // The freshly-run tuple set participates as CONTENT (not as a gate
    // veto): the contribution sweep is a deterministic function of
    // (buffer, catalog, tuples, stored state), so identical tuples with
    // identical emissions reproduce the stored state exactly and the
    // skip is safe. Analyzers re-run every scan and register their
    // tuples unconditionally, so a "tuples must be empty" gate would
    // never engage on the warm scans this short-circuit exists for; any
    // CHANGE in the tuple set changes the fingerprint and takes the
    // full path.
    [...inputs.freshlyRunTuples].sort(),
  ];
  const hash = createHash('sha256');
  let buffer = '';
  writeCanonical(composite, {
    push(fragment: string): void {
      buffer += fragment;
      if (buffer.length >= FP_CHUNK_CHARS) {
        hash.update(buffer, 'utf8');
        buffer = '';
      }
    },
  });
  if (buffer.length > 0) hash.update(buffer, 'utf8');
  return hash.digest('hex');
}

async function readStoredResultFingerprint(
  trx: Transaction<IDatabase>,
): Promise<string | null> {
  const row = await trx
    .selectFrom('scan_meta')
    .select('resultFingerprint')
    .where('id', '=', 1)
    .executeTakeFirst();
  return row?.resultFingerprint ?? null;
}

/**
 * The skip gate (module doc). A stored fingerprint match alone is not
 * enough: renames migrate `state_*` FKs and enrichments upsert rows,
 * both OUTSIDE the fingerprinted scan zone, so either forces the full
 * path regardless of the match. The freshly-run tuple set is NOT gated
 * here; it participates in the fingerprint itself (see
 * `computeResultFingerprint`), so a tuple-set change surfaces as a
 * fingerprint mismatch.
 */
function canSkipPersist(
  stored: string | null,
  fp: string,
  inputs: Required<IPersistScanInputs>,
): boolean {
  return (
    stored !== null &&
    stored === fp &&
    inputs.renameOps.length === 0 &&
    inputs.enrichments.length === 0
  );
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
 * carried by an analyzer-emitted `orphan` issue. Synthetic nodeless-job
 * targets are skipped: they are infrastructure ids, never nodes. Mutates
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
    // A NODELESS job's synthetic target (`sm://<extension-id>`,
    // `spec/job-lifecycle.md` §Submit · Nodeless submit) is not a node
    // that went missing: it never was one, and no `sm orphans reconcile`
    // can ever "fix" it. Reporting it would hand the operator an orphan
    // they cannot act on, once per scan, forever.
    if (isNodelessTargetId(path)) continue;
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
/**
 * SQLite caps the number of bound `?` variables per statement
 * (`SQLITE_MAX_VARIABLE_NUMBER`, 32766 since SQLite 3.32). A scan now
 * carries up to `scan.maxScan` nodes (default 5000), and a single
 * multi-row INSERT binds `rows * columns` variables, so one statement
 * would blow the cap well before the ceiling. Chunk every batch write
 * so `rows-per-statement * columns` stays comfortably under the limit.
 * (With the historical 256-node cap this never tripped; 256 rows fit in
 * one statement.)
 */
const MAX_SQL_VARS = 20000;

async function chunkedInsert<TB extends keyof IDatabase & string>(
  trx: Transaction<IDatabase>,
  table: TB,
  rows: ReadonlyArray<Insertable<IDatabase[TB]>>,
): Promise<void> {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0] as Record<string, unknown>).length || 1;
  // Capped at 250 rows per statement (well under the variable limit for
  // every current table): full chunks share identical SQL text, so the
  // driver's statement cache reuses one prepared statement per table
  // instead of compiling a fresh ~20k-placeholder giant every scan, and
  // the per-call argument spreads stay small.
  const batchSize = Math.max(1, Math.min(250, Math.floor(MAX_SQL_VARS / columns)));
  for (let start = 0; start < rows.length; start += batchSize) {
    await trx
      .insertInto(table)
      .values(rows.slice(start, start + batchSize))
      .execute();
  }
}

async function replaceAllScanZone(
  trx: Transaction<IDatabase>,
  result: ScanResult,
  scannedAt: number,
  extractorRuns: IExtractorRunRecord[],
  resultFingerprint: string | null,
): Promise<void> {
  await trx.deleteFrom('scan_issues').execute();
  await trx.deleteFrom('scan_links').execute();
  await trx.deleteFrom('scan_nodes').execute();
  await trx.deleteFrom('scan_meta').execute();
  await trx.deleteFrom('scan_extractor_runs').execute();

  await chunkedInsert(trx, 'scan_nodes', result.nodes.map((n) => nodeToRow(n, scannedAt)));
  await chunkedInsert(trx, 'scan_links', result.links.map(linkToRow));
  await chunkedInsert(trx, 'scan_issues', result.issues.map(issueToRow));
  await trx.insertInto('scan_meta').values(metaToRow(result, resultFingerprint)).execute();
  await chunkedInsert(trx, 'scan_extractor_runs', extractorRuns.map(extractorRunToRow));
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

  // Step 1, drop enrichments whose node disappeared. Compute the dead
  // set in JS and delete it in chunks: a `NOT IN` against the full live
  // list would bind up to `scan.maxScan` variables (default 5000) and
  // blow the SQLite cap. node_enrichments is usually empty / small (the
  // probabilistic layer), so the distinct read is cheap.
  const existingEnrichmentPaths = await trx
    .selectFrom('node_enrichments')
    .select('nodePath')
    .distinct()
    .execute();
  const deadEnrichmentPaths = existingEnrichmentPaths
    .map((r) => r.nodePath)
    .filter((p) => !enrichmentLivePaths.has(p));
  for (let start = 0; start < deadEnrichmentPaths.length; start += MAX_SQL_VARS) {
    await trx
      .deleteFrom('node_enrichments')
      .where('nodePath', 'in', deadEnrichmentPaths.slice(start, start + MAX_SQL_VARS))
      .execute();
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
    // File mtime (Unix ms) from the walker; NULL for virtual / derived
    // nodes that carry no backing file. Round-tripped by `rowToNode`.
    modifiedAtMs: node.modifiedAtMs ?? null,
    ...projectVirtualColumns(node),
  };
}

/**
 * Virtual / derived node identity. Round-tripped by `rowToNode` so a
 * DB-loaded prior can recognise synthetic nodes (e.g. `mcp://<server>` from a
 * skill's `tools:` frontmatter) and carry them forward across a cached scan
 * whose only source is a cache hit.
 */
function projectVirtualColumns(
  node: Node,
): Pick<Insertable<IScanNodesTable>, 'virtual' | 'derivedFromJson'> {
  return {
    virtual: node.virtual === true ? 1 : 0,
    derivedFromJson:
      node.derivedFrom && node.derivedFrom.length > 0 ? JSON.stringify(node.derivedFrom) : null,
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
 * Project tag rows for every live node. One row per `(node_path, tag)`
 * pair, gathered from the node's `sidecar.annotations.tags` (the only
 * tag source). Per-node dedup (same tag string twice in the same array
 * = one row).
 */
function nodesToTagRecords(nodes: readonly Node[]): ITagRecord[] {
  const records: ITagRecord[] = [];
  for (const node of nodes) {
    pushTagRecords(records, node.path, node.sidecar?.annotations?.['tags']);
  }
  return records;
}

function pushTagRecords(out: ITagRecord[], nodePath: string, raw: unknown): void {
  if (!Array.isArray(raw)) return;
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string' || item.length === 0) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push({ nodePath, tag: item });
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

function metaToRow(
  result: ScanResult,
  resultFingerprint: string | null,
): Insertable<IScanMetaTable> {
  return {
    id: 1,
    rootsJson: JSON.stringify(result.roots),
    scannedAt: result.scannedAt,
    scannedByName: result.scannedBy?.name ?? 'skill-map',
    scannedByVersion: result.scannedBy?.version ?? 'unknown',
    scannedBySpecVersion: result.scannedBy?.specVersion ?? 'unknown',
    // Schema-drift fingerprint: sha256 over the bundled migration DDL.
    // Sibling of `scannedByVersion`, the second drift axis the next
    // write-side open compares (see spec/db-schema.md §Schema drift
    // (pre-1.0)). Internal DB metadata, never on the ScanResult wire.
    schemaFingerprint: schemaFingerprint(),
    // Whole-result fingerprint (module doc). NULL on synthetic writes
    // that bypass `persistScanResult`'s fingerprint path.
    resultFingerprint,
    providersJson: JSON.stringify(result.providers),
    statsFilesWalked: result.stats.filesWalked,
    statsFilesSkipped: result.stats.filesSkipped,
    statsDurationMs: result.stats.durationMs,
    ...projectInvalidationColumns(result),
    ...projectNodeLimitColumns(result),
    ...projectOversizedColumns(result),
  };
}

/**
 * Project the two SCAN-WIDE inputs the next incremental scan compares
 * before reusing this snapshot. Both are NULL on synthetic results that
 * bypass the orchestrator, and a NULL prior reads as "changed", so the
 * next scan rebuilds rather than trusting an unknown provenance.
 *
 *   - `tokenizer`: the encoder that produced the per-node token counts
 *     (`project-config.schema.json` §tokenizer). A different encoder
 *     forces a token recompute.
 *   - `activeProvider`: the lens the corpus was classified under
 *     (`spec/architecture.md` §Provider dispatch). A different lens
 *     forces a re-classification of every node.
 */
function projectInvalidationColumns(
  result: ScanResult,
): Pick<Insertable<IScanMetaTable>, 'tokenizer' | 'activeProvider'> {
  return {
    tokenizer: result.tokenizer ?? null,
    activeProvider: result.activeProvider ?? null,
  };
}

/**
 * Project the file-size skip envelope onto its `scan_meta` columns.
 * `filesOversized` falls back to `oversizedFiles.length` (and then 0)
 * so a result that carries the array but not the stat still persists a
 * consistent count. `oversizedFilesJson` stays NULL when nothing was
 * skipped so the column is sparse on the common path.
 */
function projectOversizedColumns(
  result: ScanResult,
): Pick<Insertable<IScanMetaTable>, 'filesOversized' | 'oversizedFilesJson'> {
  const oversized = result.oversizedFiles ?? [];
  return {
    filesOversized: result.stats.filesOversized ?? oversized.length,
    oversizedFilesJson: oversized.length > 0 ? JSON.stringify(oversized) : null,
  };
}

/**
 * Project the scan-ceiling / render-cap envelope onto its `scan_meta`
 * columns. Fallback to the design defaults (corpus ceiling 5000, render
 * cap 256, not truncated) on synthetic fixtures that bypass the walker;
 * the walker always sets `scanCeiling` / `scanTruncated` / `maxRenderNodes`
 * for real scans (see `walkAndExtract`).
 */
function projectNodeLimitColumns(
  result: ScanResult,
): Pick<Insertable<IScanMetaTable>, 'scanCeiling' | 'scanTruncated' | 'maxRenderNodes'> {
  return {
    scanCeiling: result.scanCeiling ?? 5000,
    scanTruncated: result.scanTruncated ? 1 : 0,
    maxRenderNodes: result.maxRenderNodes ?? 256,
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
    settingsHashAtRun: record.settingsHashAtRun,
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
