/**
 * `WatcherService` — chokidar-fed scan loop that broadcasts kernel events
 * over `/ws`. The BFF parallel of `src/cli/commands/watch.ts:runWatchLoop`,
 * now a thin adapter over the shared `core/watcher/runtime.ts`.
 *
 * Per Decision #121: each debounced batch runs `runScanWithRenames` +
 * `persistScanResult`. A read-only watcher was rejected — a server with
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
 * `scan.failed` envelopes — Step 14.4.b will define that shape; today
 * we log and let the broadcaster stay alive.
 *
 * On chokidar's own error (rare — bad watch root, EMFILE): log +
 * broadcast a `watcher.error` advisory event. The watcher itself
 * stays open per `IFsWatcher`'s contract.
 */

import type { ProgressEmitterPort } from '../kernel/ports/progress-emitter.js';
import { log } from '../kernel/util/logger.js';
import { sanitizeForTerminal } from '../kernel/util/safe-text.js';
import { tx } from '../kernel/util/tx.js';
import type { IRuntimeContext } from '../core/runtime/runtime-context.js';
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
   * are per-batch and logged (never thrown — the broadcaster stays up).
   */
  start(): Promise<void>;
  /**
   * Gracefully tear down the watcher: stop accepting new batches, drain
   * the in-flight batch (if any), close chokidar handles. Idempotent —
   * a second call resolves immediately.
   */
  stop(): Promise<void>;
}

const WATCH_ROOT = '.';

/**
 * Construct a watcher service. Pure factory — every dependency comes
 * through the options bag. The caller (`createServer`) wires the
 * broadcaster and runtime context at composition time.
 *
 * Mirrors the CLI's `loadPluginRuntime({ scope: 'project' })` semantics:
 * plugins are loaded ONCE at watcher boot and reused across every
 * batch. Hot-reload of plugin code requires restarting the server
 * (same trade-off as `sm watch`; see Step 9.1 §note).
 */
export function createWatcherService(opts: ICreateWatcherServiceOpts): IWatcherServiceHandle {
  const runtimeOpts: ICreateWatcherRuntimeOpts = {
    dbPath: opts.options.dbPath,
    scope: opts.options.scope,
    roots: [WATCH_ROOT],
    runtimeContext: opts.runtimeContext,
    noBuiltIns: opts.options.noBuiltIns,
    noPlugins: opts.options.noPlugins,
    emitterFactory: () => buildBroadcasterEmitter(opts.broadcaster),
    runInitialBatch: true,
    // BFF ordering: subscribe first so edits arriving during the initial
    // scan queue against the armed chokidar and fire a follow-up batch.
    subscribeBeforeInitial: true,
    failOnInitialBatchError: false,
    events: {
      onBatch: (outcome) => {
        if (outcome.kind === 'error') {
          // TODO(14.4.b / 14.5): emit `scan.failed` event once the
          // shape is locked in spec/job-events.md. For 14.4.a we log
          // and continue — a transient FS error must NOT kill the
          // broadcaster.
          log.warn(
            tx(SERVER_TEXTS.watcherBatchFailed, {
              message: sanitizeForTerminal(outcome.message),
            }),
          );
        }
      },
      onWatcherError: (message) => {
        // chokidar transport-level error — log + broadcast advisory
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
        // verbatim. Boot-time — too early for any client to be
        // listening; no advisory broadcast.
        log.warn(sanitizeForTerminal(message));
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

  const handle = createWatcherRuntime(runtimeOpts);

  return {
    start: handle.start,
    stop: handle.stop,
  };
}

/**
 * Bridge the kernel's `ProgressEmitterPort` to the broadcaster. Every
 * event the orchestrator emits during a batch (scan.started,
 * scan.progress, extractor.completed, rule.completed, scan.completed,
 * extension.error) flows verbatim to every connected `/ws` client.
 *
 * The orchestrator never calls `subscribe()` — it only emits — so the
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
