/**
 * Kernel-thin runner for `sm scan`. Owns the wiring chain, plugin
 * runtime, config + ignore filter, prior-snapshot load, single
 * `withSqlite` open for persist, dry-run / non-persist branch, and
 * surfaces a discriminated `TScanRunResult` the caller renders.
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
import type {
  IContributionErrorRecord,
  IContributionRecord,
} from '../../kernel/adapters/sqlite/contributions.js';
import type { IConfidenceAdjustment } from '../../kernel/adapters/sqlite/link-scores.js';
import type { IPriorExtractorRun } from '../../kernel/adapters/sqlite/scan-load.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { buildSettingsResolver } from '../config/plugin-settings.js';
import { buildIgnoreFilter, composeScopeIgnoreFilter } from '../../kernel/scan/ignore.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { createStderrProgressEmitter } from './progress-emitter.js';
import type { IPrinter } from './printer.js';
import { SCAN_RUNNER_TEXTS } from './i18n/scan-runner.texts.js';
import { resolveDbPath } from '../paths/db-path.js';
import { resolveScanRoots } from './scan-roots.js';
import { walkReferencePaths } from './reference-paths-walker.js';
import {
  bootstrapActiveProvider,
  warnIfLensPluginDisabled,
} from './active-provider-bootstrap.js';
import type { IProviderDetectInput } from '../config/active-provider.js';
import { tryWithSqlite, withSqlite } from '../sqlite/with-sqlite.js';
import { maybeResetOnDrift } from '../sqlite/db-drift-reset.js';
import { DB_DRIFT_TEXTS } from '../sqlite/i18n/db-drift.texts.js';
import { VERSION } from '../../version.js';
import {
  collectRegisteredContributionKeys,
  composeScanExtensions,
  emptyPluginRuntime,
  loadPluginRuntime,
  registerEnabledExtensions,
  type IConformanceKillSwitches,
  type IPluginRuntime,
} from './plugin-runtime.js';
import { defaultRuntimeContext, type IRuntimeContext } from './runtime-context.js';

export interface IScanRunOpts {
  /**
   * Positional roots from `sm scan [roots...]`. When non-empty, used
   * verbatim (resolved against `cwd`). When empty, the runner defaults
   * to `['.']` (the project cwd) per `spec/cli-contract.md` § Scan /
   * Effective roots. Extending the indexed scan beyond cwd is by passing
   * extra roots positionally (or via in-tree symlinks, which the walker
   * always follows).
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
   * Pre-loaded plugin runtime (audit M3). When set, the runner
   * skips its own `loadPluginRuntime` call and consumes this runtime
   * directly, used by the BFF to share the boot-cached discovery
   * across `?fresh=1` requests instead of re-walking the filesystem +
   * recompiling AJV validators per call. CLI verbs leave this
   * undefined; they pay the discovery cost once per `sm scan`
   * invocation.
   */
  pluginRuntime?: IPluginRuntime;
  /**
   * Optional resolver override that the composer threads into
   * `composeScanExtensions(..., resolveEnabled)`. The BFF builds this
   * fresh from the layered config on every `POST /api/scan` / watcher
   * batch so a mid-session toggle is honoured without restarting
   * `sm serve` (see `core/runtime/fresh-resolver.ts`). CLI offline
   * callers (`sm scan`) leave this undefined, the runtime is reloaded
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
   * Whether the active-provider drift check emits the one-per-scan `⚠`
   * warn (config lens vs on-disk markers). Defaults to `true` (CLI `sm
   * scan` / `sm watch`). The BFF passes `false` so `POST /api/scan` and
   * `GET /api/scan?fresh=1` do not log the repetitive drift noise a
   * browser user never reads; the SPA surfaces the drift via
   * `GET /api/active-provider`'s `markerDrift` field instead. Forwarded
   * verbatim to `bootstrapActiveProvider`; the missing-snapshot backfill
   * is unaffected.
   */
  warnOnDrift?: boolean;
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
  /**
   * Per-invocation override of `scan.maxScan` (from the `--max-scan
   * <N>` flag on `sm scan` / `sm refresh` / `sm watch`). This is the
   * WALK-INTAKE ceiling: the scan walks, parses, analyzes, and
   * reference-validates the full corpus up to this number, dropping
   * extra files in stable order past it. Bidirectional: any positive
   * integer replaces the setting for this scan. Omit / `undefined`
   * means "no override", `scan.maxScan` from settings applies. The
   * runner forwards both values to the orchestrator so
   * `ScanResult.scanCeiling` / `ScanResult.scanTruncated` are populated.
   */
  maxScan?: number;
  /**
   * Per-invocation override of `scan.maxNodes` (from the `--max-nodes
   * <N>` flag on `sm scan` / `sm refresh` / `sm watch`). This is the MAP
   * RENDER cap, pure metadata that does NOT bound the walk. Bidirectional:
   * any positive integer replaces the setting for this scan. Omit /
   * `undefined` means "no override", `scan.maxNodes` from settings
   * applies. The runner forwards both values to the orchestrator so
   * `ScanResult.maxRenderNodes` is populated.
   */
  maxNodes?: number;
}

/**
 * Outcome of a scan invocation. The success kind carries the strict
 * flag so the caller knows whether to self-validate the result before
 * emitting `--json` (only `strict` runs do).
 */
export type TScanRunResult =
  | {
      kind: 'ok';
      result: ScanResult;
      renameOps: RenameOp[];
      persistedTo: string | null;
      dbPath: string;
      strict: boolean;
      /**
       * Qualified ids (`<pluginId>/<id>`, with duplicates) of the
       * extractors that actually ran during this scan walk. Plain data the
       * CLI usage surface (`spec/telemetry.md`) collapses + dedupes into the
       * `cli.<verb>` event; the kernel and runner stay telemetry-agnostic.
       * Cached extractors (incremental scans) do not appear, only
       * freshly-run ones.
       */
      executedExtensionIds: readonly string[];
      /**
       * Provider id the lens auto-detected AND persisted on THIS scan
       * (only when the lens was absent from config and a single marker
       * matched), else `null`. The caller announces it on the summary's
       * stream so the message never interleaves with the summary on a
       * tty. `null` when the lens came from config or no marker matched.
       * Set by `runScanForCommand` (the public entry) when it enriches
       * the inner scan outcome; the internal scan paths leave it absent.
       */
      lensAutoDetected?: string | null;
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
 * Returns one of `TScanRunResult`, the caller renders human / JSON
 * output and maps the kind to an `ExitCode`.
 */
export async function runScanForCommand(opts: IScanRunOpts): Promise<TScanRunResult> {
  const ctx = opts.ctx ?? defaultRuntimeContext();
  // `sm scan` is always project-scoped: DB + config resolve under
  // `<cwd>/.skill-map/`. Per `spec/cli-contract.md` §Scope is always
  // project-local, the verb does not honour any HOME-walking flag
  // because no implicit `$HOME` read is allowed.
  const dbPath = resolveDbPath({ db: undefined, ...ctx });

  const kernel = createKernel();
  const pluginRuntime = await preparePluginRuntime(opts, opts.printer);

  // Load the merged config BEFORE registering extensions so the settings
  // resolver can be built from it and threaded into the composer (every
  // composed extension gets its `resolvedSettings` populated, reaching
  // extractors / analyzers / hooks as `ctx.settings.<id>`).
  const scanInputs = loadScanInputs(opts, ctx);
  if ('kind' in scanInputs) return scanInputs;
  const { cfg, ignoreFilter, strict, effectiveRoots } = scanInputs;

  const extensions = registerExtensions(kernel, pluginRuntime, opts, cfg);

  // Walk reference paths into a side set. Lazy: skip the walk when the
  // operator left `scan.referencePaths` empty (the common case).
  let referenceablePaths: ReadonlySet<string> | undefined;
  if (cfg.scan.referencePaths.length > 0) {
    const walk = walkReferencePaths(cfg.scan.referencePaths, ctx.cwd);
    referenceablePaths = walk.paths;
    emitReferenceWalkAdvisory(walk, opts);
  }

  const loadPrior = makePriorLoader(opts.noBuiltIns, strict);
  const lens = await resolveActiveLens(
    opts,
    ctx,
    effectiveRoots,
    pluginRuntime,
    detectionProviders(extensions),
  );
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
    cfg.scan.maxScan,
    cfg.scan.maxNodes,
    cfg.scan.maxFileSizeBytes,
    cfg.scan.followExternalSymlinks,
    cfg.tokenizer,
  );

  const willPersist = !opts.noBuiltIns && !opts.dryRun;
  const scanned = await (willPersist
    ? runPersistPath(opts, dbPath, strict, loadPrior, runScanWith, extensions)
    : runEphemeralPath(opts, dbPath, strict, loadPrior, runScanWith));
  // Thread the auto-detect outcome onto the public result so the CLI
  // can announce it next to the scan summary (same stream, in order).
  return scanned.kind === 'ok'
    ? { ...scanned, lensAutoDetected: lens.autoDetected }
    : scanned;
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
 * extractors). When the resolved lens points at a plugin the operator
 * has disabled the scan still continues, but a warning fires so the
 * operator doesn't read the missing extractors as a bug. The BFF
 * resolve-enabled override is honoured so mid-session toggles land.
 */
/**
 * Local discriminated union for `resolveActiveLens`. The `'ok'` shape
 * here is intentionally narrower than `TScanRunResult`'s `'ok'`, just
 * the resolved lens id, no scan results. Naming it locally so a reader
 * doesn't conflate the two `kind: 'ok'` branches.
 */
type TLensResolution =
  | { kind: 'ok'; activeProvider: string; autoDetected: string | null }
  | (TScanRunResult & { kind: 'ambiguous-provider' });

/**
 * Providers whose `detect.markers` drive active-lens auto-detection.
 * `composeScanExtensions` returns `undefined` when no extension survived
 * the enabled filter, an empty list then means "no auto-detect", and the
 * lens falls back to the persisted config value alone. Extracted so the
 * nullish branch stays out of `runScanForCommand`'s complexity budget.
 */
function detectionProviders(
  extensions: ReturnType<typeof composeScanExtensions>,
): readonly IProviderDetectInput[] {
  return extensions?.providers ?? [];
}

// eslint-disable-next-line complexity
async function resolveActiveLens(
  opts: IScanRunOpts,
  ctx: ReturnType<typeof defaultRuntimeContext>,
  effectiveRoots: readonly string[],
  pluginRuntime: Awaited<ReturnType<typeof preparePluginRuntime>>,
  providers: readonly IProviderDetectInput[],
): Promise<TLensResolution> {
  const bootstrap = await bootstrapActiveProvider({
    cwd: ctx.cwd,
    effectiveRoots,
    providers,
    yes: opts.yes ?? false,
    warnOnDrift: opts.warnOnDrift ?? true,
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
  warnIfLensPluginDisabled({
    activeProvider: bootstrap.activeProvider,
    resolveEnabled: opts.resolveEnabledOverride ?? pluginRuntime.resolveEnabled,
    printer: opts.printer,
  });
  return {
    kind: 'ok',
    activeProvider: bootstrap.activeProvider,
    // Only when the lens was freshly auto-detected (not read from
    // config) does the caller announce it. The bootstrap no longer
    // prints it itself, to avoid interleaving stderr with the
    // stdout scan summary on a tty.
    autoDetected: bootstrap.source === 'autodetect' ? bootstrap.activeProvider : null,
  };
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
 * circuits the load when the caller already has a runtime in hand
 * (BFF boot snapshot); `--no-plugins` short-circuits to an empty
 * runtime (no DB / config reads, no FS walk under
 * `.skill-map/plugins/`). Warnings emit through the printer regardless
 * the CLI surfaces them per-invocation; the BFF emits a tiny no-op
 * printer so the warnings only land where the boot already logged
 * them.
 */
async function preparePluginRuntime(opts: IScanRunOpts, printer: IPrinter) {
  if (opts.pluginRuntime) {
    // Caller-supplied runtime: warnings were already surfaced at the
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
  cfg: ReturnType<typeof loadConfig>['effective'],
): ReturnType<typeof composeScanExtensions> {
  const composeOpts: Parameters<typeof composeScanExtensions>[0] = {
    noBuiltIns: opts.noBuiltIns,
    pluginRuntime,
    resolveSettings: buildSettingsResolver(cfg),
    forbidSidecarWriters: cfg.allowSidecarWriters === false,
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

/**
 * Compose the scan-time ignore filter from `config.ignore` +
 * `.skillmapignore` (plus `.gitignore` when `scan.respectGitignore` is
 * enabled), layered by `composeScopeIgnoreFilter`.
 */
function buildScanIgnoreFilter(
  cfg: ReturnType<typeof loadConfig>['effective'],
  cwd: string,
): ReturnType<typeof buildIgnoreFilter> {
  return composeScopeIgnoreFilter(cwd, cfg.ignore, {
    respectGitignore: cfg.scan.respectGitignore,
  });
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
  scanCeiling: number,
  maxRenderNodes: number,
  maxFileSizeBytes: number,
  followExternalSymlinks: boolean,
  tokenizer: string,
) {
  return async (
    prior: ScanResult | null,
    priorExtractorRuns?: Map<string, Map<string, IPriorExtractorRun>>,
  ): Promise<{
    result: ScanResult;
    renameOps: RenameOp[];
    extractorRuns: IExtractorRunRecord[];
    enrichments: IEnrichmentRecord[];
    contributions: IContributionRecord[];
    contributionErrors: IContributionErrorRecord[];
    linkScores: IConfidenceAdjustment[];
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
      scanCeiling,
      maxRenderNodes,
      maxFileSizeBytes,
      followExternalSymlinks,
      tokenizer,
      ...(priorExtractorRuns ? { priorExtractorRuns } : {}),
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
  scanCeiling: number;
  maxRenderNodes: number;
  maxFileSizeBytes: number;
  followExternalSymlinks: boolean;
  tokenizer: string;
  priorExtractorRuns?: Map<string, Map<string, IPriorExtractorRun>>;
}

/**
 * Build the `RunScanOptions` bag for one invocation. Each conditional
 * field maps to one `RunScanOptions` slot; pulling the assembly out
 * of the closure keeps the arrow function under the project's
 * cyclomatic-complexity cap.
 */
 
function buildRunScanOptions(args: IBuildRunScanOptionsArgs): Parameters<typeof runScan>[1] {
  const { opts, prior, priorExtractorRuns, referenceablePaths } = args;
  const runOptions: Parameters<typeof runScan>[1] = {
    roots: args.effectiveRoots.slice(),
    tokenize: !opts.noTokens,
    tokenizer: args.tokenizer,
    ignoreFilter: args.ignoreFilter,
    strict: args.strict,
    emitter: buildRunScanEmitter(opts),
    activeProvider: args.activeProvider,
    scanCeiling: args.scanCeiling,
    overrideScanCeiling: opts.maxScan ?? null,
    maxRenderNodes: args.maxRenderNodes,
    overrideMaxRenderNodes: opts.maxNodes ?? null,
    maxFileSizeBytes: args.maxFileSizeBytes,
    followExternalSymlinks: args.followExternalSymlinks,
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
 * Pick the kernel progress emitter for one scan invocation. Falls
 * through to the stderr emitter when the caller did not supply a
 * factory (the CLI path); the BFF threads a broadcaster-bound emitter
 * via `emitterFactory`.
 */
function buildRunScanEmitter(opts: IScanRunOpts) {
  if (opts.emitterFactory) return opts.emitterFactory();
  return createStderrProgressEmitter(opts.stderr, {
    colorEnabled: opts.colorEnabled === true,
  });
}

/**
 * Pre-1.0 schema-drift rebuild for the persist path. Wipes a DB written
 * by a different `major.minor` before it is opened (see
 * `spec/db-schema.md` §Schema drift (pre-1.0)). Returns a `scan-error`
 * outcome when the operator declines the interactive rebuild, or `null`
 * to proceed (no drift, or the cache was rebuilt).
 */
async function rebuildOnDrift(
  opts: IScanRunOpts,
  dbPath: string,
): Promise<{ kind: 'scan-error'; message: string } | null> {
  const drift = await maybeResetOnDrift(dbPath, {
    currentVersion: VERSION,
    assumeYes: opts.yes ?? false,
    stdin: opts.stdin ?? process.stdin,
    stderr: opts.stderr,
    printer: opts.printer,
    ...(opts.style ? { style: opts.style } : {}),
  });
  if (drift.kind !== 'aborted') return null;
  const dim = opts.style?.dim ?? ((s: string) => s);
  return {
    kind: 'scan-error',
    message: tx(DB_DRIFT_TEXTS.driftAborted, {
      dbVersion: drift.dbVersion,
      currentVersion: drift.currentVersion,
      reason:
        drift.reason === 'version'
          ? DB_DRIFT_TEXTS.driftReasonVersion
          : DB_DRIFT_TEXTS.driftReasonSchema,
      hint: dim(DB_DRIFT_TEXTS.driftAbortedHint),
    }),
  };
}

/**
 * Persist branch, single `withSqlite` open: read prior, scan, guard,
 * persist. The guard refuses to wipe a populated DB with a zero-result
 * scan unless `--allow-empty` is set.
 */
async function runPersistPath(
  opts: IScanRunOpts,
  dbPath: string,
  strict: boolean,
  loadPrior: (adapter: StoragePort) => Promise<ScanResult | null>,
  runScanWith: (
    prior: ScanResult | null,
    priorExtractorRuns?: Map<string, Map<string, IPriorExtractorRun>>,
  ) => Promise<{
    result: ScanResult;
    renameOps: RenameOp[];
    extractorRuns: IExtractorRunRecord[];
    enrichments: IEnrichmentRecord[];
    contributions: IContributionRecord[];
    contributionErrors: IContributionErrorRecord[];
    linkScores: IConfidenceAdjustment[];
    freshlyRunTuples: ReadonlySet<string>;
  }>,
  extensions?: ReturnType<typeof composeScanExtensions>,
): Promise<TScanRunResult> {
  type IPersistOutcome =
    | {
        kind: 'ok';
        result: ScanResult;
        renameOps: RenameOp[];
        extractorRuns: IExtractorRunRecord[];
        enrichments: IEnrichmentRecord[];
        contributions: IContributionRecord[];
        contributionErrors: IContributionErrorRecord[];
        linkScores: IConfidenceAdjustment[];
      }
    | { kind: 'scan-error'; message: string }
    | { kind: 'guard'; existing: number };

  // Pre-1.0 schema-drift rebuild: if the on-disk DB was written by a
  // different major.minor, wipe it before opening so the adapter
  // recreates the current schema and this scan repopulates it. Runs
  // before any open (read prior + persist happen inside one withSqlite
  // below), so a wiped DB is seen fresh by both.
  const driftError = await rebuildOnDrift(opts, dbPath);
  if (driftError) return driftError;

  let outcome: IPersistOutcome;
  try {
    outcome = await withSqlite({ databasePath: dbPath }, async (adapter) => {
      const prior = await loadPrior(adapter);
      const priorExtractorRuns =
        opts.changed && prior ? await adapter.scans.loadExtractorRuns() : undefined;
      let scanned;
      try {
        scanned = await runScanWith(prior, priorExtractorRuns);
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
        contributionErrors: scanned.contributionErrors,
        linkScores: scanned.linkScores,
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
    executedExtensionIds: outcome.extractorRuns.map((run) => run.extractorId),
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
): Promise<TScanRunResult> {
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
      executedExtensionIds: scanned.extractorRuns.map((run) => run.extractorId),
    };
  } catch (err) {
    return { kind: 'scan-error', message: formatErrorMessage(err) };
  }
}
