/**
 * Scan orchestrator, runs the Provider → extractor → analyzer pipeline across
 * every registered extension and emits `ProgressEmitterPort` events in
 * canonical order. The callable extension set is injected via
 * `RunScanOptions.extensions`, the Registry holds manifest metadata, the
 * callable set holds the runtime instances the orchestrator actually
 * invokes. Separating the two lets `sm plugins` and `sm help` introspect
 * the graph without loading code.
 *
 * With zero registered extensions (or a callable set that carries none)
 * the pipeline still produces a valid zero-filled `ScanResult`, the
 * kernel-empty-boot invariant.
 *
 * Roots are validated up front: each entry of `RunScanOptions.roots`
 * must exist on disk as a directory. The first failure throws a clear
 * `Error` naming the offending path. This guards every caller (CLI,
 * server, skill-agent) against silently producing a zero-filled
 * `ScanResult` when a Provider walks a non-existent path, the bug
 * that wiped a populated DB via `sm scan -- --dry-run` (clipanion's
 * `--` made `--dry-run` a positional root that did not exist).
 *
 * Incremental scans: when `priorSnapshot` is supplied, the
 * orchestrator walks the filesystem, hashes each file, and reuses the
 * prior node + its prior-extracted internal links whenever both
 * `bodyHash` and `frontmatterHash` match. New / modified files run
 * through the full extractor pipeline (including the external-url-counter
 * which produces ephemeral pseudo-links). Rules ALWAYS run over the
 * fully merged graph, issue state can change even for an unchanged node
 * (e.g. a previously broken `references` link now resolves because a new
 * node was added). For unchanged nodes the prior `externalRefsCount` is
 * preserved as-is (the external pseudo-links were never persisted, so
 * they cannot be reconstructed; the count survived in the node row).
 *
 * Extractor output model (B.1, post-rename from Detector): extractors
 * return `void` and emit through three callbacks injected on the context:
 *   - `ctx.emitLink(link)` → orchestrator validates against
 *     `emitsLinkKinds` then partitions into internal / external buckets.
 *   - `ctx.enrichNode(partial)` → orchestrator records ONE enrichment
 *     entry per `(node, extractor)` so attribution survives into the DB.
 *     Persisted into `node_enrichments` (A.8). The author-supplied
 *     frontmatter on `node.frontmatter` stays immutable from any Extractor
 *    , the enrichment layer is the only writable surface, and rules /
 *     formatters consume it via `mergeNodeWithEnrichments`.
 *   - `ctx.store` → plugin's own KV / dedicated tables (spec § A.12).
 *     Wired by the driving adapter via `RunScanOptions.pluginStores`,
 *     which the orchestrator looks up per-extractor by `pluginId` and
 *     attaches to the context. The orchestrator never inspects what
 *     plugins write through it; the wrapper handles AJV validation
 *     when the manifest declared an output schema.
 */

import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

// js-tiktoken ships CJS subpaths without explicit `.cjs` in the import
// specifier, the lint rule's hard-coded extension matrix doesn't model
// dual-package CJS subpath exports.
// eslint-disable-next-line import-x/extensions
import { Tiktoken } from 'js-tiktoken/lite';
// Rank tables are loaded lazily and per-encoder in `buildScanSetup` via
// explicit literal dynamic imports (see `loadTokenizerRanks`), so only
// the chosen encoder's BPE table is pulled into the bundle / runtime.
// A static `import cl100k_base from 'js-tiktoken/ranks/cl100k_base'`
// would force-load that table on every scan, even when tokenization is
// off or the operator selected `o200k_base`.

import pkg from '../../package.json' with { type: 'json' };

import { InMemoryProgressEmitter } from '../adapters/in-memory-progress.js';
import { installedSpecVersion } from '../adapters/plugin-loader.js';
import type { TPluginStore } from '../adapters/plugin-store.js';
import {
  buildProviderFrontmatterValidator,
  type IProviderFrontmatterValidator,
} from '../adapters/schema-validators.js';
import type {
  IContributionErrorRecord,
  IContributionRecord,
} from '../adapters/sqlite/contributions.js';
import type { IPriorExtractorRun } from '../adapters/sqlite/scan-load.js';
import {
  makeHookDispatcher,
  makeEvent,
  type IHookDispatcher,
} from '../extensions/hook-dispatcher.js';
import type {
  IAnalyzer,
  IExtractor,
  IHook,
  IProvider,
  IProviderKind,
} from '../extensions/index.js';
import { ORCHESTRATOR_TEXTS } from '../i18n/orchestrator.texts.js';
import type { Kernel } from '../index.js';
import type {
  ProgressEmitterPort,
} from '../ports/progress-emitter.js';
import { qualifiedExtensionId } from '../registry.js';
import type { IIgnoreFilter } from '../scan/ignore.js';
import type {
  Issue,
  Node,
  ScanResult,
  ScanScannedBy,
} from '../types.js';
import type { IRegisteredAnnotationKey } from '../types/annotation-catalog.js';
import type { IRegisteredViewContribution } from '../types/view-catalog.js';
import { tx } from '../util/tx.js';
import { detectProvidersFromFilesystem } from '../scan/detect-providers.js';
import { runAnalyzers } from './analyzers.js';
import {
  indexPriorSnapshot,
  type IPriorIndex,
} from './cache.js';
import {
  isExternalUrlLink,
  recomputeExternalRefsCount,
  recomputeLinkCounts,
  type IEnrichmentRecord,
  type IExtractorRunRecord,
} from './extractors.js';
import { deriveNodeIdentifiers } from './node-identifiers.js';
import {
  applyPostWalkTransforms,
  type IPostWalkTransformCtx,
} from './post-walk-transforms.js';
import { resolveSignals } from './resolver.js';
import { normalizeTrigger } from '../trigger-normalize.js';
import {
  detectRenamesAndOrphans,
  type RenameOp,
} from './renames.js';
import {
  walkAndExtract,
  type IWalkAndExtractResult,
} from './walk.js';

// Resolved once at module init so every scan reuses the same metadata.
// `installedSpecVersion()` reads `@skill-map/spec/package.json` off disk;
// failure is non-fatal, fall back to `'unknown'` and keep the field
// shape spec-conformant (string).
const SCANNED_BY: ScanScannedBy = {
  name: 'skill-map',
  version: pkg.version,
  specVersion: resolveSpecVersionSafe(),
};

function resolveSpecVersionSafe(): string {
  try {
    return installedSpecVersion();
  } catch {
    return 'unknown';
  }
}

/**
 * Default offline tokenizer. Mirrors `defaults.json#/tokenizer` and the
 * `project-config.schema.json` enum default. The single source of the
 * "fall back to this" decision in the orchestrator.
 */
const DEFAULT_TOKENIZER = 'cl100k_base';

/**
 * Closed allow-list of supported encoders, byte-aligned with
 * `project-config.schema.json#/properties/tokenizer/enum`.
 */
type TTokenizerName = 'cl100k_base' | 'o200k_base';

/**
 * Belt-and-suspenders guard over the override layer. The config schema's
 * AJV `enum` already rejects out-of-set values for the config layers
 * (dropped-with-warning, falls back to the default), but the `override`
 * layer and out-of-band callers reach `runScan` without that gate, so
 * any unrecognised name resolves to the default here.
 */
function resolveTokenizerName(name: string | undefined): TTokenizerName {
  return name === 'o200k_base' ? 'o200k_base' : DEFAULT_TOKENIZER;
}

/**
 * Load only the chosen encoder's BPE rank table. The two specifiers are
 * explicit string literals (NOT a template-literal `js-tiktoken/ranks/${name}`)
 * so tsup can statically see both subpaths and bundle them; the ternary
 * means exactly one table is loaded at runtime.
 */
async function loadTokenizerRanks(name: TTokenizerName): Promise<ConstructorParameters<typeof Tiktoken>[0]> {
  if (name === 'o200k_base') {
    // eslint-disable-next-line import-x/extensions
    return (await import('js-tiktoken/ranks/o200k_base')).default;
  }
  // eslint-disable-next-line import-x/extensions
  return (await import('js-tiktoken/ranks/cl100k_base')).default;
}

export interface IScanExtensions {
  providers: IProvider[];
  extractors: IExtractor[];
  analyzers: IAnalyzer[];
  /**
   * Optional hooks (spec § A.11). When supplied, the orchestrator's
   * lifecycle dispatcher invokes deterministic hooks subscribed to one
   * of the eight hookable triggers in canonical order with the matching
   * event payload. Absent → no hooks fire (the scan still emits its
   * lifecycle events to `ProgressEmitterPort` for observability).
   * Probabilistic hooks are loaded but skipped here with a stderr
   * advisory until the job subsystem ships once the job subsystem ships.
   */
  hooks?: IHook[];
}

export interface RunScanOptions {
  /**
   * Filesystem roots to walk. Spec requires `minItems: 1`; passing an
   * empty array makes `runScan` throw before any work happens.
   */
  roots: string[];
  emitter?: ProgressEmitterPort;
  /** Runtime extension instances. Absent → empty pipeline. */
  extensions?: IScanExtensions;
  /**
   * Step 9.6.6, runtime catalog of plugin-contributed annotation keys
   * (the same shape `kernel.getRegisteredAnnotationKeys()` returns).
   * Threaded into the rule pass so `core/annotation-field-unknown` can
   * legitimise registered plugin namespaces / root keys without
   * re-walking the manifests. Absent → empty catalog (every plugin
   * key is treated as unknown). Built-in catalog from
   * `annotations.schema.json` is NOT included, that is hard-coded
   * inside the rule.
   */
  annotationContributions?: readonly IRegisteredAnnotationKey[];
  /**
   * Runtime catalog of plugin-contributed view contributions (the same
   * shape `kernel.getRegisteredViewContributions()` returns). Threaded
   * into the rule pass so:
   *   - `core/contribution-orphan` can introspect the catalog
   *     (read-only) and join it with the live node set to flag
   *     dangling emissions. Slot catalog drift is NOT a scan concern,
   *     it lives at load time and surfaces via `sm plugins doctor`
   *     (the kernel rejects unknown slots as `invalid-manifest` first,
   *     doctor catches the catalog-version-skew tail).
   *   - The orchestrator's per-rule emit closure can look up each
   *     declared `(contributionId → slot)` pairing for AJV
   *     payload validation.
   * Absent → empty catalog. Rules that emit contributions silently
   * drop emissions when the catalog has no entry for the rule's
   * declared contributionId.
   */
  viewContributions?: readonly IRegisteredViewContribution[];
  /**
   * Compute per-node token counts (frontmatter / body / total) using the
   * encoder named by `tokenizer` (default `cl100k_base`). Defaults to
   * true. Set false to skip tokenization; `node.tokens` is left undefined
   * (spec-valid: the field is optional).
   */
  tokenize?: boolean;
  /**
   * Offline tokenizer (encoder) used to build the per-node token counts.
   * Closed allow-list mirroring `project-config.schema.json#/properties/tokenizer`:
   * `cl100k_base` (default) or `o200k_base`. Threaded from `cfg.tokenizer`
   * by the driving adapters (scan-runner, watcher). Absent → `cl100k_base`.
   * The orchestrator guards the override layer: any value that is neither
   * allow-list member falls back to `cl100k_base` (the AJV enum on the
   * config schema already guarantees this for the config layers, the
   * guard covers out-of-band callers and the `override` layer). The
   * resolved value is carried onto `ScanResult.tokenizer` so the
   * persistence layer can record which encoder produced the counts and
   * the incremental path can detect an encoder switch.
   */
  tokenizer?: string;
  /**
   * Prior snapshot for two purposes (decoupled by design):
   *
   *   1. **Rename heuristic** (`spec/db-schema.md` §Rename detection):
   *      always evaluated when `priorSnapshot` is supplied. The
   *      heuristic compares prior vs current node paths and emits
   *      high / medium / ambiguous / orphan classifications. This
   *      runs on EVERY `sm scan` (with or without `--changed`) so
   *      reorganising files always preserves history, never silently.
   *
   *   2. **Cache reuse** (`sm scan --changed`): only kicks in when
   *      `enableCache: true` is also passed. With the flag set, nodes
   *      whose `path` exists in the prior with both `bodyHash` and
   *      `frontmatterHash` matching the freshly-computed hashes are
   *      reused as-is (their internal links and `externalRefsCount`
   *      survive); only new / modified nodes run through extractors.
   *      Rules always re-run over the merged graph.
   *
   * Pass `null` (or omit) for a fresh scan with no rename detection.
   */
  priorSnapshot?: ScanResult | null;
  /**
   * Reuse unchanged nodes from `priorSnapshot` instead of re-running
   * extractors over them. Defaults to `false` so a plain `sm scan`
   * always re-walks deterministically. `sm scan --changed` flips this
   * to `true` for the perf win on unchanged files.
   *
   * Has no effect without `priorSnapshot`; setting it to `true` with
   * a null prior is a no-op (every file is "new").
   */
  enableCache?: boolean;
  /**
   * Filter that decides which paths the Providers skip. Composed by the
   * caller (typically the CLI) from bundled defaults + `config.ignore`
   * + `.skillmapignore`. Providers that omit this option fall back to
   * their own defensive defaults (just enough to keep `.git` /
   * `node_modules` out).
   */
  ignoreFilter?: IIgnoreFilter;
  /**
   * Promote frontmatter-validation findings from `warn` to `error`.
   * Defaults to false. The CLI surfaces this via `--strict` on `sm scan`
   * and the `scan.strict` config key. When false, the orchestrator
   * still emits a `frontmatter-invalid` issue per malformed file but
   * leaves the severity at `warn` so a clean scan exits 0; when true,
   * the same finding becomes `error` and the scan exits 1.
   */
  strict?: boolean;
  /**
   * Spec § A.9, fine-grained Extractor cache breadcrumbs from the
   * prior scan. Shape: `Map<nodePath, Map<qualifiedExtractorId, IPriorExtractorRun>>`.
   * Loaded from the `scan_extractor_runs` table by the CLI before
   * invoking `runScan`; absent / empty for a fresh DB or an out-of-band
   * caller that does not maintain a cache. Decoupled from `priorSnapshot`
   * because the runs live in a sibling table and are useful only when
   * `enableCache` is also set.
   *
   * Cache decision per `(node, extractor)`:
   *   - body+frontmatter hashes match the prior node AND every currently-
   *     registered extractor that applies to this kind has a matching
   *     row → full skip, all prior outbound links reused.
   *   - some applicable extractor lacks a matching row (newly registered,
   *     or its prior run targeted a different body hash or sidecar
   *     annotations hash) → run only the missing extractors, drop prior
   *     links whose `sources` map to any missing extractor or to an
   *     extractor that is no longer registered.
   */
  priorExtractorRuns?: Map<string, Map<string, IPriorExtractorRun>>;
  /**
   * Spec § A.12, per-plugin storage wrappers exposed to extractors via
   * `ctx.store`. Keyed by `pluginId`; absent / missing entry leaves
   * `ctx.store` undefined for that extractor (the existing contract).
   *
   * The kernel does not construct these, the driving adapter (CLI,
   * future server) builds them with `makePluginStore` from
   * `kernel/adapters/plugin-store.js` and threads them through. This
   * keeps the orchestrator persistence-agnostic (the wrapper supplies
   * its own persist callback) and lets tests inject a captured-call
   * mock without spinning up a DB.
   */
  pluginStores?: ReadonlyMap<string, TPluginStore>;
  /**
   * Pre-computed absolute paths of orphan job MD files (files under
   * `.skill-map/jobs/` whose absolute path appears nowhere in
   * `state_jobs.filePath`). Threaded into the rule pass so the
   * built-in `core/job-file-orphan` rule can project each as a `warn`
   * issue without the kernel reaching for the storage port or doing
   * its own FS walk. The driving adapter (CLI, BFF) computes this
   * inside its already-open storage transaction via
   * `findOrphanJobFiles(jobsDir, await port.jobs.listReferencedFilePaths())`
   * mirrors the `orphanSidecars` model where detection lives
   * outside the rule and the rule only projects. Absent / empty when
   * the caller has no jobs context (out-of-band tests, fresh DB,
   * `--no-built-ins`).
   */
  orphanJobFiles?: readonly string[];
  /**
   * Side set of absolute file paths the operator opted into for
   * link-validation purposes via `scan.referencePaths`. Threaded
   * through to `IAnalyzerContext.referenceablePaths` so the built-in
   * `core/reference-broken` rule can suppress its `warn` for path-style
   * links whose target lands in the set. Files are NOT walked by
   * the kernel, the driving adapter populates the set before
   * calling `runScan`. Absent / empty when the operator left
   * `scan.referencePaths` unconfigured.
   */
  referenceablePaths?: ReadonlySet<string>;
  /**
   * Absolute path of the scan's cwd / project root. Threaded onto
   * `IAnalyzerContext.cwd` so rules that need to resolve a relative
   * `link.target` to an absolute filesystem path can do so without
   * heuristics. Absent for callers that don't track a cwd
   * concept (out-of-band tests, embedders).
   */
  cwd?: string;
  /**
   * Active provider lens for this scan, gating provider-specific
   * extractors against both the node's provider AND the lens (per
   * `spec/architecture.md` §Universal extractors and per-provider
   * extractors). Three interpretations:
   *
   *   - `string`: explicit lens. Provider-specific extractors run only
   *     when their declared `precondition.provider` includes BOTH this
   *     value AND the node's provider.
   *   - `null`: explicit "no lens". Provider-specific extractors are
   *     unconditionally skipped (spec-strict).
   *   - `undefined`: kernel auto-detects from `options.roots[0]` using
   *     filesystem markers (`.claude/`, `.codex/`, `AGENTS.md`).
   *     Convenient default for out-of-band callers
   *     (integration tests, embedders) that don't thread a settings
   *     reader. Production callers (scan-runner) resolve upstream and
   *     pass `string | null` explicitly, never `undefined`.
   */
  activeProvider?: string | null;
  /**
   * Recommended cap on the number of nodes the walker classifies
   * (mirror of `scan.maxNodes` in settings, default 256). Threaded
   * through to `walkAndExtract` so the cap can fire and so
   * `ScanResult.recommendedNodeLimit` is populated. Absent → the
   * orchestrator falls back to 256 (the design default), keeping
   * out-of-band callers and synthetic fixtures safe.
   */
  recommendedNodeLimit?: number;
  /**
   * Per-invocation override of the recommended cap (when `--max-nodes
   * <N>` was passed). `null` (or absent) means no override; the
   * recommended limit applies. Bidirectional: any positive integer
   * replaces the recommended limit for the duration of this scan.
   */
  overrideMaxNodes?: number | null;
  /**
   * Mirror of `scan.maxFileSizeBytes` (default 1 MiB). Threaded into
   * `walkAndExtract` so the walker skips any file larger than this
   * BEFORE reading it; skipped files surface in
   * `ScanResult.oversizedFiles` and `stats.filesOversized`. Absent → no
   * size limit (out-of-band callers and synthetic fixtures stay safe).
   */
  maxFileSizeBytes?: number;
}

/**
 * Same as `runScan` but also returns the rename heuristic's `RenameOp[]`
 * the high- and medium-confidence renames the persistence layer must
 * apply to `state_*` rows inside the same tx as the scan zone replace-
 * all (per `spec/db-schema.md` §Rename detection). Most callers want
 * `runScan` (which returns just `ScanResult`); the CLI's `sm scan`
 * uses this variant so it can hand the ops off to `persistScanResult`.
 *
 * Also returns `extractorRuns`, the Spec § A.9 fine-grained cache
 * breadcrumbs the CLI persists into `scan_extractor_runs` so the next
 * incremental scan can decide per-(node, extractor) whether re-running
 * is required.
 */
export async function runScanWithRenames(
  _kernel: Kernel,
  options: RunScanOptions,
): Promise<{
  result: ScanResult;
  renameOps: RenameOp[];
  extractorRuns: IExtractorRunRecord[];
  enrichments: IEnrichmentRecord[];
  contributions: IContributionRecord[];
  contributionErrors: IContributionErrorRecord[];
  freshlyRunTuples: ReadonlySet<string>;
}> {
  return runScanInternal(_kernel, options);
}

export async function runScan(
  _kernel: Kernel,
  options: RunScanOptions,
): Promise<ScanResult> {
  const { result } = await runScanInternal(_kernel, options);
  return result;
}

// eslint-disable-next-line complexity
async function runScanInternal(
  _kernel: Kernel,
  options: RunScanOptions,
): Promise<{
  result: ScanResult;
  renameOps: RenameOp[];
  extractorRuns: IExtractorRunRecord[];
  enrichments: IEnrichmentRecord[];
  contributions: IContributionRecord[];
  contributionErrors: IContributionErrorRecord[];
  freshlyRunTuples: ReadonlySet<string>;
}> {
  validateRoots(options.roots);

  const setup = await buildScanSetup(options);
  const { emitter, exts, hookDispatcher, encoder, prior, start } = setup;

  const scanStartedEvent = makeEvent('scan.started', { roots: options.roots });
  emitter.emit(scanStartedEvent);
  await hookDispatcher.dispatch('scan.started', scanStartedEvent);

  const activeProviderId = resolveActiveProviderOption(
    options.activeProvider,
    options.roots,
    exts.providers,
  );
  // Tokenizer-change invalidation (project-config.schema.json
  // §tokenizer "Changing this invalidates prior counts on next scan").
  // The incremental cache reuses per-node `tokens` from the prior
  // snapshot; those counts were produced by whatever encoder the prior
  // scan recorded in `scan_meta.tokenizer`. When the resolved encoder
  // for THIS scan differs (or the prior never recorded one), the cached
  // counts are stale and the walker must take the fresh-build path so
  // `buildNode` recomputes `tokens` with the current encoder. Full
  // scans already recompute (no prior reuse); this only matters when
  // `enableCache` is on and tokenization is active.
  const tokenizerChanged =
    encoder !== null && prior !== null && prior.tokenizer !== setup.tokenizer;
  const walked = await walkAndExtract({
    providers: exts.providers,
    extractors: exts.extractors,
    roots: options.roots,
    ...(options.ignoreFilter ? { ignoreFilter: options.ignoreFilter } : {}),
    emitter,
    encoder,
    strict: setup.strict,
    enableCache: setup.enableCache,
    tokenizerChanged,
    prior,
    priorIndex: setup.priorIndex,
    priorExtractorRuns: setup.priorExtractorRuns,
    providerFrontmatter: setup.providerFrontmatter,
    pluginStores: options.pluginStores,
    activeProvider: activeProviderId,
    recommendedNodeLimit: options.recommendedNodeLimit ?? 256,
    overrideMaxNodes: options.overrideMaxNodes ?? null,
    ...(options.maxFileSizeBytes !== undefined
      ? { maxFileSizeBytes: options.maxFileSizeBytes }
      : {}),
  });

  // Signal IR resolver phase. Consumes the `Signal[]` buffer produced by
  // extractors that opted into `ctx.emitSignal`. Materialises winning
  // candidates as Links, annotates each Signal's `resolution` field
  // (winners with `winnerIndex`, losers with `rejectedBy` and a tiebreak
  // reason), and threads the annotated Signals through to analyzers via
  // `IAnalyzerContext.signals` so `core/signal-collision` can surface
  // collisions as `warn` issues. Phase 2.A wires the call; extractor
  // migrations land in Phases 2.B and 2.C. With zero Signals emitted today
  // the call is a no-op that returns empty arrays.
  const activeProvider = activeProviderId
    ? exts.providers.find((p) => p.id === activeProviderId) ?? null
    : null;
  // extractorOrder uses SHORT ids (e.g. 'at-directive') to match the
  // `link.sources` convention every extractor follows: emitLink and
  // emitSignal both record the contributor's short id, and the cache's
  // `partitionLinkSources` lookup keys on short ids too. Keeping the
  // resolver's tiebreak in the same id space avoids id-translation
  // bookkeeping inside the resolver.
  const resolved = resolveSignals({
    signals: walked.signals,
    activeProvider,
    extractorOrder: exts.extractors.map((e) => e.id),
  });
  for (const link of resolved.links) {
    if (isExternalUrlLink(link)) walked.externalLinks.push(link);
    else walked.internalLinks.push(link);
  }
  walked.signals = resolved.resolvedSignals;

  // Post-walk polish over the merged link graph: dedup duplicate
  // (source, target, kind, normalizedTrigger) edges across extractors,
  // then bump resolved invocation links to full confidence. Sequence
  // and rationale per transform live in `post-walk-transforms.ts`; this
  // call is the single seam for adding future post-merge transforms
  // without growing more loose calls here. Runs AFTER the Signal IR
  // resolver above so Signal-materialised Links and direct-emit Links
  // both feed into the same dedup / lift pipeline.
  const postWalkCtx = buildPostWalkTransformCtx(exts.providers, walked.nodes, activeProviderId);
  walked.internalLinks = applyPostWalkTransforms(walked.internalLinks, walked.nodes, postWalkCtx);

  // External pseudo-links (target is http(s)://) drive `externalRefsCount`
  // and are then dropped: never persisted, never seen by analyzers, never in
  // result.links. The string-prefix check is the contract, see
  // external-url-counter/index.ts.
  recomputeLinkCounts(walked.nodes, walked.internalLinks);
  recomputeExternalRefsCount(walked.nodes, walked.externalLinks, walked.cachedPaths);

  await dispatchExtractorCompleted(exts.extractors, emitter, hookDispatcher);

  // Analyzers ALWAYS re-run over the merged graph (no shortcut for
  // incremental scans): the issue set for an "unchanged" node can flip
  // when a sibling node changes.
  const registeredActionIds = new Set(
    _kernel.registry.all('action').map((a) => qualifiedExtensionId(a.pluginId, a.id)),
  );
  const analyzerResult = await runAnalyzers(
    exts.analyzers,
    walked.nodes,
    walked.internalLinks,
    walked.orphanSidecars,
    walked.sidecarRoots,
    options.annotationContributions ?? [],
    options.viewContributions ?? [],
    options.orphanJobFiles ?? [],
    options.referenceablePaths,
    options.cwd,
    registeredActionIds,
    emitter,
    hookDispatcher,
    postWalkCtx.reservedNodePaths,
    walked.signals,
    // Seed the accumulator with orchestrator-emitted frontmatter
    // issues so the aggregate phase (`core/issue-counter`) counts
    // them on the per-node chip. The seeds are echoed back on
    // `analyzerResult.issues`, no explicit push is needed below.
    walked.frontmatterIssues,
  );
  mergeAnalyzerEmissions(walked, analyzerResult, exts.analyzers);
  const issues = analyzerResult.issues;

  // Rename heuristic runs after analyzers so the merged graph is final. The
  // returned `RenameOp[]` flows through to `persistScanResult` so FK
  // migration lands inside the same tx as the scan zone replace-all.
  //
  // `silenced` predicate (3rd arg): when the caller passed an
  // `ignoreFilter`, hand its `ignores(path)` to the rename heuristic
  // so the orphan flagger can skip paths that disappeared from the
  // walk solely because the user added them to `.skillmapignore`
  // between scans. The file still exists on disk; the
  // info-severity orphan would be misleading noise.
  const silenced = options.ignoreFilter
    ? (path: string) => options.ignoreFilter!.ignores(path)
    : undefined;
  const renameOps = prior
    ? detectRenamesAndOrphans(prior, walked.nodes, issues, silenced)
    : [];

  const stats = buildScanStats(walked, issues, start);
  const scanCompletedEvent = makeEvent('scan.completed', { stats });
  emitter.emit(scanCompletedEvent);
  await hookDispatcher.dispatch('scan.completed', scanCompletedEvent);

  return buildScanReturn(walked, issues, renameOps, stats, options, setup);
}

/**
 * Build the per-scan side context the post-walk transforms read from
 * (see `post-walk-transforms.ts` for the consumer side). Three indexes:
 *
 *   - `kindRegistry`: `<providerId>/<kindName>` → kind descriptor. The
 *     compound key is required because two Providers may declare the
 *     same kind name (`claude` and `openai` both ship `agent`); the
 *     post-walk consumer looks up a node by its `provider`/`kind`
 *     tuple, not by `kind` alone.
 *   - `providerResolution`: provider id → `resolution` map. Read at
 *     bump time against the ACTIVE PROVIDER LENS, mirroring the
 *     extractor gate (per `spec/architecture.md` §Provider · resolution
 *     rules). A `@handle` token authored in a `core/markdown` body
 *     under the `claude` lens follows claude's `resolution.mentions`,
 *     the resolver authority matches the extractor authority.
 *   - `reservedNodePaths`: paths of nodes whose normalised identifier(s)
 *     intersect a reserved-names catalog under self scope (the node's own
 *     Provider, e.g. `.claude/commands/help.md` shadowed by Claude's
 *     built-in `/help`) OR lens scope (the active lens lending its catalog
 *     to the universal `agent-skills` skill nodes it consumes, e.g.
 *     `.agents/skills/goal/SKILL.md` shadowed by Antigravity's `/goal`).
 *     The post-walk transform downgrades any link resolving to a node
 *     in this set; the `core/name-reserved` analyzer reads the same
 *     set to emit its warn issue.
 *
 * Indexes are built once per scan (constant cost in the registered
 * provider count + linear scan of nodes for the reserved-paths set).
 */
interface IProviderIndexes {
  readonly kindRegistry: Map<string, IProviderKind>;
  readonly providerResolution: Map<string, Readonly<Record<string, readonly string[]>>>;
  readonly reservedNamesByProviderKind: Map<string, ReadonlySet<string>>;
}

function buildPostWalkTransformCtx(
  providers: readonly IProvider[],
  nodes: readonly Node[],
  activeProvider: string | null,
): IPostWalkTransformCtx {
  const { kindRegistry, providerResolution, reservedNamesByProviderKind } =
    buildProviderIndexes(providers);
  const reservedNodePaths = buildReservedNodePaths(
    nodes,
    kindRegistry,
    reservedNamesByProviderKind,
    activeProvider,
  );
  return { kindRegistry, providerResolution, activeProvider, reservedNodePaths };
}

/**
 * Flatten the registered providers into the three lookup maps the
 * post-walk pipeline reads from. `registry.all('provider')` returns
 * the `IExtension` union shape; the bucket is provider-typed in
 * practice because the kernel registers providers only via
 * `register('provider', ...)`. The unknown hop is load-bearing for
 * the type-checker.
 *
 * Each map is independently optional on the manifest (a Provider that
 * declares only `kinds` and nothing else contributes one entry to
 * `kindRegistry` and zero to the other two), so the loops gate-check
 * each field. `kinds` is guarded too because tests and exotic
 * adapters sometimes register provider stubs without it.
 */
function buildProviderIndexes(providers: readonly IProvider[]): IProviderIndexes {
  const kindRegistry = new Map<string, IProviderKind>();
  const providerResolution = new Map<string, Readonly<Record<string, readonly string[]>>>();
  const reservedNamesByProviderKind = new Map<string, ReadonlySet<string>>();
  for (const provider of providers) {
    if (provider.kinds) {
      for (const [kindName, descriptor] of Object.entries(provider.kinds)) {
        kindRegistry.set(`${provider.id}/${kindName}`, descriptor);
      }
    }
    if (provider.resolution) {
      providerResolution.set(provider.id, provider.resolution);
    }
    if (provider.reservedNames) {
      indexReservedNames(provider, reservedNamesByProviderKind);
    }
  }
  return { kindRegistry, providerResolution, reservedNamesByProviderKind };
}

function indexReservedNames(
  provider: IProvider,
  out: Map<string, ReadonlySet<string>>,
): void {
  for (const [kindName, list] of Object.entries(provider.reservedNames ?? {})) {
    const normalised = new Set(list.map((raw) => normalizeTrigger(raw)).filter(Boolean));
    if (normalised.size > 0) {
      out.set(`${provider.id}/${kindName}`, normalised);
    }
  }
}

/**
 * Intersect each node's normalised identifiers with the reserved names
 * that apply to it under TWO scopes (spec/architecture.md §Provider ·
 * reservedNames):
 *
 *   - **Self scope**: `reservedNames[node.kind]` of the node's own
 *     Provider (Claude flags `.claude/commands/help.md`).
 *   - **Lens scope**: when the active lens classifies nothing itself but
 *     adopts the open standard (Antigravity), its catalog still applies
 *     to the universal `agent-skills` skill nodes its runtime consumes,
 *     matched by kind. Skipped when the lens IS the node's provider (it
 *     would duplicate self scope) or when no lens is resolved.
 *
 * Identifiers are derived once from the node's OWN kind contract; only
 * the reserved-set lookup widens. Both `liftResolvedLinkConfidence`
 * (transform) and `core/name-reserved` (analyzer) consume the same set.
 */
function buildReservedNodePaths(
  nodes: readonly Node[],
  kindRegistry: ReadonlyMap<string, IProviderKind>,
  reservedNamesByProviderKind: ReadonlyMap<string, ReadonlySet<string>>,
  activeProvider: string | null,
): Set<string> {
  const out = new Set<string>();
  for (const node of nodes) {
    const selfKey = `${node.provider}/${node.kind}`;
    const selfReserved = reservedNamesByProviderKind.get(selfKey);
    const lensReserved =
      activeProvider && activeProvider !== node.provider
        ? reservedNamesByProviderKind.get(`${activeProvider}/${node.kind}`)
        : undefined;
    if (!hasEntries(selfReserved) && !hasEntries(lensReserved)) continue;
    const ids = deriveNodeIdentifiers(node, kindRegistry.get(selfKey));
    if (ids.some((id) => selfReserved?.has(id) === true || lensReserved?.has(id) === true)) {
      out.add(node.path);
    }
  }
  return out;
}

function hasEntries(set: ReadonlySet<string> | undefined): boolean {
  return set !== undefined && set.size > 0;
}

interface IScanSetup {
  start: number;
  scannedAt: number;
  emitter: ProgressEmitterPort;
  exts: NonNullable<RunScanOptions['extensions']>;
  hookDispatcher: IHookDispatcher;
  encoder: Tiktoken | null;
  /**
   * Resolved encoder name that built `encoder` (default `cl100k_base`).
   * Carried onto `ScanResult.tokenizer` and persisted into `scan_meta`
   * so the next incremental scan can detect an encoder switch. Set even
   * when `encoder === null` (tokenization off), so the persisted name
   * still reflects the operator's configured intent.
   */
  tokenizer: TTokenizerName;
  prior: ScanResult | null;
  priorIndex: IPriorIndex;
  priorExtractorRuns: Map<string, Map<string, IPriorExtractorRun>> | undefined;
  providerFrontmatter: IProviderFrontmatterValidator;
  strict: boolean;
  enableCache: boolean;
}

/**
 * Resolve every per-scan invariant (emitter, encoder, prior index,
 * extension buckets, dispatcher) so `runScanInternal` stays a linear
 * sequence of phase calls instead of a 30-line setup preamble.
 *
 * Spec § A.9, `priorExtractorRuns === undefined` means the caller
 * doesn't track the fine-grained Extractor cache (legacy behaviour:
 * out-of-band tests, alternate driving adapters that have no DB).
 * That case falls back to the pre-A.9 model where the node-level body
 * / frontmatter hash check is sufficient. Passing an explicit
 * (possibly empty) Map opts the caller into the fine-grained path.
 */
async function buildScanSetup(options: RunScanOptions): Promise<IScanSetup> {
  const start = Date.now();
  const emitter = options.emitter ?? new InMemoryProgressEmitter();
  const exts = options.extensions ?? { providers: [], extractors: [], analyzers: [] };
  const hookDispatcher = makeHookDispatcher(exts.hooks ?? [], emitter);
  const tokenize = options.tokenize !== false;
  // Resolve the encoder name (guarding the override layer) and lazily
  // load only that rank table. The encoder is heavyweight to construct
  // (loads the BPE table once); reuse a single instance across the whole
  // scan. `tokenizer` is resolved even when tokenization is off so the
  // persisted `scan_meta.tokenizer` still records the configured intent.
  const tokenizer = resolveTokenizerName(options.tokenizer);
  const encoder = tokenize ? new Tiktoken(await loadTokenizerRanks(tokenizer)) : null;
  const prior = options.priorSnapshot ?? null;
  const priorIndex = indexPriorSnapshot(prior);
  // Spec 0.8.0: each Provider owns its per-kind frontmatter schemas.
  // Compose a single AJV-backed validator over the live set of
  // Providers so the orchestrator can ask it directly during the walk.
  const providerFrontmatter = buildProviderFrontmatterValidator(exts.providers);
  return {
    start,
    scannedAt: start,
    emitter,
    exts,
    hookDispatcher,
    encoder,
    tokenizer,
    prior,
    priorIndex,
    priorExtractorRuns: options.priorExtractorRuns,
    providerFrontmatter,
    strict: options.strict === true,
    enableCache: options.enableCache === true,
  };
}

/**
 * Spec § A.11, emit one `extractor.completed` event per registered
 * extractor after the full walk completes. Aggregated (no per-node
 * fan-out, that lives in `scan.progress` which is deliberately NOT
 * hookable).
 */
async function dispatchExtractorCompleted(
  extractors: readonly IExtractor[],
  emitter: ProgressEmitterPort,
  hookDispatcher: IHookDispatcher,
): Promise<void> {
  for (const extractor of extractors) {
    const extractorId = qualifiedExtensionId(extractor.pluginId, extractor.id);
    const evt = makeEvent('extractor.completed', { extractorId });
    emitter.emit(evt);
    await hookDispatcher.dispatch('extractor.completed', evt);
  }
}

/**
 * Merge analyzer-side emissions into the walk's accumulators:
 *
 *   - analyzer-emitted view contributions ride into the same per-scan
 *     buffer extractor-emitted contributions populate.
 *   - Phase 3: fold a tuple per `(analyzer × node)` into
 *     `freshlyRunTuples` so the persist layer's per-tuple sweep can
 *     drop stale analyzer-emitted rows when an analyzer stops emitting
 *     for a previously-emitting node.
 */
function mergeAnalyzerEmissions(
  walked: IWalkAndExtractResult,
  analyzerResult: {
    contributions: IContributionRecord[];
    contributionErrors: IContributionErrorRecord[];
  },
  analyzers: readonly IAnalyzer[] | undefined,
): void {
  for (const c of analyzerResult.contributions) walked.contributions.push(c);
  // "off-shape visible" follow-up, fold analyzer-rejected emissions into
  // the same buffer extractor-rejected ones populate.
  for (const e of analyzerResult.contributionErrors) walked.contributionErrors.push(e);
  for (const analyzer of analyzers ?? []) {
    if (analyzer.ui === undefined) continue;
    for (const node of walked.nodes) {
      // NUL-separated so `nodePath` segments with slashes
      // (e.g. `.claude/agents/architect.md`) survive parsing in
      // `replaceAllScanContributions`. The `/`-separated form caused
      // `lastIndexOf('/')` to chop the wrong segment, leaving
      // analyzer-emitted rows orphaned on disable / state-flip.
      walked.freshlyRunTuples.add(`${analyzer.pluginId}\0${analyzer.id}\0${node.path}`);
    }
  }
}

function buildScanStats(
  walked: IWalkAndExtractResult,
  issues: Issue[],
  start: number,
): ScanResult['stats'] {
  return {
    // `filesSkipped` is "files walked but not classified by any
    // Provider". Today every walked file IS classified by its Provider
    // (the `claude` Provider's `classify()` always returns a kind,
    // falling back to `'markdown'`), so this is always 0. Wired now
    // so the field shape is spec-conformant; meaningful once multiple
    // Providers compete.
    filesWalked: walked.filesWalked,
    filesSkipped: 0,
    filesOversized: walked.oversizedFiles.length,
    nodesCount: walked.nodes.length,
    linksCount: walked.internalLinks.length,
    issuesCount: issues.length,
    durationMs: Date.now() - start,
  };
}

function buildScanReturn(
  walked: IWalkAndExtractResult,
  issues: Issue[],
  renameOps: RenameOp[],
  stats: ScanResult['stats'],
  options: RunScanOptions,
  setup: IScanSetup,
): {
  result: ScanResult;
  renameOps: RenameOp[];
  extractorRuns: IExtractorRunRecord[];
  enrichments: IEnrichmentRecord[];
  contributions: IContributionRecord[];
  contributionErrors: IContributionErrorRecord[];
  freshlyRunTuples: ReadonlySet<string>;
} {
  return {
    result: {
      schemaVersion: 1,
      scannedAt: setup.scannedAt,
      roots: options.roots,
      providers: setup.exts.providers.map((a) => a.id),
      scannedBy: SCANNED_BY,
      tokenizer: setup.tokenizer,
      recommendedNodeLimit: walked.recommendedNodeLimit,
      overrideMaxNodes: walked.overrideMaxNodes,
      oversizedFiles: walked.oversizedFiles,
      nodes: walked.nodes,
      links: walked.internalLinks,
      issues,
      stats,
    },
    renameOps,
    extractorRuns: walked.extractorRuns,
    enrichments: walked.enrichments,
    contributions: walked.contributions,
    contributionErrors: walked.contributionErrors,
    freshlyRunTuples: walked.freshlyRunTuples,
  };
}

/**
 * Validate every root exists as a directory BEFORE any IO, BEFORE the
 * tokenizer is constructed, BEFORE `scan.started` fires. Throws on the
 * first failure, single-error feedback is enough; the user fixes it
 * and re-runs. Without this guard the claude Provider's `walk()` swallows
 * ENOENT inside `readdir` and returns silently, which lets a non-existent
 * root produce a valid-looking zero-filled `ScanResult`, directly
 * enabling the `sm scan -- --dry-run` typo-trap that wipes a populated
 * DB.
 *
 * Spec contract (`scan-result.schema.json#/properties/roots/minItems: 1`):
 * a ScanResult must report at least one walked root. The CLI defaults
 * `roots` to `['.']` when no positional args are supplied, so the
 * empty-array branch is a programming error from the CLI surface.
 */
function validateRoots(roots: string[]): void {
  if (roots.length === 0) {
    throw new Error(ORCHESTRATOR_TEXTS.runScanRootEmptyArray);
  }
  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      throw new Error(tx(ORCHESTRATOR_TEXTS.runScanRootMissing, { root }));
    }
  }
}

/**
 * Resolve the active lens for one scan. Three branches, in priority order:
 *
 *   1. Explicit `string` from the caller wins verbatim.
 *   2. Explicit `null` from the caller is "no lens" (spec-strict skip
 *      of provider-specific extractors).
 *   3. `undefined` from the caller triggers filesystem auto-detect from
 *      the scan roots. Convenience default for integration tests and
 *      embedders that don't thread a settings reader. Production
 *      callers (`scan-runner`) resolve upstream and pass branches 1/2
 *      explicitly, never branch 3.
 *
 * Auto-detect scans the first root that resolves to an existing dir
 * and returns the first filesystem-detected provider id (per
 * `kernel/scan/detect-providers#detectProvidersFromFilesystem`). This
 * is the pure marker scan only, NO persisted-config read: a caller that
 * wants the `settings.json` `activeProvider` to win resolves it upstream
 * (core's `resolveActiveProvider`) and passes `string | null` explicitly.
 * When no root carries a marker, returns `null`.
 */
function resolveActiveProviderOption(
  optionValue: string | null | undefined,
  roots: readonly string[],
  providers: readonly IProvider[],
): string | null {
  if (optionValue !== undefined) return optionValue;
  for (const root of roots) {
    const absRoot = isAbsolute(root) ? root : resolve(root);
    if (!existsSync(absRoot)) continue;
    const detected = detectProvidersFromFilesystem(absRoot, providers)[0] ?? null;
    if (detected !== null) return detected;
  }
  return null;
}
