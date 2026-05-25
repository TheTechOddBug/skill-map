/**
 * Scan main loop. For each provider × raw node: hash body, classify,
 * resolve sidecar, compute the per-(node, extractor) cache decision,
 * dispatch to the full-cache-hit branch or the extract-path branch,
 * and record the resulting `scan_extractor_runs` rows.
 *
 * The cache decision lives in `./cache.js`, the per-node extractor
 * invocation in `./extractors.js`, the fresh-node construction (plus
 * frontmatter validation) in `./node-build.js`. This file orchestrates
 * them.
 */

// js-tiktoken ships CJS subpaths without explicit `.cjs` in the import
// specifier; type-only imports survive lint without the disable that
// the value-import sites need.
import type { Tiktoken } from 'js-tiktoken/lite';

import type { TPluginStore } from '../adapters/plugin-store.js';
import type { IProviderFrontmatterValidator } from '../adapters/schema-validators.js';
import type { IPriorExtractorRun } from '../adapters/sqlite/scan-load.js';
import type { IContributionRecord } from '../adapters/sqlite/contributions.js';
import { makeEvent } from '../extensions/hook-dispatcher.js';
import {
  resolveProviderWalk,
  type IExtractor,
  type IProvider,
  type IRawNode,
} from '../extensions/index.js';
import type {
  ProgressEmitterPort,
} from '../ports/progress-emitter.js';
import { qualifiedExtensionId } from '../registry.js';
import type { IIgnoreFilter } from '../scan/ignore.js';
import {
  discoverOrphanSidecars,
  type IOrphanSidecar,
} from '../sidecar/index.js';
import type { Issue, Link, Node, ScanResult, Signal } from '../types.js';
import {
  cloneNodeAndReshapeLinks,
  computeCacheDecision,
  reusePriorNode,
  type IPriorIndex,
} from './cache.js';
import {
  runExtractorsForNode,
  type IEnrichmentRecord,
  type IExtractorRunRecord,
} from './extractors.js';
import {
  buildFreshNodeAndValidateFrontmatter,
  canonicalFrontmatter,
  canonicalSidecarAnnotations,
  resolveSidecarOverlay,
  sha256,
} from './node-build.js';

export interface IWalkAndExtractOptions {
  providers: IProvider[];
  extractors: IExtractor[];
  roots: string[];
  ignoreFilter?: IIgnoreFilter;
  emitter: ProgressEmitterPort;
  encoder: Tiktoken | null;
  strict: boolean;
  enableCache: boolean;
  prior: ScanResult | null;
  priorIndex: IPriorIndex;
  /**
   * Spec § A.9, fine-grained Extractor cache breadcrumbs from the
   * prior scan, keyed `nodePath → qualifiedExtractorId →
   * IPriorExtractorRun`. `undefined` opts out of the fine-grained
   * path (legacy callers that don't track the cache); the orchestrator
   * falls back to the pre-A.9 node-level cache check.
   */
  priorExtractorRuns: Map<string, Map<string, IPriorExtractorRun>> | undefined;
  providerFrontmatter: IProviderFrontmatterValidator;
  /**
   * Spec § A.12, per-plugin `ctx.store` wrappers, keyed by `pluginId`.
   * Threaded through to `runExtractorsForNode → buildExtractorContext`
   * unchanged. `undefined` keeps `ctx.store` undefined for every
   * extractor (the legacy contract).
   */
  pluginStores: ReadonlyMap<string, TPluginStore> | undefined;
  /**
   * Active provider lens for this scan, resolved upstream from project
   * config + filesystem auto-detect. `null` when no lens is resolvable.
   * Threaded into `computeCacheDecision` so provider-specific extractors
   * run when the active lens is in their declared allowlist, regardless
   * of which provider classified the node (per `spec/architecture.md`
   * §Universal extractors and per-provider extractors).
   */
  activeProvider: string | null;
}

export interface IWalkAndExtractResult {
  nodes: Node[];
  internalLinks: Link[];
  externalLinks: Link[];
  /** Node paths reused verbatim from the prior snapshot. Their
   *  `externalRefsCount` must NOT be zeroed before recomputation. */
  cachedPaths: Set<string>;
  /** Frontmatter-validation findings collected during the walk; the
   *  composer appends these to the rule-emitted issue list so the
   *  final ordering stays "rules first, then derived issues". */
  frontmatterIssues: Issue[];
  /**
   * Spec § A.8, per-extractor enrichment records collected from
   * `ctx.enrichNode(...)` calls during the walk. One entry per
   * `(nodePath, extractorId)` pair an Extractor enriched. The
   * persistence layer upserts these into `node_enrichments`; the
   * read-side `mergeNodeWithEnrichments` helper combines them with
   * the author frontmatter for rule consumption.
   *
   * Attribution is preserved per-Extractor: two Extractors enriching
   * the same node produce two records, not one merged value. If a
   * single Extractor calls `ctx.enrichNode(...)` multiple times within
   * one `extract()` invocation, the partials fold into one record's
   * `value` (last-write-wins per field).
   */
  enrichments: IEnrichmentRecord[];
  /** Every `IRawNode` a Provider yielded across the whole scan
   *  (including cached reuse). With one Provider it equals
   *  `nodesCount`; with future multi-Provider scans walking overlapping
   *  roots it can diverge. */
  filesWalked: number;
  /**
   * Spec § A.9, the rows the persistence layer writes into
   * `scan_extractor_runs`. Includes both freshly-run pairs (extractor
   * invoked this scan) and reused pairs (cached node, the extractor's
   * prior run still applies to the same body hash). Excludes obsolete
   * pairs (extractor was uninstalled since the prior scan).
   */
  extractorRuns: IExtractorRunRecord[];
  /**
   * Phase 3 / View contribution system, per-(plugin × extension ×
   * node × contribution) records collected from `ctx.emitContribution`
   * during the walk. AJV-validated at emit time against the slot's
   * payload schema; off-slot emissions are dropped silently before
   * landing here. The persistence layer flushes these via
   * `replaceAllScanContributions`. Empty for scans where no extension
   * declared `viewContributions` (the common case today).
   */
  contributions: IContributionRecord[];
  /**
   * Phase 3 / View contribution system, set of `(plugin, extension,
   * node)` tuples where `extract()` actually RAN this scan (cache
   * miss). Cached-extractor tuples are EXCLUDED so their prior rows
   * survive in `scan_contributions`. Format:
   * `<pluginId>/<extensionId>/<nodePath>`. Drives the per-tuple sweep
   * in the persistence layer (`IPersistOptions.freshlyRunTuples`).
   * Rules are folded in by the caller (`runScanInternal`) since they
   * always run; this set carries only the extractor-side tuples.
   */
  freshlyRunTuples: Set<string>;
  /**
   * Spec § 9.6.2, orphan sidecar paths (`.sm` files without a sibling
   * `.md`). Discovered after the Provider walk completes so the rule
   * pass can emit `annotation-orphan` warnings. Survives across
   * scans only as derived state, no persistence, recomputed every
   * scan from the live filesystem.
   */
  orphanSidecars: IOrphanSidecar[];
  /**
   * Spec § 9.6.6, raw parsed sidecar root keyed by `node.path`.
   * Plumbed through to the rule pass so semantic rules
   * (`core/annotation-field-unknown`) walk plugin namespaces / root keys without
   * re-reading `.sm` files from disk. Empty when no node carries a
   * parseable sidecar.
   */
  sidecarRoots: Map<string, Record<string, unknown>>;
  /**
   * Signal IR emissions collected from extractors that opted into
   * `ctx.emitSignal`. Threaded through to the kernel's resolver phase
   * (`resolveSignals`) which materialises winning candidates as Links
   * and annotates each Signal's `resolution` field. The annotated
   * Signals later reach the rule pass via `IAnalyzerContext.signals`
   * so the `core/signal-collision` analyzer can surface losers as
   * `warn` issues. Empty for scans where no extractor emitted Signals.
   */
  signals: Signal[];
}

/**
 * Per-scan accumulators bundled into one object so the per-node
 * helpers (`processRawNode`, `applyFullCacheHit`, `applyExtractPath`)
 * mutate a single reference instead of taking 10+ buffer parameters.
 *
 * Every field is documented at the field site below; the docs that
 * used to live inline on each `const` declaration moved here.
 */
interface IWalkAccumulators {
  nodes: Node[];
  internalLinks: Link[];
  externalLinks: Link[];
  signals: Signal[];
  cachedPaths: Set<string>;
  frontmatterIssues: Issue[];
  /**
   * A.8 enrichment buffer. `ctx.enrichNode(partial)` calls fold into
   * a per-Extractor entry keyed by `(nodePath, qualifiedExtractorId)`
   * so the persistence layer can upsert exactly one row per pair into
   * `node_enrichments`. Attribution survives across scans, which
   * lets:
   *   - the stale flag query single-table on (extractor_id, body_hash);
   *   - `sm refresh` re-run only the Extractor whose row is stale;
   *   - the read-time merge sort by `enriched_at` for last-write-wins.
   * Within a single `extract()` invocation, multiple enrichNode calls
   * fold into the same record's `value` (last-write-wins per field).
   */
  enrichmentBuffer: Map<string, IEnrichmentRecord>;
  /**
   * Phase 3 / View contributions, flat buffer (no per-node dedup
   * because the qualified id
   * `<pluginId>/<extensionId>/<contributionId>` is structurally
   * unique within a single scan).
   */
  contributionsBuffer: IContributionRecord[];
  /**
   * Phase 3 / View contributions, accumulator of (plugin, extension,
   * node) tuples where extract() actually RAN this scan (cache
   * miss). Cached extractors don't push here, their prior
   * `scan_contributions` rows must be preserved. Format:
   * `<pluginId>/<extensionId>/<nodePath>`.
   */
  freshlyRunTuples: Set<string>;
  /**
   * Spec § A.9, accumulator for `scan_extractor_runs`. One row per
   * (nodePath, qualifiedExtractorId) pair the orchestrator decided
   * "this extractor is current for this body". Includes both
   * freshly-run pairs and pairs whose prior run was reused intact via
   * the cache.
   */
  extractorRuns: IExtractorRunRecord[];
  /**
   * Spec § 9.6.6, raw parsed sidecar root keyed by `node.path`.
   * Threaded through to the rule pass so semantic rules
   * (`core/annotation-field-unknown`) can reason about plugin namespaces and
   * root keys without re-reading the `.sm` file from disk.
   */
  sidecarRoots: Map<string, Record<string, unknown>>;
}

/**
 * Per-scan immutable context derived from `IWalkAndExtractOptions`.
 * Build once at the top of `walkAndExtract`, pass to helpers by
 * reference. Mirror of the function-level destructure that the
 * pre-refactor monolith opened with.
 */
interface IWalkContext {
  opts: IWalkAndExtractOptions;
  priorNodesByPath: Map<string, Node>;
  priorLinksByOriginating: Map<string, Link[]>;
  priorFrontmatterIssuesByNode: Map<string, Issue[]>;
  /**
   * Short→qualified id map built once for the whole scan. Used to
   * bridge between author-supplied `link.sources` (short id, e.g.
   * `'slash'`) and the qualified ids (`'core/slash-command'`) that drive
   * cache bookkeeping. Multiple plugins can in theory expose
   * extractors with the same short id; we keep all qualifieds per
   * short id so the partial-cache filter recognises any of them as
   * "still cached".
   */
  shortIdToQualified: Map<string, string[]>;
}

/**
 * Main scan loop. For each provider × raw node: hash, classify,
 * decide cache (full / partial / none), reuse or build, run
 * extractors, record runs. Helpers
 * (`computeCacheDecision`, `cloneNodeAndReshapeLinks`,
 * `reusePriorNode`, `buildFreshNodeAndValidateFrontmatter`,
 * `runExtractorsForNode`) encapsulate the heavy lift; this function
 * is the dispatch glue.
 *
 * Per-iteration work split into `processRawNode` so the loop body
 * stays linear and the lint cap is satisfied without an
 * `eslint-disable`.
 */
export async function walkAndExtract(opts: IWalkAndExtractOptions): Promise<IWalkAndExtractResult> {
  const accum = createWalkAccumulators();
  const wctx = buildWalkContext(opts);

  // Path-dedup across the multi-provider walk. Spec § Provider
  // dispatch (architecture.md): every Provider walks the full root,
  // but each file is offered to at most ONE Provider's `classify`.
  // The first Provider in iteration order whose `classify` returns
  // non-null claims the file; subsequent Providers see the path as
  // already-claimed and skip. Without this, the universal markdown
  // fallback (`core/markdown`, registered LAST) would re-claim every
  // file vendor Providers already classified, double-emitting nodes.
  const claimedPaths = new Set<string>();
  const walkOptions = opts.ignoreFilter ? { ignoreFilter: opts.ignoreFilter } : {};
  let filesWalked = 0;
  let index = 0;

  // Active-lens scope filter. Vendor Providers declare
  // `gatedByActiveLens: true` and only participate in the walk when
  // their `id` equals `opts.activeProvider`. Universal Providers
  // (default `gatedByActiveLens === false`) always participate. When
  // `opts.activeProvider === null` (no lens resolved), the filter is
  // bypassed entirely so every Provider runs (permissive fallback for
  // unlensed projects). Filtering at the provider-iteration level
  // (not per file) is the cheap path: a gated-off vendor Provider
  // does NOT walk its territory at all.
  const activeProviders = opts.providers.filter((provider) => {
    if (!provider.gatedByActiveLens) return true;
    if (opts.activeProvider === null) return true;
    return provider.id === opts.activeProvider;
  });

  for (const provider of activeProviders) {
    for await (const raw of resolveProviderWalk(provider)(opts.roots, walkOptions)) {
      filesWalked += 1;
      if (claimedPaths.has(raw.path)) continue;
      const advanced = await processRawNode(raw, provider, wctx, accum, claimedPaths, index + 1);
      if (advanced) index += 1;
    }
  }

  // Spec § 9.6.2, orphan sidecar sweep. Walks the same roots
  // looking for `*.sm` whose sibling `*.md` is missing. The list
  // flows through to the rule pass; `annotation-orphan` emits one
  // warning per entry.
  const orphanSidecars = discoverOrphanSidecars(opts.roots);

  return {
    nodes: accum.nodes,
    internalLinks: accum.internalLinks,
    externalLinks: accum.externalLinks,
    cachedPaths: accum.cachedPaths,
    frontmatterIssues: accum.frontmatterIssues,
    filesWalked,
    enrichments: [...accum.enrichmentBuffer.values()],
    extractorRuns: accum.extractorRuns,
    contributions: accum.contributionsBuffer,
    freshlyRunTuples: accum.freshlyRunTuples,
    orphanSidecars,
    sidecarRoots: accum.sidecarRoots,
    signals: accum.signals,
  };
}

function createWalkAccumulators(): IWalkAccumulators {
  return {
    nodes: [],
    internalLinks: [],
    externalLinks: [],
    signals: [],
    cachedPaths: new Set(),
    frontmatterIssues: [],
    enrichmentBuffer: new Map(),
    contributionsBuffer: [],
    freshlyRunTuples: new Set(),
    extractorRuns: [],
    sidecarRoots: new Map(),
  };
}

function buildWalkContext(opts: IWalkAndExtractOptions): IWalkContext {
  const { priorNodesByPath, priorLinksByOriginating, priorFrontmatterIssuesByNode } = opts.priorIndex;
  const shortIdToQualified = new Map<string, string[]>();
  for (const ex of opts.extractors) {
    const qualified = qualifiedExtensionId(ex.pluginId, ex.id);
    const list = shortIdToQualified.get(ex.id);
    if (list) list.push(qualified);
    else shortIdToQualified.set(ex.id, [qualified]);
  }
  return { opts, priorNodesByPath, priorLinksByOriginating, priorFrontmatterIssuesByNode, shortIdToQualified };
}

/**
 * Process one raw-node yielded by a Provider's `walk()`. Returns
 * `true` if the node was claimed (classify produced a kind), `false`
 * if disclaimed (another Provider may claim it on its own pass).
 *
 * Folds the per-node pipeline into one function so `walkAndExtract`'s
 * outer loop body stays a 2-liner:
 *
 *   - hash body / frontmatter
 *   - classify (early-return on `null`, disclaimed)
 *   - resolve sidecar + hash
 *   - compute cache decision
 *   - dispatch full-cache-hit vs partial/fresh branches
 *
 * Cyclomatic complexity counts every guard (provider-roots filter,
 * classify-null short-circuit, cache eligibility, full-cache vs
 * extract dispatch); the branches are deliberately flat. Splitting
 * the guard chain into helpers would scatter the per-node pipeline.
 */
// eslint-disable-next-line complexity
async function processRawNode(
  raw: IRawNode,
  provider: IProvider,
  wctx: IWalkContext,
  accum: IWalkAccumulators,
  claimedPaths: Set<string>,
  nextIndex: number,
): Promise<boolean> {
  const bodyHash = sha256(raw.body);
  // Canonical-form rationale, hash a CANONICAL form of the
  // frontmatter so a YAML formatter pass (re-indent, sort keys,
  // normalise trailing newline, swap single↔double quotes) doesn't
  // break the medium-confidence rename heuristic.
  const frontmatterHash = sha256(canonicalFrontmatter(raw.frontmatter, raw.frontmatterRaw));

  // Structure-as-truth: `Provider.roots` is enforcement-grade. A
  // Provider with declared roots only sees files matching at least
  // one glob; Providers without `roots` act as the fallback for any
  // file no other Provider's roots claimed.
  if (Array.isArray(provider.roots) && provider.roots.length > 0) {
    if (!matchesAnyRoot(raw.path, provider.roots)) return false;
  }

  const kind = provider.classify(raw.path, raw.frontmatter);
  if (kind === null) {
    // Provider disclaimed the file, another Provider may claim it
    // on its own walk pass, or the file is outside every active
    // Provider's territory.
    return false;
  }
  claimedPaths.add(raw.path);

  const priorNode = wctx.priorNodesByPath.get(raw.path);
  // Cache reuse is gated on the explicit `enableCache` option. The
  // presence of a `prior` alone is no longer enough, a plain
  // `sm scan` always re-walks deterministically; only
  // `sm scan --changed` flips `enableCache` on. The rename heuristic
  // uses `prior` independently of `enableCache`.
  const nodeHashCacheEligible =
    wctx.opts.enableCache &&
    wctx.opts.prior !== null &&
    priorNode !== undefined &&
    priorNode.bodyHash === bodyHash &&
    priorNode.frontmatterHash === frontmatterHash;

  // Resolve the sidecar overlay BEFORE the cache decision so we can
  // hash `overlay.annotations` and feed it into the cache key
  // alongside body+frontmatter. A sidecar edit changes neither the
  // body nor the frontmatter, so without this hash the cache would
  // silently reuse stale contributions for any extractor that read
  // the sidecar (e.g. `core/annotations`). Analyzers that read the
  // sidecar (`core/node-stability`, `core/annotation-stale`, …) re-run
  // every pass regardless, but the hash still matters for the
  // extract-phase cache.
  const sidecarResolution = resolveSidecarOverlay(
    raw.path, raw.path, wctx.opts.roots, bodyHash, frontmatterHash,
  );
  const sidecarAnnotationsHash = sha256(
    canonicalSidecarAnnotations(sidecarResolution.overlay.annotations),
  );

  const cacheDecision = computeCacheDecision({
    extractors: wctx.opts.extractors,
    kind,
    activeProvider: wctx.opts.activeProvider,
    nodePath: raw.path,
    bodyHash,
    sidecarAnnotationsHash,
    nodeHashCacheEligible,
    priorExtractorRuns: wctx.opts.priorExtractorRuns,
  });

  const ctx: IProcessNodeContext = {
    raw, provider, kind, bodyHash, frontmatterHash, sidecarResolution,
    sidecarAnnotationsHash, nodeHashCacheEligible, cacheDecision, priorNode,
    index: nextIndex,
  };

  if (cacheDecision.fullCacheHit && priorNode) {
    applyFullCacheHit(ctx, wctx, accum);
  } else {
    await applyExtractPath(ctx, wctx, accum);
  }
  return true;
}

/**
 * Bag of per-iteration state shared by `applyFullCacheHit` and
 * `applyExtractPath`. Built inside `processRawNode`; never escapes
 * that scope.
 */
interface IProcessNodeContext {
  raw: IRawNode;
  provider: IProvider;
  kind: string;
  bodyHash: string;
  frontmatterHash: string;
  sidecarResolution: ReturnType<typeof resolveSidecarOverlay>;
  sidecarAnnotationsHash: string;
  nodeHashCacheEligible: boolean;
  cacheDecision: ReturnType<typeof computeCacheDecision>;
  priorNode: Node | undefined;
  index: number;
}

/**
 * Attach the freshly-resolved sidecar overlay to a node and surface
 * its issues + parsed root. Used by both apply paths so the apply
 * step stays uniform.
 */
function attachSidecar(
  node: Node,
  resolution: ReturnType<typeof resolveSidecarOverlay>,
  sidecarRoots: Map<string, Record<string, unknown>>,
): Issue[] {
  node.sidecar = resolution.overlay;
  if (resolution.parsedRoot !== null) {
    sidecarRoots.set(node.path, resolution.parsedRoot);
  }
  return resolution.issues.map((i) =>
    i.nodeIds.length > 0 ? i : { ...i, nodeIds: [node.path] },
  );
}

/**
 * Full-cache-hit branch: reuse the prior node + its links + its
 * frontmatter issues + its extractor runs. Sidecars are re-resolved
 * on every scan (not cached) since `.sm` lives outside the body /
 * frontmatter hash domain.
 */
function applyFullCacheHit(
  ctx: IProcessNodeContext,
  wctx: IWalkContext,
  accum: IWalkAccumulators,
): void {
  const reused = reusePriorNode({
    priorNode: ctx.priorNode!,
    bodyHash: ctx.bodyHash,
    sidecarAnnotationsHash: ctx.sidecarAnnotationsHash,
    strict: wctx.opts.strict,
    cachedQualifiedIds: ctx.cacheDecision.cachedQualifiedIds,
    applicableQualifiedIds: ctx.cacheDecision.applicableQualifiedIds,
    shortIdToQualified: wctx.shortIdToQualified,
    priorLinksByOriginating: wctx.priorLinksByOriginating,
    priorFrontmatterIssuesByNode: wctx.priorFrontmatterIssuesByNode,
  });
  const reusedSidecarIssues = attachSidecar(reused.node, ctx.sidecarResolution, accum.sidecarRoots);
  accum.nodes.push(reused.node);
  accum.cachedPaths.add(reused.node.path);
  for (const link of reused.internalLinks) accum.internalLinks.push(link);
  for (const issue of reused.frontmatterIssues) accum.frontmatterIssues.push(issue);
  for (const issue of reusedSidecarIssues) accum.frontmatterIssues.push(issue);
  for (const run of reused.extractorRuns) accum.extractorRuns.push(run);
  wctx.opts.emitter.emit(makeEvent('scan.progress', {
    index: ctx.index, path: ctx.raw.path, kind: ctx.kind, cached: true,
  }));
}

/**
 * Partial- or full-re-extract branch. Either a brand-new node, a
 * node whose body / frontmatter changed, or a node whose hashes
 * match but at least one applicable extractor lacks a matching
 * `scan_extractor_runs` row (newly registered, or its prior run was
 * against a different body hash).
 */
async function applyExtractPath(
  ctx: IProcessNodeContext,
  wctx: IWalkContext,
  accum: IWalkAccumulators,
): Promise<void> {
  const node = buildOrReuseNode(ctx, wctx, accum);
  // Spec § 9.6.2, sidecar overlay applies to BOTH freshly-built and
  // partial-cache nodes. Done after the node is in `accum.nodes` so a
  // downstream consumer iterating `nodes` sees the overlay applied
  // (mutation is in-place on the same object reference).
  const sidecarIssues = attachSidecar(node, ctx.sidecarResolution, accum.sidecarRoots);
  for (const issue of sidecarIssues) accum.frontmatterIssues.push(issue);

  const partialCacheHit = isPartialCacheHit(ctx);
  emitExtractProgress(ctx, wctx, partialCacheHit);

  // Decide which extractors actually run. Full re-extract → all
  // applicable. Partial cache → only the missing ones. Either way,
  // the orchestrator records a fresh `scan_extractor_runs` row for
  // each invocation AND for each cached extractor whose contribution
  // survived intact (so the cache persists across scans).
  const extractorsToRun = partialCacheHit
    ? ctx.cacheDecision.missingExtractors
    : ctx.cacheDecision.applicableExtractors;
  recordFreshlyRunTuples(extractorsToRun, node.path, accum);

  const extractResult = await runExtractorsForNode({
    extractors: extractorsToRun,
    node,
    body: ctx.raw.body,
    frontmatter: ctx.raw.frontmatter,
    bodyHash: ctx.bodyHash,
    emitter: wctx.opts.emitter,
    ...(wctx.opts.pluginStores ? { pluginStores: wctx.opts.pluginStores } : {}),
  });
  mergeExtractResult(extractResult, accum);
  recordExtractorRuns(node.path, ctx, accum);
}

function emitExtractProgress(
  ctx: IProcessNodeContext,
  wctx: IWalkContext,
  partialCacheHit: boolean,
): void {
  wctx.opts.emitter.emit(makeEvent('scan.progress', {
    index: ctx.index, path: ctx.raw.path, kind: ctx.kind, cached: false,
    ...(partialCacheHit ? { partialCache: true } : {}),
  }));
}

/**
 * Phase 3, record (plugin, extension, node) tuples for every
 * extractor that actually runs against this node this scan. The
 * persist layer uses these to drop stale `scan_contributions` rows
 * for extractors that previously emitted but no longer do (e.g. body
 * change removes the trigger). NUL-separated to survive `nodePath`
 * segments with slashes.
 */
function recordFreshlyRunTuples(
  extractors: readonly IExtractor[],
  nodePath: string,
  accum: IWalkAccumulators,
): void {
  for (const ex of extractors) {
    accum.freshlyRunTuples.add(`${ex.pluginId}\0${ex.id}\0${nodePath}`);
  }
}

/**
 * Fold the per-node extract result into the scan-wide accumulators:
 * links (internal + external), enrichments (last-write-wins per
 * `(nodePath, extractorId)` pair), and view contributions.
 */
function mergeExtractResult(
  extractResult: Awaited<ReturnType<typeof runExtractorsForNode>>,
  accum: IWalkAccumulators,
): void {
  for (const link of extractResult.internalLinks) accum.internalLinks.push(link);
  for (const link of extractResult.externalLinks) accum.externalLinks.push(link);
  for (const signal of extractResult.signals) accum.signals.push(signal);
  for (const enr of extractResult.enrichments) {
    accum.enrichmentBuffer.set(`${enr.nodePath}\x00${enr.extractorId}`, enr);
  }
  for (const c of extractResult.contributions) accum.contributionsBuffer.push(c);
  // Phase 5, virtual / synthetic nodes emitted by extractors. First-wins
  // dedup against the accumulator: if N skills each emit `mcp://github`,
  // the first one materialises the node and the rest are silent. Same
  // dedup if a walker's regular node already carries the path (would be
  // weird for `mcp://` paths but the check costs nothing).
  for (const vn of extractResult.virtualNodes) {
    if (accum.nodes.some((n) => n.path === vn.path)) continue;
    accum.nodes.push(vn);
  }
}

function isPartialCacheHit(ctx: IProcessNodeContext): boolean {
  return (
    ctx.nodeHashCacheEligible &&
    ctx.cacheDecision.cachedQualifiedIds.size > 0 &&
    ctx.priorNode !== undefined
  );
}

/**
 * Build the node row for the extract path: clone the prior node when
 * we have a partial-cache hit (body/frontmatter unchanged + at least
 * one cached extractor), otherwise build a fresh node from the raw
 * file. NOT marking the path as `cachedPaths` because some extraction
 * is happening, the `externalRefsCount` recompute wants the node
 * re-derived from a fresh extractor pass (the missing extractor may
 * emit URLs).
 */
function buildOrReuseNode(
  ctx: IProcessNodeContext,
  wctx: IWalkContext,
  accum: IWalkAccumulators,
): Node {
  if (isPartialCacheHit(ctx) && ctx.priorNode) {
    const partial = cloneNodeAndReshapeLinks({
      priorNode: ctx.priorNode,
      strict: wctx.opts.strict,
      cachedQualifiedIds: ctx.cacheDecision.cachedQualifiedIds,
      applicableQualifiedIds: ctx.cacheDecision.applicableQualifiedIds,
      shortIdToQualified: wctx.shortIdToQualified,
      priorLinksByOriginating: wctx.priorLinksByOriginating,
      priorFrontmatterIssuesByNode: wctx.priorFrontmatterIssuesByNode,
    });
    for (const link of partial.internalLinks) accum.internalLinks.push(link);
    for (const issue of partial.frontmatterIssues) accum.frontmatterIssues.push(issue);
    accum.nodes.push(partial.node);
    return partial.node;
  }
  const fresh = buildFreshNodeAndValidateFrontmatter({
    raw: ctx.raw,
    kind: ctx.kind,
    provider: ctx.provider,
    bodyHash: ctx.bodyHash,
    frontmatterHash: ctx.frontmatterHash,
    encoder: wctx.opts.encoder,
    providerFrontmatter: wctx.opts.providerFrontmatter,
    strict: wctx.opts.strict,
  });
  accum.nodes.push(fresh.node);
  for (const issue of fresh.frontmatterIssues) accum.frontmatterIssues.push(issue);
  return fresh.node;
}

/**
 * Persist a `scan_extractor_runs` row for every applicable extractor
 * (both freshly-run AND cached ones whose contribution we reused).
 * Skipping cached entries here would let the replace-all persist
 * forget them, defeating the whole point of the partial-cache path.
 * Always populate `sidecarAnnotationsHashAtRun`; non-sidecar-readers
 * ignore it on the next decision but the column is non-null going
 * forward.
 */
function recordExtractorRuns(
  nodePath: string,
  ctx: IProcessNodeContext,
  accum: IWalkAccumulators,
): void {
  const ranAt = Date.now();
  for (const ex of ctx.cacheDecision.applicableExtractors) {
    accum.extractorRuns.push({
      nodePath,
      extractorId: qualifiedExtensionId(ex.pluginId, ex.id),
      bodyHashAtRun: ctx.bodyHash,
      ranAt,
      sidecarAnnotationsHashAtRun: ctx.sidecarAnnotationsHash,
    });
  }
}

/**
 * Lightweight glob matcher for `Provider.roots` enforcement.
 * Supports the patterns the spec documents:
 *   - `prefix/**` matches any descendant of `prefix` (and `prefix` itself).
 *   - `prefix/*` matches direct children of `prefix`.
 *   - exact `path` matches verbatim.
 *
 * Intentionally narrow: `roots` patterns describe directory territories
 * (`.claude/**`, `notes/**`), not generic glob expressions. Patterns
 * outside this set always return `false`; a Provider declaring an
 * exotic glob will simply receive zero files, surfacing the
 * misconfiguration loudly on the first `sm plugins doctor`.
 */
function matchesAnyRoot(relPath: string, roots: readonly string[]): boolean {
  for (const r of roots) {
    if (matchesOneRoot(relPath, r)) return true;
  }
  return false;
}

function matchesOneRoot(relPath: string, pattern: string): boolean {
  if (pattern.endsWith('/**')) return matchesDeepGlob(relPath, pattern.slice(0, -3));
  if (pattern.endsWith('/*')) return matchesShallowGlob(relPath, pattern.slice(0, -2));
  return relPath === pattern;
}

function matchesDeepGlob(relPath: string, prefix: string): boolean {
  if (prefix.length === 0) return true;
  return relPath === prefix || relPath.startsWith(`${prefix}/`);
}

function matchesShallowGlob(relPath: string, prefix: string): boolean {
  if (!relPath.startsWith(`${prefix}/`)) return false;
  const tail = relPath.slice(prefix.length + 1);
  return tail.length > 0 && !tail.includes('/');
}
