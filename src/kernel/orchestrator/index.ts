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

// js-tiktoken ships CJS subpaths without explicit `.cjs` in the import
// specifier, the lint rule's hard-coded extension matrix doesn't model
// dual-package CJS subpath exports.
// eslint-disable-next-line import-x/extensions
import { Tiktoken } from 'js-tiktoken/lite';
// eslint-disable-next-line import-x/extensions
import cl100k_base from 'js-tiktoken/ranks/cl100k_base';

import pkg from '../../package.json' with { type: 'json' };

import { InMemoryProgressEmitter } from '../adapters/in-memory-progress.js';
import { installedSpecVersion } from '../adapters/plugin-loader.js';
import type { IPluginStore } from '../adapters/plugin-store.js';
import {
  buildProviderFrontmatterValidator,
  type IProviderFrontmatterValidator,
} from '../adapters/schema-validators.js';
import type { IContributionRecord } from '../adapters/sqlite/contributions.js';
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
  ScanResult,
  ScanScannedBy,
} from '../types.js';
import type { IRegisteredAnnotationKey } from '../types/annotation-catalog.js';
import type { IRegisteredViewContribution } from '../types/view-catalog.js';
import { tx } from '../util/tx.js';
import { runAnalyzers } from './analyzers.js';
import {
  indexPriorSnapshot,
  type IPriorIndex,
} from './cache.js';
import {
  recomputeExternalRefsCount,
  recomputeLinkCounts,
  type IEnrichmentRecord,
  type IExtractorRunRecord,
} from './extractors.js';
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
   * Threaded into the rule pass so `core/unknown-field` can
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
   * Scan scope. Defaults to `'project'`. The CLI flag wiring lands in
   * the config layer wiring; `runScan` already accepts the override
   * so plugins / tests can opt into `'global'` today.
   */
  scope?: 'project' | 'global';
  /**
   * Compute per-node token counts (frontmatter / body / total) using the
   * cl100k_base BPE (the modern OpenAI tokenizer used by GPT-4 / GPT-3.5).
   * Defaults to true. Set false to skip tokenization; `node.tokens` is
   * left undefined (spec-valid: the field is optional).
   */
  tokenize?: boolean;
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
  pluginStores?: ReadonlyMap<string, IPluginStore>;
  /**
   * Pre-computed absolute paths of orphan job MD files (files under
   * `.skill-map/jobs/` whose absolute path appears nowhere in
   * `state_jobs.filePath`). Threaded into the rule pass so the
   * built-in `core/job-orphan-file` rule can project each as a `warn`
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
   * `core/broken-ref` rule can suppress its `warn` for path-style
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

async function runScanInternal(
  _kernel: Kernel,
  options: RunScanOptions,
): Promise<{
  result: ScanResult;
  renameOps: RenameOp[];
  extractorRuns: IExtractorRunRecord[];
  enrichments: IEnrichmentRecord[];
  contributions: IContributionRecord[];
  freshlyRunTuples: ReadonlySet<string>;
}> {
  validateRoots(options.roots);

  const setup = buildScanSetup(options);
  const { emitter, exts, hookDispatcher, encoder, prior, start } = setup;

  const scanStartedEvent = makeEvent('scan.started', { roots: options.roots });
  emitter.emit(scanStartedEvent);
  await hookDispatcher.dispatch('scan.started', scanStartedEvent);

  const walked = await walkAndExtract({
    providers: exts.providers,
    extractors: exts.extractors,
    roots: options.roots,
    ...(options.ignoreFilter ? { ignoreFilter: options.ignoreFilter } : {}),
    emitter,
    encoder,
    strict: setup.strict,
    enableCache: setup.enableCache,
    prior,
    priorIndex: setup.priorIndex,
    priorExtractorRuns: setup.priorExtractorRuns,
    providerFrontmatter: setup.providerFrontmatter,
    pluginStores: options.pluginStores,
  });

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
  );
  mergeAnalyzerEmissions(walked, analyzerResult, exts.analyzers);
  const issues = analyzerResult.issues;
  // Frontmatter-invalid issues from the walk land here so the rename
  // heuristic (next pass) sees them and the final stats.issuesCount
  // reflects them.
  for (const issue of walked.frontmatterIssues) issues.push(issue);

  // Rename heuristic runs after analyzers so the merged graph is final. The
  // returned `RenameOp[]` flows through to `persistScanResult` so FK
  // migration lands inside the same tx as the scan zone replace-all.
  const renameOps = prior ? detectRenamesAndOrphans(prior, walked.nodes, issues) : [];

  const stats = buildScanStats(walked, issues, start);
  const scanCompletedEvent = makeEvent('scan.completed', { stats });
  emitter.emit(scanCompletedEvent);
  await hookDispatcher.dispatch('scan.completed', scanCompletedEvent);

  return buildScanReturn(walked, issues, renameOps, stats, options, setup);
}

interface IScanSetup {
  start: number;
  scannedAt: number;
  emitter: ProgressEmitterPort;
  exts: NonNullable<RunScanOptions['extensions']>;
  hookDispatcher: IHookDispatcher;
  encoder: Tiktoken | null;
  prior: ScanResult | null;
  priorIndex: IPriorIndex;
  priorExtractorRuns: Map<string, Map<string, IPriorExtractorRun>> | undefined;
  providerFrontmatter: IProviderFrontmatterValidator;
  scope: 'project' | 'global';
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
function buildScanSetup(options: RunScanOptions): IScanSetup {
  const start = Date.now();
  const emitter = options.emitter ?? new InMemoryProgressEmitter();
  const exts = options.extensions ?? { providers: [], extractors: [], analyzers: [] };
  const hookDispatcher = makeHookDispatcher(exts.hooks ?? [], emitter);
  const tokenize = options.tokenize !== false;
  // Encoder is heavyweight to construct (loads the cl100k_base BPE
  // table once); reuse a single instance across the whole scan.
  const encoder = tokenize ? new Tiktoken(cl100k_base) : null;
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
    prior,
    priorIndex,
    priorExtractorRuns: options.priorExtractorRuns,
    providerFrontmatter,
    scope: options.scope ?? 'project',
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
  analyzerResult: { contributions: IContributionRecord[] },
  analyzers: readonly IAnalyzer[] | undefined,
): void {
  for (const c of analyzerResult.contributions) walked.contributions.push(c);
  for (const analyzer of analyzers ?? []) {
    if (analyzer.viewContributions === undefined) continue;
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
  freshlyRunTuples: ReadonlySet<string>;
} {
  return {
    result: {
      schemaVersion: 1,
      scannedAt: setup.scannedAt,
      scope: setup.scope,
      roots: options.roots,
      providers: setup.exts.providers.map((a) => a.id),
      scannedBy: SCANNED_BY,
      nodes: walked.nodes,
      links: walked.internalLinks,
      issues,
      stats,
    },
    renameOps,
    extractorRuns: walked.extractorRuns,
    enrichments: walked.enrichments,
    contributions: walked.contributions,
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
