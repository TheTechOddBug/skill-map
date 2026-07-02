/**
 * `WatcherService`, chokidar-fed scan loop that broadcasts kernel events
 * over `/ws`. The BFF parallel of `src/cli/commands/watch.ts:runWatchLoop`,
 * now a thin adapter over the shared `core/watcher/runtime.ts`.
 *
 * Per Decision #121: each debounced batch runs `runScanWithRenames` +
 * `persistScanResult`. A read-only watcher was rejected, a server with
 * stale DB while a sibling `sm` writes is a footgun (clients see
 * divergent state, two pipelines diverge silently).
 *
 * Adapter responsibilities (everything else lives in the runtime):
 *
 *   - Build the broadcaster-bridged `ProgressEmitterPort` (per-batch
 *     factory so the kernel emitter wires fresh state every time).
 *   - Wire runtime events to `log.warn` / broadcaster envelopes:
 *     `onWatcherError` → `log.warn` + `watcher.error`,
 *     `onReady` → `watcher.started` + `log.info`.
 *   - Keep ordering knobs that are BFF-specific (subscribe BEFORE
 *     initial batch so edits during the initial scan queue and fire a
 *     follow-up batch).
 *
 * Per-batch failure handling: `events.onBatch({ kind: 'error' })`
 * funnels through `log.warn` here. The runtime never emits
 * `scan.failed` envelopes, Step 14.4.b will define that shape; today
 * we log and let the broadcaster stay alive.
 *
 * On chokidar's own error (rare, bad watch root, EMFILE): log +
 * broadcast a `watcher.error` advisory event. The watcher itself
 * stays open per `IFsWatcher`'s contract.
 */

import type { ProgressEmitterPort } from '../kernel/ports/progress-emitter.js';
import type { ScanResult } from '../kernel/index.js';
import { formatOversizedFilePair } from '../kernel/util/format-oversized.js';
import { log } from '../kernel/util/logger.js';
import { sanitizeForTerminal } from '../kernel/util/safe-text.js';
import { tx } from '../kernel/util/tx.js';
import type { IRuntimeContext } from '../core/runtime/runtime-context.js';
import { createScanSpinner, type IScanSpinner } from '../core/runtime/scan-spinner.js';
import {
  createWatcherRuntime,
  type ICreateWatcherRuntimeOpts,
} from '../core/watcher/runtime.js';

import type { WsBroadcaster } from './broadcaster.js';
import { buildWatcherErrorEvent, buildWatcherStartedEvent } from './events.js';
import { SERVER_TEXTS } from './i18n/server.texts.js';
import type { IServerOptions } from './options.js';

export interface ICreateWatcherServiceOpts {
  options: IServerOptions;
  runtimeContext: IRuntimeContext;
  broadcaster: WsBroadcaster;
  /** Optional override for the chokidar debounce window (ms). Falls back to `scan.watch.debounceMs` from config. */
  debounceMsOverride?: number | undefined;
  /**
   * Optional override for the primary watcher backend (`--watch-backend
   * <chokidar|parcel>` on `sm serve`). Falls back to `scan.watch.backend`
   * from config when `undefined`.
   */
  watchBackendOverride?: 'chokidar' | 'parcel' | undefined;
  /**
   * When set, an animated scan spinner spins on `stream` while each
   * watcher batch runs (file save to re-scan) and clears + prints a
   * one-line confirmation on completion. The CLI verb (`sm serve`)
   * threads its `stderr` plus the resolved color toggle here; the
   * spinner degrades to a single plain line on a non-TTY stream. Unset
   * (tests, head-less boots) means no spinner is wired.
   */
  scanProgress?: {
    stream: NodeJS.WritableStream & { isTTY?: boolean };
    colorEnabled: boolean;
  };
}

export interface IWatcherServiceHandle {
  /**
   * Boot the watcher: load config + plugin runtime, subscribe via
   * `createChokidarWatcher`, broadcast a `watcher.started` advisory
   * once chokidar's initial walk completes. Resolves once the watcher
   * is live.
   *
   * Failures during boot (config load, plugin runtime, chokidar bind)
   * propagate to the caller so `createServer` can surface them as a
   * boot-time error. After `start()` resolves, all subsequent failures
   * are per-batch and logged (never thrown, the broadcaster stays up).
   */
  start(): Promise<void>;
  /**
   * Gracefully tear down the watcher: stop accepting new batches, drain
   * the in-flight batch (if any), close chokidar handles. Idempotent,
   * a second call resolves immediately.
   */
  stop(): Promise<void>;
  /**
   * Tear down the current runtime and re-create it with a fresh
   * config snapshot. Used by `PATCH /api/project-preferences` after a
   * write that changes `scan.referencePaths` so the side-set walk
   * sees the new paths on the next batch. Idempotent: when the
   * runtime is not running, `restart()` boots it; when it is, it
   * stops and re-starts in one call.
   */
  restart(): Promise<void>;
}

/**
 * Holder threaded through the route deps so a route can invoke
 * `restart()` on the watcher AFTER the composition root has wired it.
 * `createServer` instantiates the holder first, passes it to
 * `createApp`, then mutates `current` once the watcher has actually
 * booted. Routes consume `holder.current?.restart()` defensively, the
 * field is null when the operator launched `sm serve --no-watcher` or
 * when the boot itself failed.
 */
export interface IWatcherServiceHolder {
  current: IWatcherServiceHandle | null;
}

/**
 * Construct a watcher service. Pure factory, every dependency comes
 * through the options bag. The caller (`createServer`) wires the
 * broadcaster and runtime context at composition time.
 *
 * Mirrors the CLI's `loadPluginRuntime()` semantics: plugins are
 * loaded ONCE at watcher boot and reused across every batch.
 * Hot-reload of plugin code requires restarting the server (same
 * trade-off as `sm watch`; see Step 9.1 §note).
 *
 * **Roots**: the watcher walks the project cwd (`'.'`). Extending
 * the indexed scan beyond cwd is per-invocation via positional roots
 * to `sm scan`, not a server-side concern. `restart()` exists so
 * `PATCH /api/project-preferences` can re-arm chokidar after a
 * `scan.referencePaths` write so the side-set walk picks up the new
 * paths on the next batch.
 */
export function createWatcherService(opts: ICreateWatcherServiceOpts): IWatcherServiceHandle {
  // Plugin runtime stays cached at the kernel layer below; the
  // watcher's chokidar subscription is rebuilt on every `start()` /
  // `restart()` so config writes via `PATCH /api/project-preferences`
  // take effect without a full server reboot.
  let currentRuntime: ReturnType<typeof createWatcherRuntime> | null = null;

  // One spinner per service (NOT per batch): the spinner tracks a single
  // in-flight indicator across the service's lifetime. Unset when the
  // caller did not pass `scanProgress` (tests, head-less boots).
  const spinner: IScanSpinner | undefined = opts.scanProgress
    ? createScanSpinner(opts.scanProgress.stream, {
        colorEnabled: opts.scanProgress.colorEnabled,
      })
    : undefined;

  const buildRuntimeOpts = (): ICreateWatcherRuntimeOpts => {
    const runtimeOpts: ICreateWatcherRuntimeOpts = {
      dbPath: opts.options.dbPath,
      roots: ['.'],
      runtimeContext: opts.runtimeContext,
      noBuiltIns: opts.options.noBuiltIns,
      noPlugins: opts.options.noPlugins,
      emitterFactory: () => buildBroadcasterEmitter(opts.broadcaster),
      runInitialBatch: true,
      // BFF ordering: subscribe first so edits arriving during the
      // initial scan queue against the armed chokidar and fire a
      // follow-up batch.
      subscribeBeforeInitial: true,
      failOnInitialBatchError: false,
      events: {
        // Light the "scanning" indicator the moment a batch begins (file
        // save to re-scan). No-op when no `scanProgress` was passed.
        onBatchStart: () => spinner?.start(),
        onBatch: (outcome) => {
          // Clear the spinner FIRST, before any warning prints to the
          // same pane, so the confirmation / warning never collides with
          // a half-drawn spinner frame.
          spinner?.stop(
            outcome.kind === 'ok'
              ? {
                  nodesCount: outcome.result.stats.nodesCount,
                  durationMs: outcome.result.stats.durationMs,
                }
              : undefined,
          );
          if (outcome.kind === 'error') {
            // TODO(14.4.b / 14.5): emit `scan.failed` event once the
            // shape is locked in spec/job-events.md. For 14.4.a we log
            // and continue, a transient FS error must NOT kill the
            // broadcaster.
            log.warn(
              tx(SERVER_TEXTS.watcherBatchFailed, {
                message: sanitizeForTerminal(outcome.message),
              }),
            );
            return;
          }
          // File-size skip WARN. `onBatch` fires for the initial scan
          // (runInitialBatch: true) AND every follow-up batch, so this
          // one handler surfaces oversized files at startup and on every
          // re-scan. Logged on the server pane, not broadcast (the UI
          // raises its own banner from the persisted `oversizedFiles`).
          warnOversizedFiles(outcome.result);
        },
        onWatcherError: (message) => {
          // chokidar transport-level error, log + broadcast advisory
          // envelope. The watcher itself stays open per IFsWatcher's
          // contract.
          log.warn(
            tx(SERVER_TEXTS.watcherError, {
              message: sanitizeForTerminal(message),
            }),
          );
          opts.broadcaster.broadcast(buildWatcherErrorEvent({ message }));
        },
        onPluginWarning: (message) => {
          // Surface plugin-load warnings on the `log.warn` channel
          // verbatim. Boot-time, too early for any client to be
          // listening; no advisory broadcast.
          log.warn(sanitizeForTerminal(message));
        },
        onDriftReset: (info) => {
          // Pre-1.0 schema-drift rebuild ran on watcher boot. Surface
          // it on the log channel so the silent wipe is visible in the
          // server pane; no broadcast (boot-time, no client yet).
          log.warn(
            tx(SERVER_TEXTS.watcherDriftReset, {
              dbVersion: info.dbVersion,
              currentVersion: info.currentVersion,
            }),
          );
        },
        onReady: (info) => {
          opts.broadcaster.broadcast(
            buildWatcherStartedEvent({ roots: info.roots, debounceMs: info.debounceMs }),
          );
          log.info(
            tx(SERVER_TEXTS.watcherReady, {
              roots: info.roots.join(','),
              debounceMs: String(info.debounceMs),
            }),
          );
        },
      },
    };
    if (opts.debounceMsOverride !== undefined) {
      runtimeOpts.debounceMsOverride = opts.debounceMsOverride;
    }
    if (opts.watchBackendOverride !== undefined) {
      runtimeOpts.watchBackendOverride = opts.watchBackendOverride;
    }
    if (opts.options.maxScan !== undefined) {
      runtimeOpts.maxScanOverride = opts.options.maxScan;
    }
    if (opts.options.maxNodes !== undefined) {
      runtimeOpts.maxNodesOverride = opts.options.maxNodes;
    }
    return runtimeOpts;
  };

  return {
    async start(): Promise<void> {
      currentRuntime = createWatcherRuntime(buildRuntimeOpts());
      await currentRuntime.start();
    },
    async stop(): Promise<void> {
      if (currentRuntime) {
        await currentRuntime.stop();
        currentRuntime = null;
      }
    },
    async restart(): Promise<void> {
      if (currentRuntime) {
        await currentRuntime.stop();
        currentRuntime = null;
      }
      currentRuntime = createWatcherRuntime(buildRuntimeOpts());
      await currentRuntime.start();
    },
  };
}

/**
 * Surface a WARN on the server pane when the batch skipped one or more
 * files for exceeding `scan.maxFileSizeBytes`. Lists each skipped file
 * as `path (humanSize)`. No broadcast: the UI raises its own banner
 * from the persisted `oversizedFiles`, so a duplicate WS advisory would
 * be noise. No-op when nothing was skipped.
 */
function warnOversizedFiles(result: ScanResult): void {
  const oversized = result.oversizedFiles ?? [];
  if ((result.stats.filesOversized ?? oversized.length) <= 0) return;
  const files = oversized
    // Sanitise the disk-sourced path before it reaches the log line, then
    // hand it to the shared `path (size)` formatter so serve renders the
    // same atom as `sm scan` / `sm watch`.
    .map((f) => formatOversizedFilePair({ path: sanitizeForTerminal(f.path), bytes: f.bytes }))
    .join(', ');
  log.warn(
    tx(SERVER_TEXTS.watcherFilesOversized, {
      count: String(oversized.length),
      files,
    }),
  );
}

/**
 * Bridge the kernel's `ProgressEmitterPort` to the broadcaster. Every
 * event the orchestrator emits during a batch (scan.started,
 * scan.progress, extractor.completed, analyzer.completed, scan.completed,
 * extension.error) flows verbatim to every connected `/ws` client.
 *
 * The orchestrator never calls `subscribe()`, it only emits, so the
 * subscribe/unsubscribe slot is a no-op pair.
 */
export function buildBroadcasterEmitter(broadcaster: WsBroadcaster): ProgressEmitterPort {
  return {
    emit(event): void {
      broadcaster.broadcast(event);
    },
    subscribe(): () => void {
      return () => {
        // intentionally empty
      };
    },
  };
}
