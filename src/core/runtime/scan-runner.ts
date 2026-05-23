/**
 * Kernel-thin runner for `sm scan`. Owns the wiring chain, plugin
 * runtime, config + ignore filter, prior-snapshot load, single
 * `withSqlite` open for persist, dry-run / non-persist branch, and
 * surfaces a discriminated `IScanRunResult` the caller renders.
 *
 * Pulled out of `cli/commands/scan.ts:run()` so the orchestrator
 * shrinks to flag parsing → runner invocation → render → exit code,
 * mirroring what `runWatchLoop` does for the watch verb.
 *
 * Lives under `core/runtime/` so the BFF (`src/server/`) can consume it
 * without crossing into `src/cli/`. Historic `cli/util/scan-runner.ts`
 * keeps working through a re-export shim there.
 */

import { createKernel, runScan, runScanWithRenames } from '../../kernel/index.js';
import type {
  IEnrichmentRecord,
  IExtractorRunRecord,
  RenameOp,
  ScanResult,
} from '../../kernel/index.js';
import type { IContributionRecord } from '../../kernel/adapters/sqlite/contributions.js';
import type { IPriorExtractorRun } from '../../kernel/adapters/sqlite/scan-load.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { findOrphanJobFiles } from '../../kernel/jobs/orphan-files.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { buildIgnoreFilter, readIgnoreFileText } from '../../kernel/scan/ignore.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { createStderrProgressEmitter } from './progress-emitter.js';
import type { IPrinter } from './printer.js';
import { SCAN_RUNNER_TEXTS } from './i18n/scan-runner.texts.js';
import { defaultProjectJobsDir, resolveDbPath } from '../paths/db-path.js';
import { resolveScanRoots } from './scan-roots.js';
import { walkReferencePaths } from './reference-paths-walker.js';
import {
  bootstrapActiveProvider,
  warnIfLensBundleDisabled,
} from './active-provider-bootstrap.js';
import { tryWithSqlite, withSqlite } from '../sqlite/with-sqlite.js';
import {
  collectRegisteredContributionKeys,
  composeScanExtensions,
  emptyPluginRuntime,
  loadPluginRuntime,
  registerEnabledExtensions,
  type IConformanceKillSwitches,
  type IPluginRuntimeBundle,
} from './plugin-runtime.js';
import { defaultRuntimeContext, type IRuntimeContext } from './runtime-context.js';

export interface IScanRunOpts {
  /**
   * Positional roots from `sm scan [roots...]`. When non-empty, used
   * verbatim (resolved against `cwd`). When empty, the runner derives
   * the effective roots from the loaded config per
   * `spec/cli-contract.md` § Scan / Effective roots:
   *   - cwd + scan.extraFolders (the only way to extend beyond cwd).
   */
  roots: string[];
  noBuiltIns: boolean;
  noPlugins: boolean;
  noTokens: boolean;
  dryRun: boolean;
  changed: boolean;
  allowEmpty: boolean;
  strict: boolean;
  /**
   * Stream used for kernel progress events and the "changed but no
   * prior" advisory. Plugin warnings flow through `printer.warn`,
   * not this stream.
   */
  stderr: NodeJS.WritableStream;
  /**
   * Channel discipline for the runner's plugin-warning emission and
   * any future advisory. Mandatory (audit M8): the historic optional
   * fallback wired stdout to stderr inside the runner, which means
   * `printer.data()` would land on stderr if anyone added a `data`
   * line later, a footgun the BFF and CLI shapes diverge on
   * silently. Callers MUST construct an explicit printer:
   *   - CLI verbs pass their `SmCommand`-owned printer (honours
   *     `--quiet`).
   *   - BFF passes a tiny purpose-built printer that routes
   *     warn/info/error to `log.warn` and discards `data` (the
   *     fresh-scan branch never emits data through the printer; the
   *     ScanResult is the response body).
   */
  printer: IPrinter;
  /** Optional injected runtime context for tests (defaults to `defaultRuntimeContext()`). */
  ctx?: IRuntimeContext;
  /**
   * Conformance kill-switches resolved at the CLI adapter boundary
   * (`cli/util/conformance-env.ts: readConformanceKillSwitches`).
   * Production callers leave this undefined; the conformance runner
   * sets the per-kind booleans so the composer drops every extension
   * of the chosen kind.
   */
  killSwitches?: IConformanceKillSwitches;
  /**
   * Pre-loaded plugin runtime bundle (audit M3). When set, the runner
   * skips its own `loadPluginRuntime` call and consumes this bundle
   * directly, used by the BFF to share the boot-cached discovery
   * across `?fresh=1` requests instead of re-walking the filesystem +
   * recompiling AJV validators per call. CLI verbs leave this
   * undefined; they pay the discovery cost once per `sm scan`
   * invocation.
   */
  pluginRuntime?: IPluginRuntimeBundle;
  /**
   * Optional resolver override that the composer threads into
   * `composeScanExtensions(..., resolveEnabled)`. The BFF builds this
   * fresh from `config_plugins` on every `POST /api/scan` / watcher
   * batch so a mid-session toggle is honoured without restarting
   * `sm serve` (see `core/runtime/fresh-resolver.ts`). CLI offline
   * callers (`sm scan`) leave this undefined, the bundle is reloaded
   * per invocation anyway, so the cached `pluginRuntime.resolveEnabled`
   * is already fresh.
   */
  resolveEnabledOverride?: (id: string) => boolean;
  /**
   * Forwarded to `createStderrProgressEmitter` so the inline `⚠`
   * advisory for off-contract drops picks up yellow color in TTY
   * runs. Resolved at the CLI boundary (`ansiFor(...)`); BFF callers
   * leave it undefined / false.
   */
  colorEnabled?: boolean;
  /**
   * Optional kernel-event emitter override. When provided, the runner
   * passes `factory()` to `runScanWithRenames` instead of building a
   * stderr-bound progress emitter from `opts.stderr`. Used by the BFF's
   * `POST /api/scan` route so kernel events (`scan.started` /
   * `scan.completed` / per-extractor / per-rule) flow into the WS
   * broadcaster, same wiring the watcher uses for its debounced
   * batches. CLI verbs leave this undefined and pay the stderr-emitter
   * cost.
   */
  emitterFactory?: () => import('../../kernel/ports/progress-emitter.js').ProgressEmitterPort;
  /**
   * Non-interactive mode for active-provider auto-detect. When `true`,
   * an ambiguous detection (multiple provider markers under the scan
   * tree) returns `kind: 'ambiguous-provider'` instead of prompting.
   * When `false` (default), the runner reads stdin to let the operator
   * pick the active lens. BFF callers (no TTY) MUST pass `true`.
   */
  yes?: boolean;
  /**
   * Stdin for the interactive lens picker. Defaults to `process.stdin`
   * when omitted; tests override to drive scripted input. Ignored when
   * `yes: true`.
   */
  stdin?: NodeJS.ReadableStream;
  /**
   * Pre-rendered glyphs + dim wrapper for the human-mode active-provider
   * prompt and the ambiguous-under-yes error block, per
   * `context/cli-output-style.md`. The CLI verb resolves colour via
   * `ansiFor` (which reads env / TTY / `--no-color`) and threads the
   * result here so `core/runtime/` does not need to touch
   * `process.env` itself. BFF / non-TTY callers can omit the field and
   * the runner falls back to bare glyphs with no ANSI escapes.
   */
  style?: {
    warnGlyph?: string;
    errorGlyph?: string;
    dim?: (s: string) => string;
  };
}

/**
 * Outcome of a scan invocation. The success kind carries the strict
 * flag so the caller knows whether to self-validate the result before
 * emitting `--json` (only `strict` runs do).
 */
export type IScanRunResult =
  | {
      kind: 'ok';
      result: ScanResult;
      renameOps: RenameOp[];
      persistedTo: string | null;
      dbPath: string;
      strict: boolean;
    }
  | { kind: 'config-error'; message: string }
  | { kind: 'scan-error'; message: string }
  | { kind: 'guard-trip'; existing: number }
  /**
   * Active-provider auto-detect found multiple markers AND
   * `yes: true` (or stdin had no valid input). The caller exits with
   * a non-zero code so the operator picks one via
   * `sm config set activeProvider <id>` and re-runs.
   */
  | { kind: 'ambiguous-provider'; detected: readonly string[]; message: string };

/**
 * Drive the full `sm scan` pipeline against the given options bag.
 * Returns one of `IScanRunResult`, the caller renders human / JSON
 * output and maps the kind to an `ExitCode`.
 */
export async function runScanForCommand(opts: IScanRunOpts): Promise<IScanRunResult> {
  const ctx = opts.ctx ?? defaultRuntimeContext();
  // `sm scan` is always project-scoped: DB + config resolve under
  // `<cwd>/.skill-map/`. Per `spec/cli-contract.md` §Scope is always
  // project-local, the verb does not honour any HOME-walking flag
  // because no implicit `$HOME` read is allowed.
  const dbPath = resolveDbPath({ db: undefined, ...ctx });

  const kernel = createKernel();
  const pluginRuntime = await preparePluginRuntime(opts, opts.printer);
  const extensions = registerExtensions(kernel, pluginRuntime, opts);

  const scanInputs = loadScanInputs(opts, ctx);
  if ('kind' in scanInputs) return scanInputs;
  const { cfg, ignoreFilter, strict, effectiveRoots } = scanInputs;

  // Walk reference paths into a side set. Lazy: skip the walk when the
  // operator left `scan.referencePaths` empty (the common case).
  let referenceablePaths: ReadonlySet<string> | undefined;
  if (cfg.scan.referencePaths.length > 0) {
    const walk = walkReferencePaths(cfg.scan.referencePaths, ctx.cwd);
    referenceablePaths = walk.paths;
    emitReferenceWalkAdvisory(walk, opts);
  }

  const loadPrior = makePriorLoader(opts.noBuiltIns, strict);
  const jobsDir = defaultProjectJobsDir(ctx);
  const lens = await resolveActiveLens(opts, ctx, effectiveRoots, pluginRuntime);
  if (lens.kind === 'ambiguous-provider') return lens;
  const activeProvider = lens.activeProvider;
  const runScanWith = makeScanRunner(
    kernel,
    opts,
    effectiveRoots,
    ignoreFilter,
    strict,
    extensions,
    referenceablePaths,
    ctx.cwd,
    activeProvider,
  );

  const willPersist = !opts.noBuiltIns && !opts.dryRun;
  return willPersist
    ? runPersistPath(opts, dbPath, jobsDir, strict, loadPrior, runScanWith, extensions)
    : runEphemeralPath(opts, dbPath, strict, loadPrior, runScanWith);
}

/**
 * Resolve the active lens once at scan entry (spec/cli-contract.md
 * §Auto-detect). The bootstrapper persists the detected id when the
 * match is unambiguous, prompts the operator when ambiguous (or
 * returns `ambiguous-provider` under `yes: true` so the caller can
 * exit non-zero), and warns + continues with `null` when no marker is
 * present anywhere. The resulting value is threaded through
 * `computeCacheDecision` to gate provider-specific extractors
 * (spec/architecture.md §Universal extractors and per-provider
 * extractors). When the resolved lens points at a bundle the operator
 * has disabled the scan still continues, but a warning fires so the
 * operator doesn't read the missing extractors as a bug. The BFF
 * resolve-enabled override is honoured so mid-session toggles land.
 */
// eslint-disable-next-line complexity
async function resolveActiveLens(
  opts: IScanRunOpts,
  ctx: ReturnType<typeof defaultRuntimeContext>,
  effectiveRoots: readonly string[],
  pluginRuntime: Awaited<ReturnType<typeof preparePluginRuntime>>,
): Promise<{ kind: 'ok'; activeProvider: string | null } | (IScanRunResult & { kind: 'ambiguous-provider' })> {
  const bootstrap = await bootstrapActiveProvider({
    cwd: ctx.cwd,
    effectiveRoots,
    yes: opts.yes ?? false,
    stdin: opts.stdin ?? process.stdin,
    stderr: opts.stderr,
    printer: opts.printer,
    ...(opts.style ? { style: opts.style } : {}),
  });
  if (bootstrap.kind === 'ambiguous') {
    // Two-line error block per `context/cli-output-style.md` §3.1b. The
    // caller (CLI verb) pre-rendered the glyph + dim wrapper through
    // `opts.style` so this surface stays colour-free at the seam.
    const errorGlyph = opts.style?.errorGlyph ?? '✕';
    const dim = opts.style?.dim ?? ((s: string) => s);
    return {
      kind: 'ambiguous-provider',
      detected: bootstrap.detected,
      message: tx(SCAN_RUNNER_TEXTS.activeProviderAmbiguousUnderYes, {
        glyph: errorGlyph,
        candidates: bootstrap.detected.join(', '),
        hint: dim(SCAN_RUNNER_TEXTS.activeProviderAmbiguousUnderYesHint),
      }),
    };
  }
  warnIfLensBundleDisabled({
    activeProvider: bootstrap.activeProvider,
    resolveEnabled: opts.resolveEnabledOverride ?? pluginRuntime.resolveEnabled,
    printer: opts.printer,
  });
  return { kind: 'ok', activeProvider: bootstrap.activeProvider };
}

function emitReferenceWalkAdvisory(
  walk: ReturnType<typeof walkReferencePaths>,
  opts: IScanRunOpts,
): void {
  if (walk.truncated) {
    opts.printer.warn(SCAN_RUNNER_TEXTS.referenceWalkTruncated);
  }
  for (const missing of walk.missingRoots) {
    opts.printer.warn(
      tx(SCAN_RUNNER_TEXTS.referenceWalkMissingRoot, { path: missing }),
    );
  }
}

/**
 * Discovery + warnings emission. `opts.pluginRuntime` (M3) short-
 * circuits the load when the caller already has a bundle in hand
 * (BFF boot snapshot); `--no-plugins` short-circuits to an empty
 * bundle (no DB / config reads, no FS walk under
 * `.skill-map/plugins/`). Warnings emit through the printer regardless
 * the CLI surfaces them per-invocation; the BFF emits a tiny no-op
 * printer so the warnings only land where the boot already logged
 * them.
 */
async function preparePluginRuntime(opts: IScanRunOpts, printer: IPrinter) {
  if (opts.pluginRuntime) {
    // Caller-supplied bundle: warnings were already surfaced at the
    // caller's boot path. Skip emission to avoid duplicating them
    // every `?fresh=1` request.
    return opts.pluginRuntime;
  }
  const pluginRuntime = opts.noPlugins
    ? emptyPluginRuntime()
    : await loadPluginRuntime();
  pluginRuntime.emitWarnings(printer);
  return pluginRuntime;
}

/**
 * Register manifests on the kernel registry and return the composed
 * extension set the runner threads into `runScanWithRenames`.
 * Granularity filter: a user-disabled built-in is silenced from the
 * registry too so introspection (`sm help`, `sm plugins list`) does
 * not advertise it as active.
 */
function registerExtensions(
  kernel: ReturnType<typeof createKernel>,
  pluginRuntime: Awaited<ReturnType<typeof preparePluginRuntime>>,
  opts: IScanRunOpts,
): ReturnType<typeof composeScanExtensions> {
  const composeOpts: Parameters<typeof composeScanExtensions>[0] = {
    noBuiltIns: opts.noBuiltIns,
    pluginRuntime,
  };
  if (opts.killSwitches) composeOpts.killSwitches = opts.killSwitches;
  if (opts.resolveEnabledOverride) composeOpts.resolveEnabled = opts.resolveEnabledOverride;
  const extensions = composeScanExtensions(composeOpts);
  const registerOpts: Parameters<typeof registerEnabledExtensions>[2] = {
    noBuiltIns: opts.noBuiltIns,
  };
  if (opts.resolveEnabledOverride) registerOpts.resolveEnabled = opts.resolveEnabledOverride;
  registerEnabledExtensions(kernel, pluginRuntime, registerOpts);
  return extensions;
}

/**
 * Resolve the static scan inputs (layered config + scan-time ignore
 * filter + strict flag + effective roots) or return a `config-error`
 * result when either load throws. Bundling both loads here keeps the
 * runner's main body free of the two try/catch shapes that handle the
 * same failure mode.
 *
 * Effective roots: positional roots win verbatim; otherwise the runner
 * defaults to `['.']` (the project cwd) per spec/cli-contract.md §Scan
 * / Effective roots.
 */
function loadScanInputs(
  opts: IScanRunOpts,
  ctx: ReturnType<typeof defaultRuntimeContext>,
):
  | { kind: 'config-error'; message: string }
  | {
      cfg: ReturnType<typeof loadConfig>['effective'];
      ignoreFilter: ReturnType<typeof buildIgnoreFilter>;
      strict: boolean;
      effectiveRoots: string[];
    } {
  try {
    const cfg = loadConfig({ strict: opts.strict, ...ctx }).effective;
    const ignoreFilter = buildScanIgnoreFilter(cfg, ctx.cwd);
    const strict = opts.strict || cfg.scan.strict === true;
    const effectiveRoots = resolveScanRoots({ positionalRoots: opts.roots });
    return { cfg, ignoreFilter, strict, effectiveRoots };
  } catch (err) {
    return { kind: 'config-error', message: formatErrorMessage(err) };
  }
}

/** Compose the scan-time ignore filter from config + `.skillmapignore`. */
function buildScanIgnoreFilter(
  cfg: ReturnType<typeof loadConfig>['effective'],
  cwd: string,
): ReturnType<typeof buildIgnoreFilter> {
  const ignoreFileText = readIgnoreFileText(cwd);
  const ignoreFilterOpts: Parameters<typeof buildIgnoreFilter>[0] = {};
  if (cfg.ignore.length > 0) ignoreFilterOpts.configIgnore = cfg.ignore;
  if (ignoreFileText !== undefined) ignoreFilterOpts.ignoreFileText = ignoreFileText;
  return buildIgnoreFilter(ignoreFilterOpts);
}

/**
 * Build the per-scope prior loader. Hydrates the DB-resident prior
 * `ScanResult`; under `--strict` validates it against
 * `scan-result.schema.json` so a corrupt-on-disk prior never reaches
 * the rename heuristic.
 */
function makePriorLoader(
  noBuiltIns: boolean,
  strict: boolean,
): (adapter: StoragePort) => Promise<ScanResult | null> {
  return async (adapter) => {
    if (noBuiltIns) return null;
    const loaded = await adapter.scans.load();
    if (loaded.nodes.length === 0) return null;
    if (strict) {
      const validators = loadSchemaValidators();
      const result = validators.validate('scan-result', loaded);
      if (!result.ok) {
        throw new Error(tx(SCAN_RUNNER_TEXTS.priorSchemaValidationFailed, { errors: result.errors }));
      }
    }
    return loaded;
  };
}

/**
 * Build the closure that invokes `runScanWithRenames` with the wired
 * options (extensions, ignore filter, prior, optional Phase-4
 * extractor cache). Used by both the persist and ephemeral branches.
 */
function makeScanRunner(
  kernel: ReturnType<typeof createKernel>,
  opts: IScanRunOpts,
  effectiveRoots: readonly string[],
  ignoreFilter: ReturnType<typeof buildIgnoreFilter>,
  strict: boolean,
  extensions: ReturnType<typeof composeScanExtensions>,
  referenceablePaths: ReadonlySet<string> | undefined,
  scanCwd: string,
  activeProvider: string | null,
) {
  return async (
    prior: ScanResult | null,
    priorExtractorRuns?: Map<string, Map<string, IPriorExtractorRun>>,
    orphanJobFiles?: readonly string[],
  ): Promise<{
    result: ScanResult;
    renameOps: RenameOp[];
    extractorRuns: IExtractorRunRecord[];
    enrichments: IEnrichmentRecord[];
    contributions: IContributionRecord[];
    freshlyRunTuples: ReadonlySet<string>;
  }> => {
    if (opts.changed && prior === null) {
      opts.stderr.write(SCAN_RUNNER_TEXTS.changedNoPriorWarning);
    }
    const runOptions = buildRunScanOptions({
      opts,
      effectiveRoots,
      ignoreFilter,
      strict,
      extensions,
      referenceablePaths,
      cwd: scanCwd,
      prior,
      activeProvider,
      ...(priorExtractorRuns ? { priorExtractorRuns } : {}),
      ...(orphanJobFiles ? { orphanJobFiles } : {}),
    });
    return runScanWithRenames(kernel, runOptions);
  };
}

interface IBuildRunScanOptionsArgs {
  opts: IScanRunOpts;
  effectiveRoots: readonly string[];
  ignoreFilter: ReturnType<typeof buildIgnoreFilter>;
  strict: boolean;
  extensions: ReturnType<typeof composeScanExtensions>;
  referenceablePaths: ReadonlySet<string> | undefined;
  cwd: string;
  prior: ScanResult | null;
  activeProvider: string | null;
  priorExtractorRuns?: Map<string, Map<string, IPriorExtractorRun>>;
  orphanJobFiles?: readonly string[];
}

/**
 * Build the `RunScanOptions` bag for one invocation. Each conditional
 * field maps to one `RunScanOptions` slot; pulling the assembly out
 * of the closure keeps the arrow function under the project's
 * cyclomatic-complexity cap.
 */
 
function buildRunScanOptions(args: IBuildRunScanOptionsArgs): Parameters<typeof runScan>[1] {
  const { opts, prior, priorExtractorRuns, orphanJobFiles, referenceablePaths } = args;
  const runOptions: Parameters<typeof runScan>[1] = {
    roots: args.effectiveRoots.slice(),
    tokenize: !opts.noTokens,
    ignoreFilter: args.ignoreFilter,
    strict: args.strict,
    emitter: opts.emitterFactory
      ? opts.emitterFactory()
      : createStderrProgressEmitter(opts.stderr, {
          colorEnabled: opts.colorEnabled === true,
        }),
    // Orphan job-file detection, empty list means "no orphans
    // visible from this caller" (legacy behaviour). The orchestrator
    // defaults to `[]` when the field is absent; we always pass the
    // array (possibly empty) to keep the wiring uniform.
    orphanJobFiles: orphanJobFiles ?? [],
    activeProvider: args.activeProvider,
  };
  if (args.extensions) runOptions.extensions = args.extensions;
  if (prior) {
    runOptions.priorSnapshot = prior;
    runOptions.enableCache = opts.changed;
  }
  if (priorExtractorRuns) runOptions.priorExtractorRuns = priorExtractorRuns;
  if (referenceablePaths?.size) runOptions.referenceablePaths = referenceablePaths;
  runOptions.cwd = args.cwd;
  return runOptions;
}

/**
 * Persist branch, single `withSqlite` open: read prior, scan, guard,
 * persist. The guard refuses to wipe a populated DB with a zero-result
 * scan unless `--allow-empty` is set.
 */
async function runPersistPath(
  opts: IScanRunOpts,
  dbPath: string,
  jobsDir: string,
  strict: boolean,
  loadPrior: (adapter: StoragePort) => Promise<ScanResult | null>,
  runScanWith: (
    prior: ScanResult | null,
    priorExtractorRuns?: Map<string, Map<string, IPriorExtractorRun>>,
    orphanJobFiles?: readonly string[],
  ) => Promise<{
    result: ScanResult;
    renameOps: RenameOp[];
    extractorRuns: IExtractorRunRecord[];
    enrichments: IEnrichmentRecord[];
    contributions: IContributionRecord[];
    freshlyRunTuples: ReadonlySet<string>;
  }>,
  extensions?: ReturnType<typeof composeScanExtensions>,
): Promise<IScanRunResult> {
  type IPersistOutcome =
    | {
        kind: 'ok';
        result: ScanResult;
        renameOps: RenameOp[];
        extractorRuns: IExtractorRunRecord[];
        enrichments: IEnrichmentRecord[];
        contributions: IContributionRecord[];
      }
    | { kind: 'scan-error'; message: string }
    | { kind: 'guard'; existing: number };

  let outcome: IPersistOutcome;
  try {
    outcome = await withSqlite({ databasePath: dbPath }, async (adapter) => {
      const prior = await loadPrior(adapter);
      const priorExtractorRuns =
        opts.changed && prior ? await adapter.scans.loadExtractorRuns() : undefined;
      // Orphan job-file detection runs inside the same withSqlite scope
      // so the kernel can stay storage-port-free at rule time. The
      // built-in `core/job-orphan-file` rule consumes the result via
      // `IAnalyzerContext.orphanJobFiles`; the same `findOrphanJobFiles`
      // helper backs `sm job prune --orphan-files` (the cleanup
      // action), so detection and action stay in sync without sharing
      // state.
      const referencedJobFiles = await adapter.jobs.listReferencedFilePaths();
      const orphanJobFiles = findOrphanJobFiles(jobsDir, referencedJobFiles).orphanFilePaths;
      let scanned;
      try {
        scanned = await runScanWith(prior, priorExtractorRuns, orphanJobFiles);
      } catch (err) {
        return { kind: 'scan-error', message: formatErrorMessage(err) } as IPersistOutcome;
      }
      if (scanned.result.stats.nodesCount === 0 && !opts.allowEmpty) {
        const counts = await adapter.scans.countRows();
        const existing = counts.nodes + counts.links + counts.issues;
        if (existing > 0) return { kind: 'guard', existing };
      }
      await adapter.scans.persist(scanned.result, {
        renameOps: scanned.renameOps,
        extractorRuns: scanned.extractorRuns,
        enrichments: scanned.enrichments,
        contributions: scanned.contributions,
        registeredContributionKeys: collectRegisteredContributionKeys(extensions),
        freshlyRunTuples: scanned.freshlyRunTuples,
      });
      return { kind: 'ok', ...scanned };
    });
  } catch (err) {
    return { kind: 'scan-error', message: formatErrorMessage(err) };
  }
  if (outcome.kind === 'scan-error') return outcome;
  if (outcome.kind === 'guard') return { kind: 'guard-trip', existing: outcome.existing };
  return {
    kind: 'ok',
    result: outcome.result,
    renameOps: outcome.renameOps,
    persistedTo: dbPath,
    dbPath,
    strict,
  };
}

/**
 * Non-persist branch, ephemeral read-only open for the prior, scan in
 * memory. We do NOT auto-create the DB here; a `--dry-run` over a
 * missing scope must not provision one.
 */
async function runEphemeralPath(
  opts: IScanRunOpts,
  dbPath: string,
  strict: boolean,
  loadPrior: (adapter: StoragePort) => Promise<ScanResult | null>,
  runScanWith: (
    prior: ScanResult | null,
  ) => Promise<{
    result: ScanResult;
    renameOps: RenameOp[];
    extractorRuns: IExtractorRunRecord[];
    enrichments: IEnrichmentRecord[];
  }>,
): Promise<IScanRunResult> {
  let prior: ScanResult | null;
  try {
    prior = opts.noBuiltIns
      ? null
      : await tryWithSqlite({ databasePath: dbPath, autoBackup: false }, loadPrior);
  } catch (err) {
    return { kind: 'scan-error', message: formatErrorMessage(err) };
  }
  try {
    const scanned = await runScanWith(prior);
    return {
      kind: 'ok',
      result: scanned.result,
      renameOps: scanned.renameOps,
      persistedTo: null,
      dbPath,
      strict,
    };
  } catch (err) {
    return { kind: 'scan-error', message: formatErrorMessage(err) };
  }
}
