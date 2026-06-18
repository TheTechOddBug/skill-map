/**
 * `createServer(opts)`, composition root for the Hono BFF.
 *
 * Returns a `IServerHandle` exposing the actual bound address (port 0 →
 * OS-assigned, so the caller reads the real port from
 * `handle.address.port`) and an idempotent `close()` for graceful
 * shutdown.
 *
 * Wiring (Step 14.4.a):
 *
 *   1. Resolve the spec version once (async, `import('@skill-map/spec')`).
 *   2. Instantiate the `WsBroadcaster`, a fresh one per server.
 *   3. Build the Hono app via `createApp(deps)`, that's the only place
 *      that knows about routes / middleware / error handlers. The
 *      broadcaster flows through `IAppDeps` so `attachBroadcasterRoute`
 *      can register `/ws` against it.
 *   4. Instantiate a `WebSocketServer({ noServer: true })` (the
 *      `noServer: true` flag is mandatory, node-server `serve()`
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
 *   1. `heartbeat.stop()`, stop the keep-alive ping loop so no ping
 *      races the shutdown close frames.
 *   2. `watcherService.stop()`, drains the in-flight scan batch
 *      cleanly so chokidar is not torn down mid-`runScan`.
 *   3. `broadcaster.shutdown()`, closes every connected WS client
 *      with code 1001 ('going away').
 *   4. `closeServer(server)`, closes the http listener.
 *   5. `wss.close()`, defensive belt-and-suspenders since node-server
 *      auto-wires `server.on('close', () => wss.close())`.
 *
 * The server NEVER reads `process.env` / `process.cwd()` directly,
 * the CLI verb (`cli/commands/serve.ts`) is the only place that does
 * that. This keeps the BFF reusable from a future test harness that
 * boots it directly with a synthetic `IServerOptions`.
 */

import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';

import {
  emptyPluginRuntime,
  loadPluginRuntime,
  type IPluginRuntime,
} from '../core/runtime/plugin-runtime.js';
import { builtInPlugins, builtIns } from '../plugins/built-ins.js';
import { defaultRuntimeContext, type IRuntimeContext } from '../core/runtime/runtime-context.js';
import { collectViewContributions } from '../kernel/extensions/index.js';
import type { IProvider } from '../kernel/extensions/index.js';
import { createKernel, type IRegisteredViewContribution, type Kernel } from '../kernel/index.js';
import { formatErrorMessage } from '../kernel/util/format-error.js';
import { log } from '../kernel/util/logger.js';
import { sanitizeForTerminal } from '../kernel/util/safe-text.js';
import { tx } from '../kernel/util/tx.js';
import { createApp } from './app.js';
import { WsBroadcaster } from './broadcaster.js';
import { startWsHeartbeat } from './heartbeat.js';
import { resolveSpecVersion } from './health.js';
import { SERVER_TEXTS } from './i18n/server.texts.js';
import { buildKindRegistry } from './kind-registry.js';
import { buildProviderRegistry } from './provider-registry.js';
import { buildContributionsRegistry } from './contributions-registry.js';
import type { IServerOptions } from './options.js';
import {
  createWatcherService,
  type IWatcherServiceHandle,
  type IWatcherServiceHolder,
} from './watcher.js';

export type { IServerOptions, IServerOptionsInput } from './options.js';
export { validateServerOptions, isLoopbackHost } from './options.js';
export { resolveDefaultUiDist, resolveExplicitUiDist, isUiBundleDir } from './paths.js';
export type { IHealthResponse, THealthDbState } from './health.js';
export type { IErrorEnvelope, TErrorCode } from './app.js';
export { DbMissingError, BulkValidationError, LoopbackGateError } from './app.js';
export { WsBroadcaster, WS_BACKPRESSURE_BYTES, type IBroadcasterClient } from './broadcaster.js';
export { startWsHeartbeat, WS_HEARTBEAT_INTERVAL_MS, type IWsHeartbeatHandle } from './heartbeat.js';
export { createWatcherService, type IWatcherServiceHandle } from './watcher.js';

export interface IServerAddress {
  host: string;
  port: number;
  family: string;
}

export interface IServerHandle {
  /** Address the listener actually bound to. `port` is the resolved value when `options.port === 0`. */
  address: IServerAddress;
  /** Graceful shutdown. Idempotent, calling twice resolves immediately on the second call. */
  close(): Promise<void>;
  /**
   * The active broadcaster, exposed for tests that want to assert
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
): Promise<IServerHandle> {
  const specVersion = await resolveSpecVersion();
  const runtimeContext = extra.runtimeContext ?? defaultRuntimeContext();
  const broadcaster = new WsBroadcaster();
  const { pluginRuntime, kindRegistry, providerRegistry, providers } =
    await assemblePluginRuntime(options, runtimeContext);
  const { kernel, contributionsRegistry } = assembleKernel(pluginRuntime, options.noBuiltIns);

  // Holder is created BEFORE `createApp` so route deps can capture a
  // stable reference. `current` is populated below once the watcher
  // boots; routes guard on null (matches the `--no-watcher` path).
  const watcherHolder: IWatcherServiceHolder = { current: null };

  const app = createApp({
    options,
    specVersion,
    broadcaster,
    runtimeContext,
    kindRegistry,
    providerRegistry,
    providers,
    contributionsRegistry,
    pluginRuntime,
    watcherHolder,
    kernel,
  });

  // `noServer: true` is mandatory, node-server's `setupWebSocket` throws
  // ("WebSocket server must be created with { noServer: true } option")
  // otherwise. node-server owns the http `'upgrade'` listener and runs
  // upgrades through the Hono fetch pipeline; the WSS only handles the
  // post-handshake socket lifecycle.
  const wss = new WebSocketServer({ noServer: true });
  const server = await listenAsync(app.fetch, wss, options.host, options.port);

  // Transport-level keep-alive (see heartbeat.ts): periodic ping frames
  // keep idle `/ws` connections from being dropped by an intermediary
  // proxy, and reap half-open peers that stop ponging. Started after the
  // listener is bound; `wss.clients` is populated by node-server's
  // upgrade handler, and the timer is `unref`-ed so it never holds the
  // process open on its own.
  const heartbeat = startWsHeartbeat(wss);

  const addr = server.address();
  const address = normalizeAddress(addr, options.host, options.port);

  // Watcher boot, defaults on (Decision #121). On boot failure, log +
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
      watcherHolder.current = candidate;
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
    // Order matters, see file header §close().
    heartbeat.stop();
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
 * `listeningListener` callback, but it doesn't surface bind errors,
 * we wire `'error'` ourselves so a port-in-use rejects cleanly instead
 * of leaking an unhandled error event.
 */
/**
 * Step 14.5.d / audit M3: load the plugin runtime ONCE at boot and
 * resolve the kindRegistry from every enabled Provider. Pairs with
 * `assembleKernel` to make up the boot pipeline, split because the
 * two halves have distinct concerns (what plugins exist vs. what the
 * kernel exposes to routes), and each is independently testable.
 *
 * Pre-M3 each of `/api/graph`, `/api/plugins`, `/api/scan?fresh=1` ran
 * the same FS walk + DB read + AJV compile per request. Cached here
 * once: an operator that installs a new plugin restarts `sm serve`,
 * matching the watcher's documented "loaded ONCE at watcher boot"
 * contract (`server/watcher.ts: createWatcherService` docstring) so
 * the BFF's plugin view never diverges from the watcher's.
 *
 * Plugin warnings are logged here once; the routes don't re-log them
 * (they used to, on every request, same warning twice, three times,
 * N times under load).
 */
async function assemblePluginRuntime(
  options: IServerOptions,
  runtimeContext: IRuntimeContext,
): Promise<{
  pluginRuntime: IPluginRuntime;
  kindRegistry: ReturnType<typeof buildKindRegistry>;
  providerRegistry: ReturnType<typeof buildProviderRegistry>;
  providers: IProvider[];
}> {
  // R14, thread the boot-time runtime context through to
  // `loadPluginRuntime` so plugin discovery walks the same `cwd`
  // the rest of the BFF resolves against. Without this the loader
  // silently falls back to `defaultRuntimeContext()` (which reads
  // `process.cwd()`) and the override on `IAppDeps.runtimeContext`
  // is ignored for plugin discovery + plugin-config layering.
  const pluginRuntime = options.noPlugins
    ? emptyPluginRuntime()
    : await loadPluginRuntime({ runtimeContext });
  // Surface plugin-load warnings ONCE at boot. When the watcher runs
  // (the default), its initial scan (`runInitialBatch`) re-loads the
  // plugins and surfaces the identical warnings via `onPluginWarning`,
  // so printing them here too would double every warning at startup.
  // Only print here when no watcher will run (`--no-watcher`), where
  // this is the sole surfacing point.
  if (options.noWatcher) {
    for (const warn of pluginRuntime.warnings) {
      log.warn(sanitizeForTerminal(warn));
    }
  }
  // The kindRegistry embeds in every envelope and is CACHED at boot.
  // It must include EVERY built-in's declarations regardless of the
  // current enabled state, a user that re-enables a built-in
  // mid-session expects its kinds and icons to render on the next
  // scan, and that only works when the registry already knew about
  // them. Built-in handlers are always in memory (statically imported
  // via `built-ins.ts`), so registering them unconditionally
  // is safe; the enabled/disabled axis is enforced at SCAN-TIME by
  // `composeScanExtensions` reading the fresh resolver, not by hiding
  // them from the registry.
  //
  // Drop-in user plugins are different: a plugin that started
  // `disabled` was never module-imported, so its declarations are not
  // available to register. Re-enabling those needs `sm serve` restart
  // (the `startsAsDisabled` exception documented in
  // `cli-contract.md §PATCH /api/plugins`).
  const builtInProviders = options.noBuiltIns ? [] : collectBuiltInProviders();
  const allProviders = [...builtInProviders, ...pluginRuntime.extensions.providers];
  const kindRegistry = buildKindRegistry(allProviders);
  // Sibling of `kindRegistry`, same boot-time discipline: every
  // registered Provider's identity, embedded into every payload-bearing
  // envelope so the UI renders lens / chip surfaces from the real set.
  const providerRegistry = buildProviderRegistry(allProviders);
  // The raw provider list is also threaded to routes for active-lens
  // auto-detection (`detect.markers` lives on the manifest, not on the
  // wire `providerRegistry`).
  return { pluginRuntime, kindRegistry, providerRegistry, providers: allProviders };
}

/**
 * Instantiate a kernel at boot, stamp it with the runtime annotation +
 * view-contribution catalogs harvested from `pluginRuntime` (user
 * plugins) and `builtInPlugins` (built-ins), then pre-build the
 * BFF-side `contributionsRegistry` that routes embed in every
 * payload-bearing envelope (sibling to `kindRegistry`).
 *
 * Step 9.6.6 / Phase 3, the BFF's read-side routes are pure
 * projections of plugin-time discovery, so a single kernel populated
 * here matches the "loaded ONCE at boot" watcher contract: an
 * operator that installs a new plugin restarts `sm serve`. Routes
 * that need the catalogs read them off this kernel via closure.
 *
 * `pluginRuntime.viewContributions` is collected only from USER
 * plugins (via `bucketLoaded`); built-in plugins never traverse that
 * path, so their declared `viewContributions` would otherwise be
 * invisible to the kernel catalog. Walk every built-in extension
 * here (NOT filtered by the boot-time resolver, see the registry
 * discipline rationale on `assemblePluginRuntime`) and harvest every
 * declared contribution into the merged catalog via the shared
 * `collectViewContributions` helper.
 */
function assembleKernel(
  pluginRuntime: IPluginRuntime,
  noBuiltIns: boolean,
): {
  kernel: Kernel;
  contributionsRegistry: ReturnType<typeof buildContributionsRegistry>;
} {
  const kernel = createKernel();
  kernel.setRegisteredAnnotationKeys(pluginRuntime.annotationContributions);

  // Step 17, register built-in Action manifests into the kernel
  // registry so `POST /api/actions/:id` can resolve them by qualified
  // id (`registry.get('action', 'core/node-bump')`). `builtIns().actions`
  // returns the full `IAction[]` (stamped with `pluginId` + `version`,
  // `invoke` intact), unlike `listBuiltIns()` which projects to the base
  // `IExtension` row and drops `invoke`. Skipped under `--no-built-ins`
  // (the dispatch route then 404s every id, matching the scan pipeline's
  // built-ins-off behaviour). User-plugin actions are NOT surfaced by the
  // runtime bucket today (`IPluginRuntime.extensions` has no `actions`
  // bucket), so only built-in actions are dispatchable over this route at
  // this step; that is sufficient for `core/node-bump` (Phase D's bump
  // migration).
  if (!noBuiltIns) {
    for (const action of builtIns().actions) {
      kernel.registry.register(action);
    }
  }

  const mergedViewContributions: IRegisteredViewContribution[] = [...pluginRuntime.viewContributions];
  if (!noBuiltIns) {
    const userKey = new Set(
      mergedViewContributions.map(
        (c) => `${c.pluginId}/${c.extensionId}/${c.contributionId}`,
      ),
    );
    for (const plugin of builtInPlugins) {
      for (const ext of plugin.extensions) {
        collectViewContributions(ext.pluginId, ext.id, ext, mergedViewContributions, {
          excludeQualifiedIds: userKey,
        });
      }
    }
  }
  kernel.setRegisteredViewContributions(mergedViewContributions);
  const contributionsRegistry = buildContributionsRegistry(kernel);
  return { kernel, contributionsRegistry };
}

/**
 * Build the built-ins-only contributions registry (no user plugins).
 *
 * Reuses the same `assembleKernel` path the live server boots through,
 * so the catalog never drifts from what `/api/contributions/registered`
 * would serve for a built-ins-only scope. Consumed by the demo dataset
 * build (`web/scripts/build-demo-dataset.js`), which scans the demo
 * fixture with `--no-plugins` and needs the registry to render the
 * view-contribution slot icons / labels (the per-node contribution
 * VALUES are embedded from the scan DB, but the ICON / LABEL come from
 * this registry). Pure: no I/O, no kernel side-effects beyond the local
 * instance assembled here.
 */
export function buildBuiltInContributionsRegistry(): ReturnType<typeof buildContributionsRegistry> {
  return assembleKernel(emptyPluginRuntime(), false).contributionsRegistry;
}

/**
 * Collect every built-in `IProvider` instance regardless of the
 * boot-time resolver verdict. Used by `assemblePluginRuntime` to seed
 * the `kindRegistry` so re-enabling a built-in mid-session paints
 * its kinds correctly on the next scan. Type assertion is safe by
 * construction (`built-ins.ts` keeps `kind === 'provider'` entries
 * shaped as `IProvider`).
 */
function collectBuiltInProviders(): IProvider[] {
  const out: IProvider[] = [];
  for (const plugin of builtInPlugins) {
    for (const ext of plugin.extensions) {
      if (ext.kind === 'provider') {
        out.push(ext as IProvider);
      }
    }
  }
  return out;
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
        // Detach the bind-time error listener, operational errors
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
