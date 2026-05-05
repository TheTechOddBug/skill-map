/**
 * `createServer(opts)` — composition root for the Hono BFF.
 *
 * Returns a `ServerHandle` exposing the actual bound address (port 0 →
 * OS-assigned, so the caller reads the real port from
 * `handle.address.port`) and an idempotent `close()` for graceful
 * shutdown.
 *
 * Wiring (Step 14.4.a):
 *
 *   1. Resolve the spec version once (async — `import('@skill-map/spec')`).
 *   2. Instantiate the `WsBroadcaster` — a fresh one per server.
 *   3. Build the Hono app via `createApp(deps)` — that's the only place
 *      that knows about routes / middleware / error handlers. The
 *      broadcaster flows through `IAppDeps` so `attachBroadcasterRoute`
 *      can register `/ws` against it.
 *   4. Instantiate a `WebSocketServer({ noServer: true })` (the
 *      `noServer: true` flag is mandatory — node-server `serve()`
 *      throws if it isn't set; node-server owns the http `'upgrade'`
 *      listener and routes upgrades through Hono).
 *   5. Hand `app.fetch` + `{ websocket: { server: wss } }` to
 *      `@hono/node-server`'s `serve()` to get a Node `http.Server`
 *      bound on `host:port`.
 *   6. Unless `--no-watcher` is set, instantiate a `WatcherService`
 *      (chokidar-fed scan loop) and `start()` it. The watcher
 *      broadcasts `scan.*` events through the same broadcaster the
 *      `/ws` route is registered against.
 *
 * `close()` shutdown order is intentional:
 *   1. `watcherService.stop()` — drains the in-flight scan batch
 *      cleanly so chokidar is not torn down mid-`runScan`.
 *   2. `broadcaster.shutdown()` — closes every connected WS client
 *      with code 1001 ('going away').
 *   3. `closeServer(server)` — closes the http listener.
 *   4. `wss.close()` — defensive belt-and-suspenders since node-server
 *      auto-wires `server.on('close', () => wss.close())`.
 *
 * The server NEVER reads `process.env` / `process.cwd()` / `homedir()` —
 * the CLI verb (`cli/commands/serve.ts`) is the only place that does
 * that. This keeps the BFF reusable from a future test harness that
 * boots it directly with a synthetic `IServerOptions`.
 */

import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';

import {
  composeScanExtensions,
  emptyPluginRuntime,
  loadPluginRuntime,
  type IPluginRuntimeBundle,
} from '../core/runtime/plugin-runtime.js';
import { defaultRuntimeContext, type IRuntimeContext } from '../core/runtime/runtime-context.js';
import { formatErrorMessage } from '../kernel/util/format-error.js';
import { log } from '../kernel/util/logger.js';
import { sanitizeForTerminal } from '../kernel/util/safe-text.js';
import { tx } from '../kernel/util/tx.js';
import { createApp } from './app.js';
import { WsBroadcaster } from './broadcaster.js';
import { resolveSpecVersion } from './health.js';
import { SERVER_TEXTS } from './i18n/server.texts.js';
import { buildKindRegistry } from './kind-registry.js';
import type { IServerOptions } from './options.js';
import { createWatcherService, type IWatcherServiceHandle } from './watcher.js';

export type { IServerOptions, IServerOptionsInput, TServerScope } from './options.js';
export { validateServerOptions, isLoopbackHost } from './options.js';
export { resolveDefaultUiDist, resolveExplicitUiDist, isUiBundleDir } from './paths.js';
export type { IHealthResponse, THealthDbState } from './health.js';
export type { IErrorEnvelope, TErrorCode } from './app.js';
export { WsBroadcaster, WS_BACKPRESSURE_BYTES, type IBroadcasterClient } from './broadcaster.js';
export { createWatcherService, type IWatcherServiceHandle } from './watcher.js';

export interface IServerAddress {
  host: string;
  port: number;
  family: string;
}

export interface ServerHandle {
  /** Address the listener actually bound to. `port` is the resolved value when `options.port === 0`. */
  address: IServerAddress;
  /** Graceful shutdown. Idempotent — calling twice resolves immediately on the second call. */
  close(): Promise<void>;
  /**
   * The active broadcaster — exposed for tests that want to assert
   * `clientCount` / inject a synthetic event without touching internal
   * state. Production callers should not need this.
   */
  broadcaster: WsBroadcaster;
}

export interface ICreateServerOpts {
  /**
   * Optional runtime context override. Tests inject a tempdir cwd so
   * `loadConfig` / fresh-scan can be exercised against a controlled
   * scope. Production callers (the `sm serve` verb) leave it
   * undefined; the composition root falls back to
   * `defaultRuntimeContext()`.
   */
  runtimeContext?: IRuntimeContext;
}

export async function createServer(
  options: IServerOptions,
  extra: ICreateServerOpts = {},
): Promise<ServerHandle> {
  const specVersion = await resolveSpecVersion();
  const runtimeContext = extra.runtimeContext ?? defaultRuntimeContext();
  const broadcaster = new WsBroadcaster();
  const { pluginRuntime, kindRegistry } = await assembleBootBundle(options);

  const app = createApp({
    options,
    specVersion,
    broadcaster,
    runtimeContext,
    kindRegistry,
    pluginRuntime,
  });

  // `noServer: true` is mandatory — node-server's `setupWebSocket` throws
  // ("WebSocket server must be created with { noServer: true } option")
  // otherwise. node-server owns the http `'upgrade'` listener and runs
  // upgrades through the Hono fetch pipeline; the WSS only handles the
  // post-handshake socket lifecycle.
  const wss = new WebSocketServer({ noServer: true });
  const server = await listenAsync(app.fetch, wss, options.host, options.port);

  const addr = server.address();
  const address = normalizeAddress(addr, options.host, options.port);

  // Watcher boot — defaults on (Decision #121). On boot failure, log +
  // continue serving (the REST surface stays alive; the operator sees
  // the warning and can disable the watcher with --no-watcher to
  // continue work on the broken setup).
  let watcherService: IWatcherServiceHandle | null = null;
  if (!options.noWatcher) {
    const debounce = options.watcherDebounceMs;
    const svcOpts: Parameters<typeof createWatcherService>[0] = {
      options,
      runtimeContext,
      broadcaster,
    };
    if (debounce !== undefined) svcOpts.debounceMsOverride = debounce;
    const candidate = createWatcherService(svcOpts);
    try {
      await candidate.start();
      watcherService = candidate;
    } catch (err) {
      const message = formatErrorMessage(err);
      log.warn(
        tx(SERVER_TEXTS.watcherBootFailed, {
          message: sanitizeForTerminal(message),
        }),
      );
      // Best-effort cleanup of the partially-started watcher (chokidar
      // may have subscribed to roots even if the post-ready broadcast
      // threw).
      try {
        await candidate.stop();
      } catch {
        // ignore
      }
    }
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    // Order matters — see file header §close().
    if (watcherService) {
      try {
        await watcherService.stop();
      } catch {
        // already logged inside stop()
      }
    }
    broadcaster.shutdown();
    await closeServer(server);
    wss.close();
  };

  return { address, close, broadcaster };
}

/**
 * Wrap `@hono/node-server`'s `serve(...)` in a promise that resolves
 * once the listener is actually bound. The base helper invokes the
 * `listeningListener` callback, but it doesn't surface bind errors —
 * we wire `'error'` ourselves so a port-in-use rejects cleanly instead
 * of leaking an unhandled error event.
 */
/**
 * Step 14.5.d / audit M3: load the plugin runtime ONCE at boot and
 * derive both (a) the cached bundle that every read-side route reuses
 * and (b) the kindRegistry assembled from every enabled Provider.
 *
 * Pre-M3 each of `/api/graph`, `/api/plugins`, `/api/scan?fresh=1` ran
 * the same FS walk + DB read + AJV compile per request. Cached here
 * once: an operator that installs a new plugin restarts `sm serve` —
 * matching the watcher's documented "loaded ONCE at watcher boot"
 * contract (`server/watcher.ts: createWatcherService` docstring) so
 * the BFF's plugin view never diverges from the watcher's.
 *
 * Plugin warnings are logged here once; the routes don't re-log them
 * (they used to, on every request — same warning twice, three times,
 * N times under load).
 */
async function assembleBootBundle(
  options: IServerOptions,
): Promise<{ pluginRuntime: IPluginRuntimeBundle; kindRegistry: ReturnType<typeof buildKindRegistry> }> {
  const pluginRuntime = options.noPlugins
    ? emptyPluginRuntime()
    : await loadPluginRuntime({ scope: options.scope });
  for (const warn of pluginRuntime.warnings) {
    log.warn(sanitizeForTerminal(warn));
  }
  const composed = composeScanExtensions({
    noBuiltIns: options.noBuiltIns,
    pluginRuntime,
  });
  const kindRegistry = buildKindRegistry(composed?.providers ?? []);
  return { pluginRuntime, kindRegistry };
}

function listenAsync(
  fetchCallback: (req: Request) => Response | Promise<Response>,
  wss: WebSocketServer,
  host: string,
  port: number,
): Promise<Server> {
  return new Promise<Server>((resolveListen, rejectListen) => {
    let settled = false;
    const server = serve(
      {
        fetch: fetchCallback,
        hostname: host,
        port,
        websocket: { server: wss },
      },
      () => {
        if (settled) return;
        settled = true;
        // Detach the bind-time error listener — operational errors
        // after bind reach the request pipeline through `app.onError`,
        // not here.
        server.removeListener('error', onBindError);
        resolveListen(server);
      },
    ) as Server;

    const onBindError = (err: Error): void => {
      if (settled) return;
      settled = true;
      rejectListen(err);
    };
    server.once('error', onBindError);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolveClose, rejectClose) => {
    // `server.close()` waits for in-flight connections to settle. The
    // `closeAllConnections` call after it forces idle keep-alives to
    // drop so tests don't hang on the SPA's keep-alive pool.
    server.close((err) => {
      if (err) {
        rejectClose(err);
      } else {
        resolveClose();
      }
    });
    server.closeAllConnections?.();
  });
}

function normalizeAddress(addr: AddressInfo | string | null, fallbackHost: string, fallbackPort: number): IServerAddress {
  if (addr === null || typeof addr === 'string') {
    return { host: fallbackHost, port: fallbackPort, family: 'IPv4' };
  }
  return { host: addr.address, port: addr.port, family: addr.family };
}
