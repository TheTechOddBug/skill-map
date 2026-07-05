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

import { isAbsolute, resolve } from 'node:path';

// js-tiktoken ships CJS subpaths without explicit `.cjs` in the import
// specifier; type-only imports survive lint without the disable that
// the value-import sites need.
import type { Tiktoken } from 'js-tiktoken/lite';

import type { TPluginStore } from '../adapters/plugin-store.js';
import type { IProviderFrontmatterValidator } from '../adapters/schema-validators.js';
import type { IPriorExtractorRun } from '../adapters/sqlite/scan-load.js';
import type {
  IContributionErrorRecord,
  IContributionRecord,
} from '../adapters/sqlite/contributions.js';
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
import type { Issue, Link, Node, OversizedFile, ScanResult, Signal } from '../types.js';
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
  /**
   * Tokenizer-change invalidation flag (see
   * `project-config.schema.json` §tokenizer). When `true`, the prior
   * snapshot's per-node `tokens` were produced by a DIFFERENT encoder
   * than the one resolved for this scan, so cache reuse of token counts
   * is unsafe. The walker forces every node down the fresh-build path
   * (`nodeHashCacheEligible = false`) so `buildNode` recomputes `tokens`
   * with the current encoder. Computed by `runScanInternal`; only ever
   * `true` when `enableCache` is on, a prior exists, and tokenization is
   * active. `false` for fresh scans (nothing to invalidate) and when the
   * encoder is unchanged.
   */
  tokenizerChanged: boolean;
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
  /**
   * Walk-intake ceiling: the maximum number of nodes the walker
   * classifies into `accum.nodes` before dropping extra files in stable
   * provider-walker order. Comes from `scan.maxScan` in settings
   * (default 50000). The walker walks, parses, analyzes, and
   * reference-validates the full corpus up to this number, so references
   * resolve across the whole project regardless of how many nodes the
   * map renders. Reported back as `IWalkAndExtractResult.scanCeiling` so
   * the persistence layer can write `scan_meta.scan_ceiling`.
   */
  scanCeiling: number;
  /**
   * Per-invocation override of the walk ceiling (when `--max-scan <N>`
   * was passed) or `null` when no override was used. Bidirectional:
   * raises OR lowers the ceiling that actually applies
   * (`overrideScanCeiling ?? scanCeiling`). The effective ceiling is
   * the value reported back in `IWalkAndExtractResult.scanCeiling`.
   */
  overrideScanCeiling: number | null;
  /**
   * Map render cap (mirror of `scan.maxNodes` in settings, default 256).
   * Pure metadata: it does NOT bound the walk (the full corpus up to
   * `scanCeiling` is walked + validated). Carried through to the result
   * envelope so the persistence layer can write `scan_meta.max_render_nodes`
   * and the UI knows how many nodes to project onto the canvas.
   */
  maxRenderNodes: number;
  /**
   * Per-invocation override of the render cap (when `--max-nodes <N>`
   * was passed) or `null` when no override was used. Bidirectional. The
   * effective render cap (`overrideMaxRenderNodes ?? maxRenderNodes`) is
   * reported back in `IWalkAndExtractResult.maxRenderNodes`. Never
   * bounds the walk.
   */
  overrideMaxRenderNodes: number | null;
  /**
   * Mirror of `scan.maxFileSizeBytes` (default 1 MiB). Threaded into the
   * Provider walk so the kernel walker skips any file larger than this
   * BEFORE reading it. Skipped files are collected into
   * `IWalkAndExtractResult.oversizedFiles`. Absent → no size limit.
   */
  maxFileSizeBytes?: number;
  /**
   * Mirror of `scan.followExternalSymlinks` (default `false`). Threaded
   * into the Provider walk so the kernel walker refuses a symlink whose
   * target escapes the scan roots unless the operator opted in. Absent →
   * the safe contained default.
   */
  followExternalSymlinks?: boolean;
  /**
   * Watcher-only incremental fast path. Set ONLY by `runScanInternal`
   * after it has confirmed the gate (prior exists, `enableCache`,
   * tokenizer unchanged). Root-relative POSIX paths, `changed` = files
   * to re-read + re-extract (chokidar add / change), `removed` = files
   * to drop (chokidar unlink). When present, `walkAndExtract` enumerates
   * the corpus from the prior snapshot rather than traversing roots:
   *
   *   - changed files run a SCOPED provider walk (`scopedPaths`) so only
   *     they are read + re-extracted through the normal `processRawNode`
   *     pipeline (classify + cache decision);
   *   - every other prior node is injected as an `unchanged` record
   *     through that SAME pipeline so it flows through the tested
   *     `applyFullCacheHit` reuse machinery (node + links + extractor
   *     runs preserved, sidecar re-resolved);
   *   - removed files are simply not injected; the rename / orphan
   *     heuristic over prior-vs-merged handles their disappearance.
   *
   * Absent → the full traversal + mtime-gate path (unchanged).
   */
  incrementalChangedPaths?: {
    changed: ReadonlySet<string>;
    removed: ReadonlySet<string>;
  };
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
   * Files skipped by the walker because their on-disk size exceeded
   * `scan.maxFileSizeBytes`. Each entry is the root-relative,
   * forward-slash path (same form as `node.path`) plus the byte size.
   * Surfaced into `ScanResult.oversizedFiles` and counted in
   * `stats.filesOversized` so the CLI / serve terminal can warn and the
   * UI can raise a banner. Empty when no file exceeded the limit. */
  oversizedFiles: OversizedFile[];
  /**
   * Effective walk ceiling that produced this walk
   * (`overrideScanCeiling ?? scanCeiling`). Reported so callers can
   * persist it into `scan_meta.scan_ceiling` and surface it to the UI
   * banner without re-reading config.
   */
  scanCeiling: number;
  /**
   * `true` when the walker stopped accepting nodes because the effective
   * ceiling was reached and extra files were dropped, `false` otherwise.
   * Drives the CLI "scan truncated" notice and the UI persistent banner.
   * Mirror of the internal `capReached` flag.
   */
  scanTruncated: boolean;
  /**
   * Effective map render cap mirrored from `IWalkAndExtractOptions`
   * (`overrideMaxRenderNodes ?? maxRenderNodes`). Pure metadata, never
   * bounds the walk. Reported so callers can persist it into
   * `scan_meta.max_render_nodes`.
   */
  maxRenderNodes: number;
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
   * "off-shape visible" follow-up, per-(plugin × extension × node)
   * records for contributions REJECTED at extractor emit time
   * (undeclared ref, or payload failed the slot's AJV schema). The
   * persistence layer flushes these via
   * `replaceAllScanContributionErrors`; `sm plugins doctor` reads them
   * back. Empty when no extractor emission was rejected (the common
   * case). Analyzer-side rejections are merged in by the caller
   * (`runScanInternal`), mirroring how `contributions` is threaded.
   */
  contributionErrors: IContributionErrorRecord[];
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
   * so the `core/extractor-collision` analyzer can surface losers as
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
   * "off-shape visible" follow-up, flat buffer of rejected extractor
   * emissions collected across the walk. Flushed to
   * `scan_contribution_errors`.
   */
  contributionErrorsBuffer: IContributionErrorRecord[];
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
  // Files skipped by the walker for exceeding `scan.maxFileSizeBytes`.
  // Collected once across the whole multi-provider walk; the collector
  // dedups by path so a file claimed by two providers' roots isn't
  // double-reported. Surfaced as `ScanResult.oversizedFiles`.
  const oversizedFiles: OversizedFile[] = [];
  const oversizedSeen = new Set<string>();
  const onOversizedFile = (info: OversizedFile): void => {
    if (oversizedSeen.has(info.path)) return;
    oversizedSeen.add(info.path);
    oversizedFiles.push(info);
  };
  // Incremental walk: when cache reuse is on, hand the walker the prior
  // file mtimes so it can skip reading + parsing unchanged bodies (the
  // dominant per-file cost on a re-scan). `undefined` => read every file.
  const priorMtimes = buildPriorMtimes(opts);
  const walkOptions: import('../extensions/provider.js').IProviderWalkOptions = {
    ...(opts.ignoreFilter ? { ignoreFilter: opts.ignoreFilter } : {}),
    onOversizedFile,
    ...(opts.maxFileSizeBytes !== undefined ? { maxFileSizeBytes: opts.maxFileSizeBytes } : {}),
    ...(opts.followExternalSymlinks === true ? { followExternalSymlinks: true } : {}),
    ...(priorMtimes ? { priorMtimes } : {}),
  };
  // Assigned in both branches below (incremental fast path vs full
  // traversal); no initializer so the dead `= 0` does not trip
  // `no-useless-assignment`.
  let filesWalked: number;
  let index = 0;

  // Walk-intake ceiling, see `IWalkAndExtractOptions.scanCeiling`. The
  // override (when present via `--max-scan <N>`) fully replaces the
  // setting; otherwise the configured ceiling applies. Bidirectional:
  // an override below the setting cuts deeper, an override above it
  // relaxes the ceiling. Counted against `accum.nodes.length` (=
  // classified nodes) so the user-facing "50000 files" number lines up
  // with the mental model. When the ceiling is reached, both loops break
  // out. NOTE: the render cap (`maxRenderNodes`) is intentionally NOT
  // consulted here, it never bounds the walk.
  // The walk-intake ceiling bounds the loop; the render cap is pure
  // metadata reported back in the result, never consulted below.
  const { effectiveScanCeiling, effectiveMaxRenderNodes } = resolveEffectiveCaps(opts);
  let capReached = false;

  // Active-lens scope filter. Vendor Providers declare
  // `gatedByActiveLens: true` and only participate in the walk when
  // their `id` equals `opts.activeProvider`. Universal Providers
  // (default `gatedByActiveLens === false`) always participate. The
  // resolver (`core/runtime`) always supplies a concrete lens (a
  // vendor id, or the universal markdown id when no marker is present),
  // so there is no permissive "unlensed" branch; a bare caller that
  // leaves `opts.activeProvider === null` simply runs the universal
  // Providers only, matching the markdown-lens shape. Filtering at the
  // provider-iteration level (not per file) is the cheap path: a
  // gated-off vendor Provider does NOT walk its territory at all.
  const activeProviders = opts.providers.filter((provider) =>
    providerParticipates(provider, opts.activeProvider),
  );

  const advance = async (raw: IRawNode, provider: IProvider): Promise<void> => {
    const advanced = await processRawNode(raw, provider, wctx, accum, claimedPaths, index + 1);
    if (advanced) index += 1;
  };

  if (opts.incrementalChangedPaths !== undefined) {
    // Watcher incremental fast path: enumerate from the prior snapshot +
    // read only the changed files, no directory traversal. See the
    // helper for the changed / unchanged / removed split.
    filesWalked = await walkIncremental({
      changedPaths: opts.incrementalChangedPaths,
      activeProviders,
      walkOptions,
      wctx,
      accum,
      claimedPaths,
      advance,
    });
  } else {
    const full = await walkFullTraversal({
      activeProviders,
      roots: opts.roots,
      walkOptions,
      accum,
      claimedPaths,
      effectiveScanCeiling,
      advance,
    });
    filesWalked = full.filesWalked;
    capReached = full.capReached;
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
    oversizedFiles,
    scanCeiling: effectiveScanCeiling,
    scanTruncated: capReached,
    maxRenderNodes: effectiveMaxRenderNodes,
    enrichments: [...accum.enrichmentBuffer.values()],
    extractorRuns: accum.extractorRuns,
    contributions: accum.contributionsBuffer,
    contributionErrors: accum.contributionErrorsBuffer,
    freshlyRunTuples: accum.freshlyRunTuples,
    orphanSidecars,
    sidecarRoots: accum.sidecarRoots,
    signals: accum.signals,
  };
}

/**
 * Arguments for `walkFullTraversal`. Bundled so `walkAndExtract` hands the
 * full-scan branch one object instead of seven loose parameters.
 */
interface IWalkFullTraversalArgs {
  activeProviders: readonly IProvider[];
  roots: readonly string[];
  walkOptions: import('../extensions/provider.js').IProviderWalkOptions;
  accum: IWalkAccumulators;
  claimedPaths: Set<string>;
  effectiveScanCeiling: number;
  advance: (raw: IRawNode, provider: IProvider) => Promise<void>;
}

/**
 * Full-scan traversal branch of `walkAndExtract`: walk every active
 * Provider's roots in iteration order, honouring the `claimedPaths` dedup
 * and the walk-intake ceiling (breaks out of BOTH loops when reached).
 * Extracted so the `incrementalChangedPaths` branch no longer tips
 * `walkAndExtract` over the complexity cap. Returns the files-walked count
 * and whether the ceiling truncated the walk.
 */
async function walkFullTraversal(
  args: IWalkFullTraversalArgs,
): Promise<{ filesWalked: number; capReached: boolean }> {
  let filesWalked = 0;
  let capReached = false;
  outer: for (const provider of args.activeProviders) {
    for await (const raw of resolveProviderWalk(provider)(args.roots as string[], args.walkOptions)) {
      filesWalked += 1;
      if (args.claimedPaths.has(raw.path)) continue;
      if (args.accum.nodes.length >= args.effectiveScanCeiling) {
        capReached = true;
        break outer;
      }
      await args.advance(raw, provider);
    }
  }
  return { filesWalked, capReached };
}

/**
 * Arguments for `walkIncremental`. Bundled so the helper signature stays
 * short and the watcher fast path threads one object instead of eight
 * loose parameters.
 */
interface IWalkIncrementalArgs {
  changedPaths: { changed: ReadonlySet<string>; removed: ReadonlySet<string> };
  activeProviders: readonly IProvider[];
  walkOptions: import('../extensions/provider.js').IProviderWalkOptions;
  wctx: IWalkContext;
  accum: IWalkAccumulators;
  claimedPaths: Set<string>;
  advance: (raw: IRawNode, provider: IProvider) => Promise<void>;
}

/**
 * Watcher incremental fast path. Enumerates the corpus from the prior
 * snapshot rather than traversing the roots:
 *
 *   1. Map any changed / removed `.sm` sidecar path to its `.md` node so
 *      a sidecar edit re-processes the node.
 *   2. CHANGED pass: run each active provider's walk with `scopedPaths`
 *      set to the absolute changed paths, so only those files are read +
 *      re-extracted through the existing `processRawNode` (full path:
 *      classify + cache decision). Honours `claimedPaths` dedup and the
 *      active-lens provider filter exactly as the full walk does.
 *   3. UNCHANGED pass: for every prior node NOT in changed, NOT in
 *      removed, and not already claimed by the changed pass, inject an
 *      `unchanged` `IRawNode` through the SAME `processRawNode` pipeline
 *      so it flows through the tested `applyFullCacheHit` reuse path.
 *
 * Removed files are intentionally not injected; the rename / orphan
 * heuristic over prior-vs-merged handles their disappearance + renames.
 * Returns the number of files walked (scoped reads + injected prior
 * nodes), surfaced as `filesWalked`.
 */
async function walkIncremental(args: IWalkIncrementalArgs): Promise<number> {
  const changed = expandSidecarPaths(args.changedPaths.changed, args.wctx.priorNodesByPath);
  const removed = expandSidecarPaths(args.changedPaths.removed, args.wctx.priorNodesByPath);
  let filesWalked = 0;

  // CHANGED pass: scoped read of only the changed files, routed through
  // each active provider in the same iteration order the full walk uses.
  const scopedAbs = [...changed].map((rel) => toAbsolute(rel, args.wctx.opts.roots));
  if (scopedAbs.length > 0) {
    const scopedWalkOptions = { ...args.walkOptions, scopedPaths: scopedAbs };
    for (const provider of args.activeProviders) {
      for await (const raw of resolveProviderWalk(provider)(args.wctx.opts.roots, scopedWalkOptions)) {
        filesWalked += 1;
        if (args.claimedPaths.has(raw.path)) continue;
        await args.advance(raw, provider);
      }
    }
  }

  // UNCHANGED pass: inject every other prior node as an `unchanged`
  // record so the reuse machinery (`applyFullCacheHit`) runs verbatim.
  filesWalked += await injectUnchangedPriorNodes(args, changed, removed);
  return filesWalked;
}

/**
 * Inject every prior node that did NOT change, was NOT removed, and was
 * NOT already claimed by the changed pass as an `unchanged` `IRawNode`,
 * matched to its prior provider. Each synthesized record carries a lazy
 * `reread` that reads the `.md` via the provider's resolved parser, so
 * the defensive partial-cache branch in `dispatchNode` still works if a
 * sidecar somehow forces re-extraction. Returns the count injected.
 */
async function injectUnchangedPriorNodes(
  args: IWalkIncrementalArgs,
  changed: ReadonlySet<string>,
  removed: ReadonlySet<string>,
): Promise<number> {
  const providerById = new Map(args.activeProviders.map((p) => [p.id, p]));
  // Fallback for a prior node whose provider is no longer active: the
  // first universal (un-gated) provider, mirroring the markdown
  // fallback's role in the full walk.
  const universalFallback =
    args.activeProviders.find((p) => !p.gatedByActiveLens) ?? args.activeProviders[0];
  let injected = 0;
  for (const priorNode of args.wctx.opts.prior?.nodes ?? []) {
    if (!shouldInjectPriorNode(priorNode, changed, removed, args.claimedPaths)) continue;
    const provider = providerById.get(priorNode.provider) ?? universalFallback;
    if (!provider) continue; // no providers active at all (degenerate)
    const raw = buildUnchangedRawNode(priorNode, provider, args.wctx.opts.roots);
    await args.advance(raw, provider);
    injected += 1;
  }
  return injected;
}

/**
 * Decide whether a prior node should be injected as an `unchanged` record
 * on the watcher's incremental pass. Skips nodes already handled by the
 * changed pass (changed / removed / claimed) and virtual / derived nodes
 * (e.g. `mcp://…`) which carry no backing file and are re-materialised by
 * the extractors that emit them. Extracted so the inject loop body stays
 * linear and `injectUnchangedPriorNodes` clears the complexity cap.
 */
function shouldInjectPriorNode(
  priorNode: Node,
  changed: ReadonlySet<string>,
  removed: ReadonlySet<string>,
  claimedPaths: ReadonlySet<string>,
): boolean {
  const path = priorNode.path;
  if (changed.has(path) || removed.has(path) || claimedPaths.has(path)) return false;
  if (priorNode.virtual === true) return false;
  return true;
}

/**
 * Synthesize an `unchanged` `IRawNode` for a prior node so it flows
 * through `processRawNode`'s unchanged fast path into `applyFullCacheHit`.
 * Body / frontmatter are empty placeholders (the reuse path never reads
 * them); `reread` lazily reads the real `.md` via the provider's parser
 * if the defensive partial-cache branch ever needs it.
 */
function buildUnchangedRawNode(
  priorNode: Node,
  provider: IProvider,
  roots: readonly string[],
): IRawNode {
  const path = priorNode.path;
  return {
    path,
    body: '',
    frontmatterRaw: '',
    frontmatter: {},
    ...(typeof priorNode.modifiedAtMs === 'number'
      ? { modifiedAtMs: priorNode.modifiedAtMs }
      : {}),
    unchanged: true,
    reread: async () => {
      // Reuse the provider's resolved scoped read for ONE path so the
      // read + parse logic stays in the walker (single source). The
      // scoped walk yields at most one record for an existing `.md`.
      const abs = toAbsolute(path, roots);
      for await (const re of resolveProviderWalk(provider)(roots as string[], { scopedPaths: [abs] })) {
        return {
          body: re.body,
          frontmatterRaw: re.frontmatterRaw,
          frontmatter: re.frontmatter,
          ...(re.frontmatterDeclared ? { frontmatterDeclared: true } : {}),
          ...(re.parseIssues ? { parseIssues: re.parseIssues } : {}),
        };
      }
      // The `.md` vanished between scans: degrade to empty content so the
      // re-extract pass emits nothing for it rather than throwing.
      return { body: '', frontmatterRaw: '', frontmatter: {} };
    },
  };
}

/**
 * Fold any `.sm` sidecar path in `paths` into its paired `.md` NODE path
 * so a sidecar edit re-processes the node it annotates. A `.sm` path maps
 * to `<base>.md` (the inverse of `sidecarPathFor`); the result is added
 * only when that `.md` actually exists in the prior snapshot (otherwise
 * the sidecar is an orphan the orphan-sweep already handles). Non-`.sm`
 * paths pass through unchanged.
 */
function expandSidecarPaths(
  paths: ReadonlySet<string>,
  priorNodesByPath: ReadonlyMap<string, Node>,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const path of paths) {
    if (path.endsWith('.sm')) {
      const mdPath = `${path.slice(0, -'.sm'.length)}.md`;
      if (priorNodesByPath.has(mdPath)) out.add(mdPath);
      // else: orphan sidecar, no node to re-process; the orphan sweep
      // over the live roots surfaces it as `annotation-orphan`.
      continue;
    }
    out.add(path);
  }
  return out;
}

/**
 * Resolve a root-relative POSIX node path to an absolute filesystem path
 * under the first root. Mirrors the join the scoped walker reverses, the
 * walker re-derives the same root-relative path from the absolute one.
 */
function toAbsolute(relPath: string, roots: readonly string[]): string {
  const root = roots[0] ?? '.';
  const absRoot = isAbsolute(root) ? root : resolve(root);
  return resolve(absRoot, relPath);
}

/**
 * Resolve the two cap knobs to their effective values. The walk ceiling
 * (`scan.maxScan` / `--max-scan`) bounds the walk loop; the render cap
 * (`scan.maxNodes` / `--max-nodes`) is pure metadata. Both are
 * bidirectional: a per-invocation override fully replaces the setting.
 * Extracted so the two `??` folds live outside `walkAndExtract` (keeps
 * its cyclomatic complexity inside budget).
 */
function resolveEffectiveCaps(
  opts: IWalkAndExtractOptions,
): { effectiveScanCeiling: number; effectiveMaxRenderNodes: number } {
  return {
    effectiveScanCeiling: opts.overrideScanCeiling ?? opts.scanCeiling,
    effectiveMaxRenderNodes: opts.overrideMaxRenderNodes ?? opts.maxRenderNodes,
  };
}

/**
 * Prior-scan file mtimes for the walker's incremental fast path, keyed
 * by `node.path`. Built ONLY when cache reuse is on, a prior snapshot
 * exists, AND the tokenizer is unchanged (a tokenizer swap must
 * re-tokenize every body, so the read cannot be skipped). Restricted to
 * prior nodes that carry a file mtime, virtual / derived nodes (e.g.
 * `mcp://`) have none and are never walked. Returns `undefined` when the
 * gate does not apply (or no prior node had an mtime), so the walker
 * falls back to reading every file.
 */
function buildPriorMtimes(
  opts: IWalkAndExtractOptions,
): ReadonlyMap<string, number> | undefined {
  if (!opts.enableCache || opts.prior === null || opts.tokenizerChanged) return undefined;
  const map = new Map<string, number>();
  for (const node of opts.prior.nodes) {
    if (typeof node.modifiedAtMs === 'number') map.set(node.path, node.modifiedAtMs);
  }
  return map.size > 0 ? map : undefined;
}

/**
 * Active-lens participation predicate for the provider-iteration filter
 * in `walkAndExtract`. A universal Provider (`gatedByActiveLens` falsy)
 * always participates. A gated vendor Provider participates only when
 * its id equals the active lens. The resolver always supplies a
 * concrete lens, so there is no permissive branch; a bare caller that
 * leaves the lens `null` runs only the universal Providers. Extracted
 * so the walk loop stays under the complexity cap.
 */
function providerParticipates(provider: IProvider, activeProvider: string | null): boolean {
  if (!provider.gatedByActiveLens) return true;
  return provider.id === activeProvider;
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
    contributionErrorsBuffer: [],
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
 *   - enforce `Provider.roots` (disclaim early, before any hashing)
 *   - incremental fast path: an `unchanged` record (walker matched the
 *     mtime, skipped the read) reuses the prior node's kind + hashes
 *   - otherwise hash body / frontmatter, classify (early-return on
 *     `null`, disclaimed)
 *   - hand off to `dispatchNode` (sidecar resolve + cache decision +
 *     full-cache-hit vs partial/fresh dispatch), shared by both paths
 */
async function processRawNode(
  raw: IRawNode,
  provider: IProvider,
  wctx: IWalkContext,
  accum: IWalkAccumulators,
  claimedPaths: Set<string>,
  nextIndex: number,
): Promise<boolean> {
  // Structure-as-truth: `Provider.roots` is enforcement-grade. A
  // Provider with declared roots only sees files matching at least
  // one glob; Providers without `roots` act as the fallback for any
  // file no other Provider's roots claimed. Checked FIRST (before any
  // hashing) so a disclaimed file costs nothing AND the unchanged
  // fast-path below, which has no body to hash, shares the same gate.
  if (Array.isArray(provider.roots) && provider.roots.length > 0) {
    if (!matchesAnyRoot(raw.path, provider.roots)) return false;
  }

  // Incremental fast path: the walker matched this file's on-disk mtime
  // against the prior snapshot and skipped reading its body. Handled in a
  // dedicated helper so this function's top stays a thin dispatch; when it
  // claims the node the helper returns `true` and we are done.
  if (raw.unchanged === true) {
    const handled = await handleUnchangedRawNode(raw, provider, wctx, accum, claimedPaths, nextIndex);
    if (handled) return true;
    // Helper fell through (prior node vanished, body reread): continue
    // into the normal build path below.
  }

  const bodyHash = sha256(raw.body);
  // Canonical-form rationale, hash a CANONICAL form of the
  // frontmatter so a YAML formatter pass (re-indent, sort keys,
  // normalise trailing newline, swap single↔double quotes) doesn't
  // break the medium-confidence rename heuristic.
  const frontmatterHash = sha256(canonicalFrontmatter(raw.frontmatter, raw.frontmatterRaw));

  const kind = provider.classify(raw.path, raw.frontmatter);
  if (kind === null) {
    // Provider disclaimed the file, another Provider may claim it
    // on its own walk pass, or the file is outside every active
    // Provider's territory.
    return false;
  }
  claimedPaths.add(raw.path);

  const priorNode = wctx.priorNodesByPath.get(raw.path);
  const nodeHashCacheEligible = isNodeHashCacheEligible(wctx, priorNode, bodyHash, frontmatterHash);

  await dispatchNode(
    { raw, provider, kind, bodyHash, frontmatterHash, nodeHashCacheEligible, priorNode },
    wctx,
    accum,
    nextIndex,
  );
  return true;
}

/**
 * Whether a node may reuse its prior snapshot entry (full / partial cache).
 * Gated on the explicit `enableCache` option (a plain `sm scan` always
 * re-walks deterministically; only `sm scan --changed` flips it on, the
 * rename heuristic uses `prior` independently of `enableCache`), with a
 * tokenizer-change invalidation (a tokenizer swap rebuilds every node so
 * `buildNode` re-tokenizes), plus a prior snapshot whose body + frontmatter
 * hashes match. Extracted so the `&&` chain lives outside `processRawNode`
 * and that function clears the complexity cap.
 */
function isNodeHashCacheEligible(
  wctx: IWalkContext,
  priorNode: Node | undefined,
  bodyHash: string,
  frontmatterHash: string,
): boolean {
  return (
    wctx.opts.enableCache &&
    !wctx.opts.tokenizerChanged &&
    wctx.opts.prior !== null &&
    priorNode !== undefined &&
    priorNode.bodyHash === bodyHash &&
    priorNode.frontmatterHash === frontmatterHash
  );
}

/**
 * Handle the incremental `unchanged` fast path for one raw node. The
 * walker matched this file's on-disk mtime against the prior snapshot and
 * skipped reading its body, so reuse the prior node's kind + hashes (the
 * body is byte-identical); only the cheap sidecar resolution decides full
 * vs partial cache, and the body is reread lazily (`ensureBody`) ONLY when
 * a sidecar edit forces re-extraction. An unchanged corpus pays a stat per
 * file, not a read + YAML parse.
 *
 * Returns `true` when the node was claimed + dispatched (caller returns
 * `true`). Returns `false` only in the degenerate "prior node vanished for
 * an unchanged-marked path" case (the map is built FROM the prior, so this
 * should not happen): the body is read now and the caller falls through to
 * the normal build path.
 */
async function handleUnchangedRawNode(
  raw: IRawNode,
  provider: IProvider,
  wctx: IWalkContext,
  accum: IWalkAccumulators,
  claimedPaths: Set<string>,
  nextIndex: number,
): Promise<boolean> {
  const prior = wctx.priorNodesByPath.get(raw.path);
  if (prior) {
    claimedPaths.add(raw.path);
    await dispatchNode(
      {
        raw,
        provider,
        kind: prior.kind,
        bodyHash: prior.bodyHash,
        frontmatterHash: prior.frontmatterHash,
        nodeHashCacheEligible: true,
        priorNode: prior,
        ensureBody: () => rereadInto(raw),
      },
      wctx,
      accum,
      nextIndex,
    );
    return true;
  }
  // Prior node vanished for an unchanged-marked path: read the body now so
  // the caller's normal build path has real content to hash.
  await rereadInto(raw);
  return false;
}

/**
 * Arguments for `dispatchNode`. Bundles the per-node identity (kind +
 * hashes) the normal path computes and the unchanged fast-path lifts
 * from the prior node, so both feed the same sidecar-resolve + cache
 * decision + dispatch tail.
 */
interface IDispatchNodeArgs {
  raw: IRawNode;
  provider: IProvider;
  kind: string;
  bodyHash: string;
  frontmatterHash: string;
  nodeHashCacheEligible: boolean;
  priorNode: Node | undefined;
  /**
   * Optional async body-loader invoked right before the extract path
   * runs. The unchanged fast-path passes `rereadInto(raw)` here so the
   * body is read ONLY when a sidecar edit forces re-extraction; the
   * normal path omits it (the body was already read eagerly).
   */
  ensureBody?: () => Promise<void>;
}

/**
 * Shared per-node tail: resolve the sidecar overlay (BEFORE the cache
 * decision so its annotations hash feeds the cache key, a `.sm` edit
 * changes neither body nor frontmatter yet must invalidate
 * sidecar-reading extractors), compute the cache decision, then dispatch
 * to the full-cache-hit branch or the partial / fresh extract path.
 * Called by both the normal path and the unchanged fast-path in
 * `processRawNode`.
 */
async function dispatchNode(
  args: IDispatchNodeArgs,
  wctx: IWalkContext,
  accum: IWalkAccumulators,
  nextIndex: number,
): Promise<void> {
  const sidecarResolution = resolveSidecarOverlay(
    args.raw.path, args.raw.path, wctx.opts.roots, args.bodyHash, args.frontmatterHash,
  );
  const sidecarAnnotationsHash = sha256(
    canonicalSidecarAnnotations(sidecarResolution.overlay.annotations),
  );

  const cacheDecision = computeCacheDecision({
    extractors: wctx.opts.extractors,
    kind: args.kind,
    activeProvider: wctx.opts.activeProvider,
    nodePath: args.raw.path,
    bodyHash: args.bodyHash,
    sidecarAnnotationsHash,
    nodeHashCacheEligible: args.nodeHashCacheEligible,
    priorExtractorRuns: wctx.opts.priorExtractorRuns,
  });

  const ctx: IProcessNodeContext = {
    raw: args.raw,
    provider: args.provider,
    kind: args.kind,
    bodyHash: args.bodyHash,
    frontmatterHash: args.frontmatterHash,
    sidecarResolution,
    sidecarAnnotationsHash,
    nodeHashCacheEligible: args.nodeHashCacheEligible,
    cacheDecision,
    priorNode: args.priorNode,
    index: nextIndex,
  };

  if (cacheDecision.fullCacheHit && args.priorNode) {
    applyFullCacheHit(ctx, wctx, accum);
  } else {
    // Re-extract needs the body. On the unchanged fast-path the walker
    // skipped the read, so pull it in now (a sidecar edit on an
    // otherwise-unchanged file); the normal path has no `ensureBody` and
    // already carries the body.
    if (args.ensureBody) await args.ensureBody();
    await applyExtractPath(ctx, wctx, accum);
  }
}

/**
 * Materialise the body of an `unchanged` raw node by invoking the
 * walker's lazy `reread`, mutating the record in place and clearing the
 * `unchanged` flag. No-op when the record carries no `reread` (a
 * Provider with a custom `walk()` that never emits `unchanged`).
 */
async function rereadInto(raw: IRawNode): Promise<void> {
  if (!raw.reread) return;
  const re = await raw.reread();
  raw.body = re.body;
  raw.frontmatter = re.frontmatter;
  raw.frontmatterRaw = re.frontmatterRaw;
  raw.unchanged = false;
  if (re.frontmatterDeclared) raw.frontmatterDeclared = true;
  if (re.parseIssues) raw.parseIssues = re.parseIssues;
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
  for (const e of extractResult.contributionErrors) accum.contributionErrorsBuffer.push(e);
  mergeVirtualNodes(extractResult.virtualNodes, accum);
}

/**
 * Phase 5, fold extractor-emitted virtual / synthetic nodes into the
 * accumulator. First-wins dedup by `path`: if N skills each emit
 * `mcp://github`, the first one materialises the node and the rest are
 * silent. The same dedup guards against a walker's regular node already
 * carrying the path (unlikely for `mcp://` paths, but the check is
 * cheap). Split out of `mergeExtractResult` so that function stays a
 * flat list of per-collection folds under the complexity cap.
 */
function mergeVirtualNodes(virtualNodes: readonly Node[], accum: IWalkAccumulators): void {
  for (const vn of virtualNodes) {
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
