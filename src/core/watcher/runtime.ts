/**
 * Shared watcher machinery, the chokidar boot, plugin runtime load,
 * primary + meta-file subscriptions, debounced rescan, prior-snapshot
 * load, persist branch, extracted from the two ~80%-identical
 * implementations that used to live in `cli/commands/watch.ts:runWatchLoop`
 * and `server/watcher.ts:WatcherService`.
 *
 * The runtime is pure machinery, no Clipanion, no Hono, no streams.
 * Adapters supply those:
 *
 *   - `cli/commands/watch.ts` builds a `printer`, formats per-batch
 *     summaries, owns SIGINT/SIGTERM, returns an exit code.
 *   - `server/watcher.ts` wires events to `log.warn` and the
 *     broadcaster, returns a `start`/`stop` handle.
 *
 * The runtime exposes the per-batch outcome (success ScanResult /
 * failure message) plus advisory events (chokidar errors, watcher
 * ready, breaker tripped) through an `IWatcherEvents` callback bag.
 * Adapters subscribe to whatever subset they need.
 *
 * Boot ordering inside `start()` is configurable via
 * `subscribeBeforeInitial`:
 *
 *   - `false` (CLI default, `runWatchLoop` historic shape): initial
 *     scan first, then subscribe. Events arriving during the initial
 *     scan are LOST (no chokidar instance exists yet). Users hand-edit
 *     so the next save covers any race.
 *   - `true` (BFF default, `WatcherService` historic shape):
 *     subscribe first, then run the initial batch. Events arriving
 *     during the initial scan QUEUE against the armed chokidar and
 *     fire a follow-up batch as soon as the initial completes. Keeps
 *     the SPA's view convergent with the filesystem even when changes
 *     overlap server boot.
 *
 * Common boot phases regardless of ordering:
 *
 *   1. Load config + plugin runtime (warnings forwarded to
 *      `events.onWatcherError`).
 *   2. Initial batch + subscription in the order chosen above.
 *   3. Await both chokidar `ready` promises.
 *   4. Emit `events.onReady`.
 *
 * Behaviour-equivalence is the contract: the existing CLI watch tests
 * and BFF watcher tests must keep passing without modification. If a
 * test breaks, the runtime is reproducing a bug from one side, fix
 * the runtime, not the test.
 */

import {
  createChokidarWatcher,
  createParcelWatcher,
  createKernel,
  runScanWithRenames,
  type IFsWatcher,
  type IWatchEvent,
} from '../../kernel/index.js';
import type {
  IEnrichmentRecord,
  IExtractorRunRecord,
  RenameOp,
  ScanResult,
} from '../../kernel/index.js';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { resolveActiveProvider } from '../config/active-provider.js';
import { buildSettingsResolver } from '../config/plugin-settings.js';
import { walkReferencePaths } from '../runtime/reference-paths-walker.js';
import {
  buildIgnoreFilter,
  readGitignoreText,
  readGitignoreTextStable,
  readIgnoreFileText,
  readIgnoreFileTextStable,
  type IIgnoreFilter,
} from '../../kernel/scan/ignore.js';
import { collectReadExtensions, type IProvider } from '../../kernel/extensions/index.js';
import { builtIns } from '../../plugins/built-ins.js';
import type { ProgressEmitterPort } from '../../kernel/ports/progress-emitter.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import {
  defaultGitignorePath,
  defaultIgnoreFilePath,
  defaultSettingsPath,
} from '../paths/db-path.js';
import { buildFreshResolver } from '../runtime/fresh-resolver.js';
import {
  collectRegisteredContributionKeys,
  composeScanExtensions,
  emptyPluginRuntime,
  loadPluginRuntime,
  registerEnabledExtensions,
  type IConformanceKillSwitches,
} from '../runtime/plugin-runtime.js';
import type { IRuntimeContext } from '../runtime/runtime-context.js';
import { tryWithSqlite, withSqlite } from '../sqlite/with-sqlite.js';
import { maybeResetOnDrift } from '../sqlite/db-drift-reset.js';
import { VERSION } from '../../version.js';
import { RUNTIME_TEXTS } from './i18n/runtime.texts.js';

// -----------------------------------------------------------------------------
// Public surface
// -----------------------------------------------------------------------------

/**
 * Outcome of a single debounced batch. `kind: 'ok'` carries the
 * `ScanResult` so the CLI adapter can render its `scannedSummary`
 * line; the BFF adapter ignores it (the kernel's emitter already
 * broadcast `scan.completed` mid-batch).
 */
export type TWatcherBatchOutcome =
  | { kind: 'ok'; result: ScanResult }
  | { kind: 'error'; message: string };

/**
 * Callbacks the adapters subscribe to. Every callback is optional,
 * adapters wire only what they need.
 */
export interface IWatcherEvents {
  /**
   * Called once per debounced batch (including the initial batch when
   * `runInitialBatch !== false`) with the per-batch outcome. Adapters
   * use this for adapter-specific rendering, CLI emits a
   * `scannedSummary` line or a ndjson record; BFF does nothing (the
   * kernel emitter already handled it).
   */
  onBatch?: (outcome: TWatcherBatchOutcome) => void;
  /**
   * Fired synchronously at the very top of each batch's `runOnePass()`,
   * BEFORE any scan work begins. Covers the initial batch (when
   * `runInitialBatch !== false`) AND every follow-up batch (chokidar and
   * meta-file driven), since it hooks `runOnePass` itself rather than the
   * per-path wrappers. Pairs with `onBatch`, which fires on completion of
   * either outcome (ok / error). Adapters use this to start a "scanning"
   * indicator that `onBatch` then stops.
   */
  onBatchStart?: () => void;
  /**
   * Called when chokidar surfaces a transport-level error (rare,
   * EMFILE, missing root). The watcher itself stays open per
   * `IFsWatcher`'s contract; the adapter decides whether to log,
   * broadcast, or both.
   */
  onWatcherError?: (message: string) => void;
  /**
   * Called once per plugin-runtime warning at boot. Every line is a
   * complete diagnostic (rendered by `formatWarning` in the plugin
   * runtime), no further framing required. Adapters route them via
   * their own surfaces (CLI `printer.warn`, BFF `log.warn`).
   */
  onPluginWarning?: (message: string) => void;
  /**
   * Called once, before the first batch persists, when the pre-1.0
   * schema-drift check deleted and recreated the DB (the on-disk cache
   * was written by a different `major.minor`). Adapters surface it on
   * their own channel (CLI `printer.warn`, BFF `log.warn`) so the
   * silent rebuild is visible. See `spec/db-schema.md` §Schema drift
   * (pre-1.0).
   */
  onDriftReset?: (info: { dbVersion: string; currentVersion: string }) => void;
  /**
   * Called once both chokidar instances have reported `ready` AND the
   * runtime has run its initial batch (when enabled). `roots` is the
   * concrete root list the watcher subscribed to; `debounceMs` is the
   * resolved value (override or `cfg.scan.watch.debounceMs`).
   */
  onReady?: (info: { roots: string[]; debounceMs: number }) => void;
  /**
   * Called synchronously inside `start()` once `loadEffectiveConfig()`
   * has resolved and the debounce window is known, BEFORE chokidar
   * subscribes and the initial batch runs. Adapters that want a
   * "starting" preview line use this to avoid loading config a second
   * time just to read `debounceMs`.
   *
   * Optional. If unset, the runtime simply skips the notification.
   */
  onConfigLoaded?: (info: { debounceMs: number }) => void;
  /**
   * Called when the consecutive-failure circuit breaker trips.
   * Adapters that disable the breaker (BFF, long-running daemon)
   * never receive this event.
   */
  onBreakerTripped?: (count: number, message: string) => void;
}

/**
 * Inputs for `createWatcherRuntime`. Adapters fill the relevant subset:
 * the CLI adapter provides `circuitBreaker` / `maxBatches` / `roots`;
 * the BFF adapter provides `noBuiltIns` / `dbPath` directly from the
 * `IServerOptions` payload and skips the breaker.
 */
export interface ICreateWatcherRuntimeOpts {
  /**
   * Absolute DB file path. Both adapters resolve this themselves
   * (`defaultProjectDbPath(ctx)` / `IServerOptions.dbPath`), the
   * runtime never composes it.
   */
  dbPath: string;
  /** Roots to watch. `['.']` for the BFF; user-supplied list for the CLI. */
  roots: string[];
  /** Runtime context (`cwd`), kernel never reads `process.*`. */
  runtimeContext: IRuntimeContext;
  /** Drop every built-in (`--no-built-ins`). User plugins still load. */
  noBuiltIns: boolean;
  /** Skip plugin discovery entirely (`--no-plugins` / `IServerOptions.noPlugins`). */
  noPlugins: boolean;
  /**
   * Strict-mode override. `true` promotes frontmatter warnings to
   * errors AND validates the prior snapshot before the rename
   * heuristic. `undefined` falls through to `cfg.scan.strict`.
   */
  strictOverride?: boolean | undefined;
  /**
   * Tokenize override. `false` disables per-node token counts.
   * `undefined` falls through to `cfg.scan.tokenize` (default `true`).
   */
  tokenizeOverride?: boolean | undefined;
  /**
   * Override for the chokidar debounce window (ms). Falls back to
   * `cfg.scan.watch.debounceMs` from config.
   */
  debounceMsOverride?: number | undefined;
  /**
   * Per-invocation override of the primary watcher backend (from the
   * `--watch-backend <chokidar|parcel>` flag on `sm serve` / `sm watch` /
   * `sm scan --watch`). When set, it wins over `cfg.scan.watch.backend`
   * for the duration of the watcher session; `undefined` falls back to
   * the persisted config value.
   */
  watchBackendOverride?: 'chokidar' | 'parcel' | undefined;
  /**
   * Build a fresh `ProgressEmitterPort` for each batch. CLI passes
   * `createCliProgressEmitter(stderr)`; BFF passes the broadcaster
   * emitter. Called once per batch so per-emitter state
   * (cli-progress-emitter's `seen` set) starts clean.
   */
  emitterFactory: () => ProgressEmitterPort;
  /**
   * Run an initial batch on `start()`. Defaults to `true`. Adapters
   * that want a "subscribe-only" watcher (rare; no production caller
   * today) can flip this to `false`.
   */
  runInitialBatch?: boolean;
  /**
   * Subscribe chokidar BEFORE running the initial batch. CLI keeps
   * the historic `false` (scan then subscribe, events during the
   * initial scan are lost); BFF flips it to `true` (subscribe then
   * scan, events queue against the armed watcher and fire a
   * follow-up batch). Defaults to `false`.
   */
  subscribeBeforeInitial?: boolean;
  /**
   * If the initial batch throws, propagate the error from `start()`.
   * CLI flips this to `true` so it can exit 2 on initial-scan failure;
   * BFF leaves it `false` so a transient FS error doesn't kill the
   * broadcaster boot.
   */
  failOnInitialBatchError?: boolean;
  /**
   * Circuit-breaker config. `undefined` (BFF default) disables the
   * breaker entirely (log-and-continue forever). The CLI passes the
   * resolved limit (`5` default, `0` to disable explicitly,
   * user-supplied via `--max-consecutive-failures <n>`).
   */
  circuitBreaker?: { maxConsecutiveFailures: number };
  /**
   * Test hook: when set, the watcher requests `stop()` after this
   * many post-initial batches. CLI passes it through from
   * `IRunWatchOptions.maxBatches`; BFF leaves it undefined.
   */
  maxBatches?: number;
  /** Event subscriptions. */
  events?: IWatcherEvents;
  /**
   * Conformance kill-switches resolved at the adapter boundary
   * (`cli/util/conformance-env.ts: readConformanceKillSwitches` for
   * the CLI; the BFF leaves this undefined since conformance never
   * exercises the watcher). Production callers leave undefined; the
   * field is plumbed through `composeScanExtensions` per batch.
   */
  killSwitches?: IConformanceKillSwitches;
  /**
   * Per-invocation override of `scan.maxScan` (from the `--max-scan
   * <N>` flag on `sm watch` / `sm scan --watch`). This is the
   * WALK-INTAKE ceiling. `undefined` means "no override", every batch
   * uses `cfg.scan.maxScan`. Bidirectional: any positive integer fully
   * replaces the setting for the duration of the watcher session.
   */
  maxScanOverride?: number | undefined;
  /**
   * Per-invocation override of `scan.maxNodes` (from the `--max-nodes
   * <N>` flag on `sm watch` / `sm scan --watch`). This is the MAP
   * RENDER cap, pure metadata that does NOT bound the walk. `undefined`
   * means "no override", every batch uses `cfg.scan.maxNodes`.
   * Bidirectional: any positive integer fully replaces the setting for
   * the duration of the watcher session.
   */
  maxNodesOverride?: number | undefined;
}

/**
 * Handle returned by `createWatcherRuntime`. The CLI adapter awaits
 * the breaker / `maxBatches` outcome via `whenStopped`; the BFF
 * adapter exposes `start`/`stop` to the composition root.
 */
export interface IWatcherRuntimeHandle {
  /** Boot config + plugin runtime + chokidar watchers; resolves once `onReady` has fired. */
  start(): Promise<void>;
  /** Idempotent shutdown. Drains the in-flight batch, closes chokidar handles. */
  stop(): Promise<void>;
  /**
   * Resolves once the runtime has stopped, either via `stop()`,
   * a tripped breaker, or `maxBatches`. The CLI adapter awaits this
   * to drive its main loop; the BFF adapter ignores it (the broadcaster
   * lives until the server itself closes).
   */
  whenStopped: Promise<void>;
  /**
   * Final breaker / `maxBatches` outcome. `'ok'` means the runtime
   * stopped cleanly via `stop()`; `'breaker-tripped'` means the
   * consecutive-failure threshold fired. The CLI adapter maps the
   * result to its exit code.
   */
  outcome(): 'ok' | 'breaker-tripped';
  /**
   * Number of batches the runtime has dispatched (initial + post-init).
   * The CLI adapter reads this on shutdown to render
   * `WATCH_TEXTS.stopped` with the historic batch counter.
   */
  batchCount(): number;
}

const DEFAULT_RUN_INITIAL_BATCH = true;

/**
 * Construct the watcher runtime. Pure factory, every dependency
 * comes through the options bag.
 */
/**
 * Run the pre-1.0 schema-drift rebuild for a watcher session. Wipes a
 * DB written by a different `major.minor` before the watcher's first DB
 * open and reports the rebuild via `events.onDriftReset`. The watcher
 * never prompts (`assumeYes`); see `spec/db-schema.md` §Schema drift
 * (pre-1.0).
 */
async function rebuildWatcherDbOnDrift(
  dbPath: string,
  events: IWatcherEvents,
): Promise<void> {
  const drift = await maybeResetOnDrift(dbPath, { currentVersion: VERSION, assumeYes: true });
  if (drift.kind === 'reset') {
    events.onDriftReset?.({ dbVersion: drift.dbVersion, currentVersion: drift.currentVersion });
  }
}

/**
 * Root-relative POSIX changed / removed path sets derived from one
 * chokidar batch, threaded into the orchestrator's scoped incremental
 * walk. `changed` = add / change events (re-read + re-extract); `removed`
 * = unlink events (dropped, rename heuristic handles the disappearance).
 */
interface IIncrementalPaths {
  changed: Set<string>;
  removed: Set<string>;
}

/** Run-options shape `runScanWithRenames` consumes (one source of truth). */
type IWatcherRunOptions = Parameters<typeof runScanWithRenames>[1];

/**
 * Prior snapshot + prior extractor runs loaded once per batch, or `null`
 * when there is no prior scan. Shaped off the `runOptions` fields it feeds
 * so we avoid re-importing the loader return types.
 */
interface IWatcherPriorState {
  snapshot: NonNullable<IWatcherRunOptions['priorSnapshot']>;
  extractorRuns: NonNullable<IWatcherRunOptions['priorExtractorRuns']>;
}

/**
 * Wire the prior snapshot + extractor runs (and, when chokidar handed us
 * the exact changed-path set, the scoped incremental walk) onto the per-
 * batch `runOptions`. Extracted from `runOnePass` so that closure stays
 * under the complexity cap. No-op when there is no prior scan.
 *
 * The watcher wants cache reuse by default (re-walking unchanged files on
 * every batch defeats the point of debouncing). Scoped incremental walk is
 * applied ONLY when `changedPaths` is present (a primary file-change batch)
 * AND a prior exists; the initial batch and the meta-file watcher pass no
 * `changedPaths`, so they take the full traversal + mtime-gate path. The
 * orchestrator falls back to the full walk if the tokenizer changed.
 */
function applyPriorStateToRunOptions(
  runOptions: IWatcherRunOptions,
  priorState: IWatcherPriorState | null,
  changedPaths: IIncrementalPaths | undefined,
): void {
  if (!priorState) return;
  runOptions.priorSnapshot = priorState.snapshot;
  runOptions.enableCache = true;
  runOptions.priorExtractorRuns = priorState.extractorRuns;
  if (changedPaths) {
    runOptions.incrementalChangedPaths = {
      changed: changedPaths.changed,
      removed: changedPaths.removed,
    };
  }
}

/**
 * Convert a chokidar batch's absolute-path events into the root-relative
 * POSIX sets the orchestrator's scoped walk consumes (same form as
 * `node.path`). Events outside every watched root are dropped (chokidar
 * should not emit them, but the orchestrator pairs paths against prior
 * nodes by this exact form so a stray absolute path would never match).
 * Returns `null` when no event mapped to a usable path, so the caller
 * falls back to a full walk rather than a no-op scoped walk.
 */
function toIncrementalPaths(
  events: readonly IWatchEvent[],
  roots: readonly string[],
  cwd: string,
): IIncrementalPaths | null {
  const absRoots = roots.map((r) => (isAbsolute(r) ? r : resolve(cwd, r)));
  const changed = new Set<string>();
  const removed = new Set<string>();
  for (const ev of events) {
    const rel = relativeFromRoots(ev.absolutePath, absRoots);
    if (rel === null) continue;
    if (ev.kind === 'unlink') removed.add(rel);
    else changed.add(rel); // 'add' | 'change'
  }
  if (changed.size === 0 && removed.size === 0) return null;
  return { changed, removed };
}

/**
 * Root-relative POSIX form of `absolute` under the first containing
 * root, or `null` when it sits under none. Mirrors the walker's
 * `relative(root, full).split(sep).join('/')` convention.
 */
function relativeFromRoots(absolute: string, absRoots: readonly string[]): string | null {
  for (const root of absRoots) {
    const rel = relative(root, absolute);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue;
    return rel.split(sep).join('/');
  }
  return null;
}

/**
 * Deduped union of file extensions worth watching: every registered
 * provider's read extensions (`.md` for every lens, `.toml` for codex)
 * plus the `.sm` sidecar. Static over ALL registered providers so the live
 * watcher's initial chokidar watch set is complete. Returns `undefined`
 * (no extension gate, watch everything) when ANY registered provider ships
 * a custom `walk()`: `walk()` wins over `read` (see `resolveProviderWalk`)
 * and can discover arbitrary extensions at scan time, so the gate's set
 * would be incomplete and the watcher would silently miss that provider's
 * files. Extracted (and exported) for testing and to keep `start` under
 * the complexity cap.
 */
export function computeWatchedExtensions(
  noBuiltIns: boolean,
  pluginProviders: readonly Pick<IProvider, 'read' | 'walk'>[],
): string[] | undefined {
  const providers = [
    ...(noBuiltIns ? [] : builtIns().providers),
    ...pluginProviders,
  ];
  if (providers.some((p) => typeof p.walk === 'function')) return undefined;
  return [...new Set([...collectReadExtensions(providers), '.sm'])];
}

/**
 * Resolve which backend the PRIMARY scan watcher uses. Pure: keyed off
 * the persisted `scan.watch.backend` and the per-invocation
 * `--watch-backend` override, so it is unit-testable without booting a
 * watcher.
 *
 *   - `override` (the `--watch-backend <chokidar|parcel>` flag) wins when
 *     present, letting an operator pin the backend for one `sm serve` /
 *     `sm watch` / `sm scan --watch` session.
 *   - Otherwise the persisted `scan.watch.backend` applies (`'chokidar'`
 *     by default; `'parcel'` for a single native inotify instance that
 *     scales to huge trees without chokidar's `EMFILE` exhaustion).
 *
 * The meta-watcher is always chokidar (it needs `depth: 0`); this only
 * governs the primary.
 */
export function resolveWatcherBackend(
  backend: 'chokidar' | 'parcel',
  override?: 'chokidar' | 'parcel',
): 'chokidar' | 'parcel' {
  return override ?? backend;
}

/**
 * Resolve the active lens for a watcher batch from the persisted config
 * (`settings.json#/activeProvider`), falling back to filesystem
 * auto-detect via the composed providers, then to the universal markdown
 * default. Mirrors the CLI scan-runner so a lens switched mid-session via
 * `PATCH /api/active-provider` is honoured by the next batch instead of
 * the orchestrator's filesystem-only fallback (which ignores the
 * operator's choice). Pure: reads config, never persists. Extracted to
 * keep `runOnePass` under the complexity cap.
 */
function resolveWatcherLens(
  cwd: string,
  composed: ReturnType<typeof composeScanExtensions>,
): string | null {
  return resolveActiveProvider(cwd, composed?.providers ?? []).resolved;
}

export function createWatcherRuntime(
  opts: ICreateWatcherRuntimeOpts,
): IWatcherRuntimeHandle {
  const events: IWatcherEvents = opts.events ?? {};
  const cwd = opts.runtimeContext.cwd;
  const breakerLimit = opts.circuitBreaker?.maxConsecutiveFailures ?? 0;
  const runInitialBatchFlag = opts.runInitialBatch ?? DEFAULT_RUN_INITIAL_BATCH;
  const failOnInitialError = opts.failOnInitialBatchError ?? false;

  let primaryHandle: IFsWatcher | null = null;
  let metaHandle: IFsWatcher | null = null;
  let stopped = false;
  let consecutiveFailures = 0;
  let batchCount = 0;
  let outcomeKind: 'ok' | 'breaker-tripped' = 'ok';
  let stopResolve: (() => void) | null = null;
  const whenStopped = new Promise<void>((resolveStop) => {
    stopResolve = resolveStop;
  });
  const requestStop = (): void => {
    if (stopResolve) {
      const resolveOnce = stopResolve;
      stopResolve = null;
      resolveOnce();
    }
  };

  // Mutable per-run state, both `cfg` and `ignoreFilter` are reset by
  // the meta-file watcher on `.skillmapignore` / `settings.json` edits
  // so the next batch and chokidar's `ignored` predicate see the new
  // values without a watcher restart.
  let cfg: ReturnType<typeof loadConfig>['effective'];
  let ignoreFilter: IIgnoreFilter;
  let strict = false;
  let tokenize = true;

  const loadEffectiveConfig = (): ReturnType<typeof loadConfig>['effective'] =>
    loadConfig({
      ...(opts.strictOverride !== undefined ? { strict: opts.strictOverride } : {}),
      cwd,
    }).effective;

  const composeIgnoreFilter = (
    cfgIn: ReturnType<typeof loadEffectiveConfig>,
    ignoreFileText: string | undefined,
    gitignoreText: string | undefined,
  ): IIgnoreFilter => {
    const filterOpts: Parameters<typeof buildIgnoreFilter>[0] = {};
    if (cfgIn.ignore.length > 0) filterOpts.configIgnore = cfgIn.ignore;
    if (gitignoreText !== undefined) filterOpts.gitignoreText = gitignoreText;
    if (ignoreFileText !== undefined) filterOpts.ignoreFileText = ignoreFileText;
    return buildIgnoreFilter(filterOpts);
  };

  const applyConfigDerivedState = (
    cfgIn: ReturnType<typeof loadEffectiveConfig>,
  ): void => {
    strict = (opts.strictOverride === true) || cfgIn.scan.strict === true;
    tokenize = opts.tokenizeOverride === undefined
      ? cfgIn.scan.tokenize !== false
      : opts.tokenizeOverride;
  };

  // Forward declaration, `start()` builds the closure once both
  // ignoreFilter and pluginRuntime are in scope. Invoked from the
  // chokidar onBatch callbacks AND the meta-file watcher's onBatch.
  // The optional `changedPaths` carries chokidar's exact add/change/
  // unlink set so `runOnePass` can take the scoped incremental walk;
  // the meta-file watcher and the initial batch pass nothing (full walk).
  let handleBatch: ((changedPaths?: IIncrementalPaths) => Promise<void>) | null = null;

  const start = async (): Promise<void> => {
    // Pre-1.0 schema-drift rebuild, once before any DB open: if the
    // on-disk DB predates a schema change (different major.minor), wipe
    // it so the first prior read + persist see a freshly-created
    // schema. The watcher has no operator at a prompt, so it always
    // rebuilds and surfaces the result via `events.onDriftReset`.
    await rebuildWatcherDbOnDrift(opts.dbPath, events);

    cfg = loadEffectiveConfig();
    ignoreFilter = composeIgnoreFilter(cfg, readIgnoreFileText(cwd), readGitignoreText(cwd));
    applyConfigDerivedState(cfg);

    const debounceMs = opts.debounceMsOverride ?? cfg.scan.watch.debounceMs;
    events.onConfigLoaded?.({ debounceMs });

    // Plugin runtime loaded once at boot, reused across every batch.
    // A hot reload of plugin code requires restarting the watcher
    // (Step 9.1; reload-on-change can land later if it shows up in
    // real workflows).
    // Thread the BFF's runtimeContext through so plugin discovery
    // walks the same `cwd` the rest of the watcher resolves against.
    // Without this, `loadPluginRuntime` falls back to
    // `defaultRuntimeContext()` which reads `process.cwd()`, fine in
    // CLI contexts but wrong in tests and BFF setups where the
    // runtime context was overridden. Same audit-M3 wiring
    // `assembleBootBundle` already does for the boot-time
    // pluginRuntime that feeds the catalog.
    const pluginRuntime = opts.noPlugins
      ? emptyPluginRuntime()
      : await loadPluginRuntime({ runtimeContext: opts.runtimeContext });
    for (const warn of pluginRuntime.warnings) {
      events.onPluginWarning?.(warn);
    }

    // Static union of file types worth watching over ALL registered
    // providers, so chokidar's initial watch set (decided at subscribe
    // time) is complete; a newly-dropped plugin needs an `sm serve`
    // restart to be discovered regardless. See `computeWatchedExtensions`.
    const watchedExtensions = computeWatchedExtensions(
      opts.noBuiltIns,
      pluginRuntime.extensions.providers,
    );

    // Single-batch handler. Errors propagate to the caller, the
    // initial-scan path and per-batch handler treat the throw
    // differently.
    //
    // Sidecar (`*.sm`) edits do NOT need a watcher-level bypass: the
    // kernel's per-(node, extractor) cache key includes the canonical
    // hash of `node.sidecar.annotations` alongside the body hash, so
    // a `.sm` edit invalidates the cached run for every extractor on
    // that node. The watcher just trusts the kernel.
    // Fire `onBatchStart` for every batch. Extracted to a plain (non
    // optional-chaining) helper so the notification lives in ONE place
    // (initial batch + every follow-up) without adding a cyclomatic
    // branch to `runOnePass`, which already sits at the complexity cap.
    const notifyBatchStart = (): void => {
      events.onBatchStart?.();
    };

    const runOnePass = async (changedPaths?: IIncrementalPaths): Promise<ScanResult> => {
      // Fire BEFORE any scan work so adapters can light a "scanning"
      // indicator. Hooked here (not in handleBatch / runInitial) so the
      // initial batch and every follow-up batch are covered without
      // duplicating the call. `onBatch` (success or error) stops it.
      notifyBatchStart();
      // Build a fresh resolver from the layered config on every batch so
      // a `PATCH /api/plugins` made mid-session is honoured by the
      // next chokidar-driven scan WITHOUT restarting `sm serve`. The
      // runtime itself stays cached (no re-discovery, no module
      // re-import). Enable is pure config now, so this re-reads the
      // already-loaded `cfg` with no DB hit. See
      // `core/runtime/fresh-resolver.ts`.
      //
      // Exception: drop-in plugins whose discovery-time `status` was
      // `'disabled'` are NOT in `pluginRuntime.extensions.*`; a fresh
      // resolver saying `true` does not load their handlers. The spec
      // carries this exception and the SPA surfaces it per-row via
      // the `startsAsDisabled` wire flag.
      const resolveEnabledOverride = await buildFreshResolver({
        effectiveConfig: () => cfg,
      });

      const kernel = createKernel();
      registerEnabledExtensions(kernel, pluginRuntime, {
        noBuiltIns: opts.noBuiltIns,
        resolveEnabled: resolveEnabledOverride,
      });
      const emitter = opts.emitterFactory();

      // Read prior snapshot AND prior `scan_extractor_runs` in a single
      // ephemeral open. Both feed the orchestrator's incremental path,
      // splitting them would re-run migration discovery for nothing.
      const priorState = await tryWithSqlite(
        { databasePath: opts.dbPath, autoBackup: false },
        async (reader) => {
          const loaded = await reader.scans.load();
          if (loaded.nodes.length === 0) return null;
          if (strict) {
            const validators = loadSchemaValidators();
            const result = validators.validate('scan-result', loaded);
            if (!result.ok) {
              throw new Error(
                tx(RUNTIME_TEXTS.priorSchemaValidationFailed, { errors: result.errors }),
              );
            }
          }
          const extractorRuns = await reader.scans.loadExtractorRuns();
          return { snapshot: loaded, extractorRuns };
        },
      );

      const composeOpts: Parameters<typeof composeScanExtensions>[0] = {
        noBuiltIns: opts.noBuiltIns,
        pluginRuntime,
        resolveEnabled: resolveEnabledOverride,
        resolveSettings: buildSettingsResolver(cfg),
        forbidSidecarWriters: cfg.allowSidecarWriters === false,
      };
      if (opts.killSwitches) composeOpts.killSwitches = opts.killSwitches;
      const composed = composeScanExtensions(composeOpts);
      const runOptions: Parameters<typeof runScanWithRenames>[1] = {
        // Roots are preserved verbatim (same as the CLI scan-runner, per
        // `core/runtime/scan-roots.ts` and `spec/cli-contract.md` § Scan):
        // `ScanResult.roots` shows what the caller passed; the orchestrator
        // resolves internally against `process.cwd()`. For real `sm serve` /
        // `sm watch` runs `process.cwd()` IS the project (== runtimeContext
        // cwd), so the walk targets the right tree. Tests that pass a `cwd`
        // differing from `process.cwd()` must pass absolute roots.
        roots: opts.roots,
        tokenize,
        tokenizer: cfg.tokenizer,
        ignoreFilter,
        strict,
        emitter,
        scanCeiling: cfg.scan.maxScan,
        overrideScanCeiling: opts.maxScanOverride ?? null,
        maxRenderNodes: cfg.scan.maxNodes,
        overrideMaxRenderNodes: opts.maxNodesOverride ?? null,
        maxFileSizeBytes: cfg.scan.maxFileSizeBytes,
        followExternalSymlinks: cfg.scan.followExternalSymlinks,
        // Resolve the active lens from the persisted config (settings.json)
        // so a lens switched via `PATCH /api/active-provider` is honoured by
        // the next watcher batch. Without an explicit value the orchestrator
        // falls back to filesystem detection, which ignores the operator's
        // choice (e.g. selecting `markdown` while `.claude/` is still on disk
        // would re-detect `claude` and silently overwrite the chosen lens).
        activeProvider: resolveWatcherLens(cwd, composed),
        // Always threaded (not only when referencePaths is configured):
        // the orchestrator's link-target existence probe anchors relative
        // roots on `cwd`; leaving it unset would silently disable the
        // probe on every watcher batch and diverge from CLI `sm scan`.
        cwd,
      };
      // Reference-paths escape hatch: mirror what `scan-runner.ts`
      // (the CLI path) does, walk the configured side-roots and pass
      // the absolute-path set through so `core/reference-broken` can short-
      // circuit links that resolve onto disk outside the indexed graph.
      // Without this the server's boot-scan and every subsequent batch
      // ignored `scan.referencePaths`, producing false-positive broken
      // refs that diverged from `sm scan` on the CLI.
      if (cfg.scan.referencePaths.length > 0) {
        const walk = walkReferencePaths(cfg.scan.referencePaths, cwd);
        if (walk.paths.size > 0) {
          runOptions.referenceablePaths = walk.paths;
        }
      }
      if (composed) runOptions.extensions = composed;
      applyPriorStateToRunOptions(runOptions, priorState, changedPaths);

      const ran = await runScanWithRenames(kernel, runOptions);
      const {
        result,
        renameOps,
        extractorRuns,
        enrichments,
        contributions,
        contributionErrors,
        linkScores,
        freshlyRunTuples,
      } = ran;

      await withSqlite({ databasePath: opts.dbPath }, (writer) =>
        writer.scans.persist(result, {
          renameOps,
          extractorRuns,
          enrichments,
          contributions,
          contributionErrors,
          linkScores,
          registeredContributionKeys: collectRegisteredContributionKeys(composed),
          freshlyRunTuples,
        }),
      );

      return result;
    };

    // Per-batch wrapper: invoke `runOnePass`, route the outcome through
    // `events.onBatch`, advance the breaker / `maxBatches` counters,
    // request stop on terminal conditions.
    // Per-batch wrapper. Branching is intrinsic to the lifecycle
    // (success vs failure, breaker on/off, maxBatches reached);
    // splitting into helpers would scatter the dispatch table.
    // eslint-disable-next-line complexity
    handleBatch = async (changedPaths?: IIncrementalPaths): Promise<void> => {
      if (stopped) return;
      batchCount++;
      try {
        const result = await runOnePass(changedPaths);
        consecutiveFailures = 0;
        events.onBatch?.({ kind: 'ok', result });
      } catch (err) {
        const message = formatErrorMessage(err);
        events.onBatch?.({ kind: 'error', message });
        consecutiveFailures += 1;
        if (breakerLimit > 0 && consecutiveFailures >= breakerLimit) {
          events.onBreakerTripped?.(consecutiveFailures, message);
          outcomeKind = 'breaker-tripped';
          stopped = true;
          // Close chokidar handles before resolving `whenStopped` so
          // callers don't have to invoke `stop()` defensively after
          // awaiting (audit m9). `requestStop()` then signals the
          // promise.
          await closeQuietly();
          requestStop();
          return;
        }
      }
      if (opts.maxBatches !== undefined && batchCount >= opts.maxBatches) {
        stopped = true;
        await closeQuietly();
        requestStop();
      }
    };

    const runInitial = async (): Promise<void> => {
      if (!runInitialBatchFlag) return;
      try {
        const result = await runOnePass();
        events.onBatch?.({ kind: 'ok', result });
      } catch (err) {
        const message = formatErrorMessage(err);
        events.onBatch?.({ kind: 'error', message });
        if (failOnInitialError) {
          // Audit H1: resolve `whenStopped` before propagating so
          // callers awaiting it after a failed `start()` don't hang
          // forever. The CLI today returns early and never awaits,
          // but the runtime contract should hold for any caller
          // doing the natural `await start(); await whenStopped`.
          stopped = true;
          requestStop();
          throw err;
        }
      }
    };

    const subscribePrimary = (): void => {
      // Pick the PRIMARY watcher backend (see `scan.watch.backend`, plus
      // the per-invocation `--watch-backend` override): parcel (a single
      // native inotify instance) scales to huge trees without chokidar's
      // `EMFILE` exhaustion; chokidar observes changes behind a symlinked
      // directory live (parcel's symlink support is weak). The meta-watcher
      // below is always chokidar (`depth: 0`, which parcel cannot express).
      const createPrimary =
        resolveWatcherBackend(cfg.scan.watch.backend, opts.watchBackendOverride) === 'chokidar'
          ? createChokidarWatcher
          : createParcelWatcher;
      primaryHandle = createPrimary({
        roots: opts.roots,
        cwd,
        debounceMs,
        // Watch only the file types a scan would open (provider
        // `read.extensions` + the `.sm` sidecar); a `.json` / `.txt` edit
        // no longer wakes the watcher. The meta-watcher below handles the
        // config files (`.skillmapignore` / `.gitignore` / settings),
        // which fall outside this set, by exact path.
        watchedExtensions,
        // Pass a getter, NOT the filter directly: the meta-file watcher
        // mutates `ignoreFilter` after a `.skillmapignore` /
        // `.skill-map/settings.json` edit, and chokidar's `ignored`
        // predicate must read the current value on every event.
        ignoreFilter: (): IIgnoreFilter => ignoreFilter,
        onBatch: async ({ events: batchEvents }) => {
          if (!handleBatch) return;
          // Thread chokidar's exact changed-path list into the scoped
          // incremental walk. When the batch maps to no usable path
          // (everything outside the roots), `toIncrementalPaths` returns
          // null and we fall back to a full walk (passing no argument).
          const changedPaths = toIncrementalPaths(batchEvents, opts.roots, cwd);
          if (changedPaths) await handleBatch(changedPaths);
          else await handleBatch();
        },
        onError: (err) => {
          events.onWatcherError?.(err.message);
        },
      });
    };

    const subscribeMeta = (): void => {
      const ignorePath = defaultIgnoreFilePath(cwd);
      const settingsPath = defaultSettingsPath(cwd);
      const gitignorePath = defaultGitignorePath(cwd);
      // Targets the meta-watcher reacts to. The chokidar watcher itself
      // observes the parent directories; we filter inside `onBatch` so
      // unrelated edits in those directories (a `README.md` save at
      // the project root, an unrelated DB file under `.skill-map/`) do
      // not spuriously rebuild the ignore filter.
      const metaTargets = new Set<string>([ignorePath, settingsPath, gitignorePath]);

      metaHandle = createChokidarWatcher({
        // Watch the PARENT directories with `depth: 0`, not the
        // individual files. Why: chokidar single-file watching on
        // macOS + FSEvents loses the watch when an editor performs an
        // atomic save (write to a tempfile, rename over the target).
        // The original inode the watcher attached to is gone and the
        // newly-renamed file is unobserved, so a `.skillmapignore`
        // edit silently fails to reach this hook and stale nodes
        // remain in the graph until the user touches some `.md` file
        // to force a per-file re-evaluation. Watching the parent
        // directory tracks the target by name (chokidar maps
        // directory-level events to filename), so atomic saves
        // surface as a normal `change` event regardless of inode
        // churn. The `metaTargets` filter above strips events for any
        // other file the parent directories happen to contain.
        roots: [
          cwd, // parent of `.skillmapignore`
          dirname(settingsPath), // parent of `.skill-map/settings.json`
        ],
        cwd,
        debounceMs,
        depth: 0,
        // No ignore filter, these specific paths must always be
        // observed regardless of any user pattern.
        onBatch: async ({ paths }) => {
          if (!paths.some((p) => metaTargets.has(p))) return;
          if (stopped) return;
          try {
            cfg = loadEffectiveConfig();
            // Stability poll on the file: chokidar fires `change` on
            // the first motion of a save (truncate-then-write), and a
            // naive sync read can land while the file is empty /
            // partial. The helper retries until two reads agree (or
            // 500 ms cap). See `readIgnoreFileTextStable` in
            // `kernel/scan/ignore.ts`.
            const [stableText, gitignoreText] = await Promise.all([
              readIgnoreFileTextStable(cwd),
              readGitignoreTextStable(cwd),
            ]);
            ignoreFilter = composeIgnoreFilter(cfg, stableText, gitignoreText);
            applyConfigDerivedState(cfg);
            if (handleBatch) await handleBatch();
          } catch (err) {
            // Surface the failure on the same channel as a regular
            // batch failure; the breaker counter is intentionally NOT
            // bumped (a meta-file rebuild is operator-driven, not
            // worker-loop noise).
            const message = formatErrorMessage(err);
            events.onBatch?.({ kind: 'error', message });
          }
        },
        onError: (err) => {
          events.onWatcherError?.(err.message);
        },
      });
    };

    if (opts.subscribeBeforeInitial === true) {
      // BFF ordering: subscribe first so events arriving during the
      // initial batch queue against the armed chokidar.
      subscribePrimary();
      subscribeMeta();
      await primaryHandle!.ready;
      await metaHandle!.ready;
      await runInitial();
    } else {
      // CLI ordering: initial scan first; events during it are lost.
      await runInitial();
      subscribePrimary();
      subscribeMeta();
      await primaryHandle!.ready;
      await metaHandle!.ready;
    }

    events.onReady?.({ roots: opts.roots, debounceMs });
  };

  const closeQuietly = async (): Promise<void> => {
    if (metaHandle) {
      try {
        await metaHandle.close();
      } catch {
        // already a chokidar-level error, caller has been notified.
      }
      metaHandle = null;
    }
    if (primaryHandle) {
      try {
        await primaryHandle.close();
      } catch {
        // ditto.
      }
      primaryHandle = null;
    }
  };

  const stop = async (): Promise<void> => {
    if (stopped && !primaryHandle && !metaHandle) {
      requestStop();
      return;
    }
    stopped = true;
    await closeQuietly();
    requestStop();
  };

  return {
    start,
    stop,
    whenStopped,
    outcome: () => outcomeKind,
    batchCount: () => batchCount,
  };
}

// Type re-exports kept for adapter convenience.
export type {
  IEnrichmentRecord,
  IExtractorRunRecord,
  RenameOp,
  ScanResult,
};
