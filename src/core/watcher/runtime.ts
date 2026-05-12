/**
 * Shared watcher machinery — the chokidar boot, plugin runtime load,
 * primary + meta-file subscriptions, debounced rescan, prior-snapshot
 * load, persist branch — extracted from the two ~80%-identical
 * implementations that used to live in `cli/commands/watch.ts:runWatchLoop`
 * and `server/watcher.ts:WatcherService`.
 *
 * The runtime is pure machinery — no Clipanion, no Hono, no streams.
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
 *   - `false` (CLI default — `runWatchLoop` historic shape): initial
 *     scan first, then subscribe. Events arriving during the initial
 *     scan are LOST (no chokidar instance exists yet). Users hand-edit
 *     so the next save covers any race.
 *   - `true` (BFF default — `WatcherService` historic shape):
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
 * test breaks, the runtime is reproducing a bug from one side — fix
 * the runtime, not the test.
 */

import {
  createChokidarWatcher,
  createKernel,
  runScanWithRenames,
  type IFsWatcher,
} from '../../kernel/index.js';
import type {
  IEnrichmentRecord,
  IExtractorRunRecord,
  RenameOp,
  ScanResult,
} from '../../kernel/index.js';
import { dirname } from 'node:path';

import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { loadConfig } from '../../kernel/config/loader.js';
import {
  buildIgnoreFilter,
  readIgnoreFileText,
  readIgnoreFileTextStable,
  type IIgnoreFilter,
} from '../../kernel/scan/ignore.js';
import type { ProgressEmitterPort } from '../../kernel/ports/progress-emitter.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import {
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
export type IWatcherBatchOutcome =
  | { kind: 'ok'; result: ScanResult }
  | { kind: 'error'; message: string };

/**
 * Callbacks the adapters subscribe to. Every callback is optional —
 * adapters wire only what they need.
 */
export interface IWatcherEvents {
  /**
   * Called once per debounced batch (including the initial batch when
   * `runInitialBatch !== false`) with the per-batch outcome. Adapters
   * use this for adapter-specific rendering — CLI emits a
   * `scannedSummary` line or a ndjson record; BFF does nothing (the
   * kernel emitter already handled it).
   */
  onBatch?: (outcome: IWatcherBatchOutcome) => void;
  /**
   * Called when chokidar surfaces a transport-level error (rare —
   * EMFILE, missing root). The watcher itself stays open per
   * `IFsWatcher`'s contract; the adapter decides whether to log,
   * broadcast, or both.
   */
  onWatcherError?: (message: string) => void;
  /**
   * Called once per plugin-runtime warning at boot. Every line is a
   * complete diagnostic (rendered by `formatWarning` in the plugin
   * runtime) — no further framing required. Adapters route them via
   * their own surfaces (CLI `printer.warn`, BFF `log.warn`).
   */
  onPluginWarning?: (message: string) => void;
  /**
   * Called once both chokidar instances have reported `ready` AND the
   * runtime has run its initial batch (when enabled). `roots` is the
   * concrete root list the watcher subscribed to; `debounceMs` is the
   * resolved value (override or `cfg.scan.watch.debounceMs`).
   */
  onReady?: (info: { roots: string[]; debounceMs: number }) => void;
  /**
   * Called synchronously inside `start()` once `loadEffectiveConfig()`
   * has resolved and the debounce window is known — BEFORE chokidar
   * subscribes and the initial batch runs. Adapters that want a
   * "starting" preview line use this to avoid loading config a second
   * time just to read `debounceMs`.
   *
   * Optional. If unset, the runtime simply skips the notification.
   */
  onConfigLoaded?: (info: { debounceMs: number }) => void;
  /**
   * Called when the consecutive-failure circuit breaker trips.
   * Adapters that disable the breaker (BFF — long-running daemon)
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
   * (`defaultProjectDbPath(ctx)` / `IServerOptions.dbPath`) — the
   * runtime never composes it.
   */
  dbPath: string;
  /** Resolution scope. `'global'` reads `~/.skill-map/...` only. */
  scope: 'project' | 'global';
  /** Roots to watch. `['.']` for the BFF; user-supplied list for the CLI. */
  roots: string[];
  /** Runtime context (`cwd`, `homedir`) — kernel never reads `process.*`. */
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
   * the historic `false` (scan then subscribe — events during the
   * initial scan are lost); BFF flips it to `true` (subscribe then
   * scan — events queue against the armed watcher and fire a
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
   * Resolves once the runtime has stopped — either via `stop()`,
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
 * Construct the watcher runtime. Pure factory — every dependency
 * comes through the options bag.
 */
export function createWatcherRuntime(
  opts: ICreateWatcherRuntimeOpts,
): IWatcherRuntimeHandle {
  const events: IWatcherEvents = opts.events ?? {};
  const cwd = opts.runtimeContext.cwd;
  const breakerLimit = opts.circuitBreaker?.maxConsecutiveFailures ?? 0;
  const runInitialBatchFlag = opts.runInitialBatch ?? DEFAULT_RUN_INITIAL_BATCH;
  const failOnInitialError = opts.failOnInitialBatchError ?? false;

  let chokidarHandle: IFsWatcher | null = null;
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

  // Mutable per-run state — both `cfg` and `ignoreFilter` are reset by
  // the meta-file watcher on `.skillmapignore` / `settings.json` edits
  // so the next batch and chokidar's `ignored` predicate see the new
  // values without a watcher restart.
  let cfg: ReturnType<typeof loadConfig>['effective'];
  let ignoreFilter: IIgnoreFilter;
  let strict = false;
  let tokenize = true;

  const loadEffectiveConfig = (): ReturnType<typeof loadConfig>['effective'] =>
    loadConfig({
      scope: opts.scope,
      ...(opts.strictOverride !== undefined ? { strict: opts.strictOverride } : {}),
      cwd,
      homedir: opts.runtimeContext.homedir,
    }).effective;

  const composeIgnoreFilter = (
    cfgIn: ReturnType<typeof loadEffectiveConfig>,
    ignoreFileText: string | undefined,
  ): IIgnoreFilter => {
    const filterOpts: Parameters<typeof buildIgnoreFilter>[0] = {};
    if (cfgIn.ignore.length > 0) filterOpts.configIgnore = cfgIn.ignore;
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

  // Forward declaration — `start()` builds the closure once both
  // ignoreFilter and pluginRuntime are in scope. Invoked from the
  // chokidar onBatch callbacks AND the meta-file watcher's onBatch.
  let handleBatch: (() => Promise<void>) | null = null;

  const start = async (): Promise<void> => {
    cfg = loadEffectiveConfig();
    ignoreFilter = composeIgnoreFilter(cfg, readIgnoreFileText(cwd));
    applyConfigDerivedState(cfg);

    const debounceMs = opts.debounceMsOverride ?? cfg.scan.watch.debounceMs;
    events.onConfigLoaded?.({ debounceMs });

    // Plugin runtime loaded once at boot, reused across every batch.
    // A hot reload of plugin code requires restarting the watcher
    // (Step 9.1; reload-on-change can land later if it shows up in
    // real workflows).
    // Thread the BFF's runtimeContext through so plugin discovery
    // walks the same `cwd` / `homedir` the rest of the watcher
    // resolves against (line 287). Without this, `loadPluginRuntime`
    // falls back to `defaultRuntimeContext()` which reads
    // `process.cwd()` — fine in CLI contexts but wrong in tests
    // and BFF setups where the runtime context was overridden.
    // Same audit-M3 wiring `assembleBootBundle` already does for the
    // boot-time pluginRuntime that feeds the catalog.
    const pluginRuntime = opts.noPlugins
      ? emptyPluginRuntime()
      : await loadPluginRuntime({ scope: opts.scope, runtimeContext: opts.runtimeContext });
    for (const warn of pluginRuntime.warnings) {
      events.onPluginWarning?.(warn);
    }

    // Single-batch handler. Errors propagate to the caller — the
    // initial-scan path and per-batch handler treat the throw
    // differently.
    //
    // Sidecar (`*.sm`) edits do NOT need a watcher-level bypass: the
    // kernel's per-(node, extractor) cache key includes the canonical
    // hash of `node.sidecar.annotations` alongside the body hash, so
    // a `.sm` edit invalidates the cached run for every extractor on
    // that node. The watcher just trusts the kernel.
    const runOnePass = async (): Promise<ScanResult> => {
      // Build a fresh resolver from `config_plugins` on every batch so
      // a `PATCH /api/plugins` made mid-session is honoured by the
      // next chokidar-driven scan WITHOUT restarting `sm serve`. The
      // bundle itself stays cached (no re-discovery, no module
      // re-import). One SQLite read per batch — cheap. See
      // `core/runtime/fresh-resolver.ts`.
      //
      // Exception: drop-in plugins whose discovery-time `status` was
      // `'disabled'` are NOT in `pluginRuntime.extensions.*`; a fresh
      // resolver saying `true` does not load their handlers. The spec
      // carries this exception and the SPA surfaces it per-row via
      // the `startsAsDisabled` wire flag.
      const resolveEnabledOverride = await buildFreshResolver({
        databasePath: opts.dbPath,
        effectiveConfig: () => cfg,
        fallbackResolver: pluginRuntime.resolveEnabled,
      });

      const kernel = createKernel();
      registerEnabledExtensions(kernel, pluginRuntime, {
        noBuiltIns: opts.noBuiltIns,
        resolveEnabled: resolveEnabledOverride,
      });
      const emitter = opts.emitterFactory();

      // Read prior snapshot AND prior `scan_extractor_runs` in a single
      // ephemeral open. Both feed the orchestrator's incremental path —
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
      };
      if (opts.killSwitches) composeOpts.killSwitches = opts.killSwitches;
      const composed = composeScanExtensions(composeOpts);
      const runOptions: Parameters<typeof runScanWithRenames>[1] = {
        roots: opts.roots,
        scope: opts.scope,
        tokenize,
        ignoreFilter,
        strict,
        emitter,
      };
      if (composed) runOptions.extensions = composed;
      if (priorState) {
        runOptions.priorSnapshot = priorState.snapshot;
        // The watcher wants cache reuse by default — re-walking unchanged
        // files on every batch defeats the point of debouncing.
        runOptions.enableCache = true;
        runOptions.priorExtractorRuns = priorState.extractorRuns;
      }

      const ran = await runScanWithRenames(kernel, runOptions);
      const { result, renameOps, extractorRuns, enrichments, contributions, freshlyRunTuples } = ran;

      await withSqlite({ databasePath: opts.dbPath }, (writer) =>
        writer.scans.persist(result, {
          renameOps,
          extractorRuns,
          enrichments,
          contributions,
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
    handleBatch = async (): Promise<void> => {
      if (stopped) return;
      batchCount++;
      try {
        const result = await runOnePass();
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
      chokidarHandle = createChokidarWatcher({
        roots: opts.roots,
        cwd,
        debounceMs,
        // Pass a getter, NOT the filter directly: the meta-file watcher
        // mutates `ignoreFilter` after a `.skillmapignore` /
        // `.skill-map/settings.json` edit, and chokidar's `ignored`
        // predicate must read the current value on every event.
        ignoreFilter: (): IIgnoreFilter => ignoreFilter,
        onBatch: async () => {
          if (handleBatch) await handleBatch();
        },
        onError: (err) => {
          events.onWatcherError?.(err.message);
        },
      });
    };

    const subscribeMeta = (): void => {
      const ignorePath = defaultIgnoreFilePath(cwd);
      const settingsPath = defaultSettingsPath(cwd);
      // Targets the meta-watcher reacts to. The chokidar watcher itself
      // observes the parent directories; we filter inside `onBatch` so
      // unrelated edits in those directories (a `README.md` save at
      // the project root, an unrelated DB file under `.skill-map/`) do
      // not spuriously rebuild the ignore filter.
      const metaTargets = new Set<string>([ignorePath, settingsPath]);

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
        // No ignore filter — these specific paths must always be
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
            const stableText = await readIgnoreFileTextStable(cwd);
            ignoreFilter = composeIgnoreFilter(cfg, stableText);
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
      await chokidarHandle!.ready;
      await metaHandle!.ready;
      await runInitial();
    } else {
      // CLI ordering: initial scan first; events during it are lost.
      await runInitial();
      subscribePrimary();
      subscribeMeta();
      await chokidarHandle!.ready;
      await metaHandle!.ready;
    }

    events.onReady?.({ roots: opts.roots, debounceMs });
  };

  const closeQuietly = async (): Promise<void> => {
    if (metaHandle) {
      try {
        await metaHandle.close();
      } catch {
        // already a chokidar-level error — caller has been notified.
      }
      metaHandle = null;
    }
    if (chokidarHandle) {
      try {
        await chokidarHandle.close();
      } catch {
        // ditto.
      }
      chokidarHandle = null;
    }
  };

  const stop = async (): Promise<void> => {
    if (stopped && !chokidarHandle && !metaHandle) {
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
