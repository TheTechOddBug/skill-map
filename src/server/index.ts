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
  emptyPluginRuntime,
  loadPluginRuntime,
  type IPluginRuntimeBundle,
} from '../core/runtime/plugin-runtime.js';
import { builtInBundles } from '../built-in-plugins/built-ins.js';
import { defaultRuntimeContext, type IRuntimeContext } from '../core/runtime/runtime-context.js';
import { createKernel, type Kernel } from '../kernel/index.js';
import { formatErrorMessage } from '../kernel/util/format-error.js';
import { log } from '../kernel/util/logger.js';
import { sanitizeForTerminal } from '../kernel/util/safe-text.js';
import { tx } from '../kernel/util/tx.js';
import { createApp } from './app.js';
import { WsBroadcaster } from './broadcaster.js';
import { resolveSpecVersion } from './health.js';
import { SERVER_TEXTS } from './i18n/server.texts.js';
import { buildKindRegistry } from './kind-registry.js';
import { buildContributionsRegistry } from './contributions-registry.js';
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
  const { pluginRuntime, kindRegistry, contributionsRegistry, kernel } = await assembleBootBundle(
    options,
    runtimeContext,
  );

  const app = createApp({
    options,
    specVersion,
    broadcaster,
    runtimeContext,
    kindRegistry,
    contributionsRegistry,
    pluginRuntime,
    kernel,
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
  runtimeContext: IRuntimeContext,
): Promise<{
  pluginRuntime: IPluginRuntimeBundle;
  kindRegistry: ReturnType<typeof buildKindRegistry>;
  contributionsRegistry: ReturnType<typeof buildContributionsRegistry>;
  kernel: Kernel;
}> {
  // R14 — thread the boot-time runtime context through to
  // `loadPluginRuntime` so plugin discovery walks the same `cwd` /
  // `homedir` the rest of the BFF resolves against. Without this the
  // loader silently falls back to `defaultRuntimeContext()` (which
  // reads `process.cwd()`) and the override on `IAppDeps.runtimeContext`
  // is ignored for plugin discovery + plugin-config layering.
  const pluginRuntime = options.noPlugins
    ? emptyPluginRuntime()
    : await loadPluginRuntime({ scope: options.scope, runtimeContext });
  for (const warn of pluginRuntime.warnings) {
    log.warn(sanitizeForTerminal(warn));
  }
  // The registries (kindRegistry / contributionsRegistry) embed in
  // every envelope and are CACHED at boot. They must include EVERY
  // built-in's declarations regardless of the current enabled state —
  // a user that re-enables a built-in mid-session expects its kinds
  // and icons to render on the next scan, and that only works when
  // the registry already knew about them. Built-in handlers are
  // always in memory (statically imported via `built-in-bundles.ts`),
  // so registering them unconditionally is safe; the enabled/disabled
  // axis is enforced at SCAN-TIME by `composeScanExtensions` reading
  // the fresh resolver, not by hiding them from the registry.
  //
  // Drop-in user plugins are different: a plugin that started
  // `disabled` was never module-imported, so its declarations are not
  // available to register. Re-enabling those needs `sm serve` restart
  // (the `startsAsDisabled` exception documented in
  // `cli-contract.md §PATCH /api/plugins`).
  const builtInProviders = options.noBuiltIns ? [] : collectBuiltInProviders();
  const kindRegistry = buildKindRegistry([
    ...builtInProviders,
    ...pluginRuntime.extensions.providers,
  ]);
  // Step 9.6.6 — instantiate a kernel at boot and stamp the runtime
  // annotation catalog onto it. The BFF's read-side routes are pure
  // projections of plugin-time discovery, so a single kernel populated
  // here matches the "loaded ONCE at boot" watcher contract: an
  // operator that installs a new plugin restarts `sm serve`. Routes
  // that need the catalog (`GET /api/annotations/registered`) read it
  // off this kernel via closure.
  const kernel = createKernel();
  kernel.setRegisteredAnnotationKeys(pluginRuntime.annotationContributions);
  // Phase 3 / View contribution system — stamp the runtime
  // view-contributions catalog on the kernel and pre-build the
  // BFF-side registry. Routes embed `contributionsRegistry` in
  // every payload-bearing envelope (sibling to `kindRegistry`).
  //
  // `pluginRuntime.viewContributions` is collected only from USER
  // plugins (via `bucketLoaded`); built-in bundles never traverse
  // that path, so their declared `viewContributions` would otherwise
  // be invisible to the kernel catalog. Walk every built-in extension
  // (NOT filtered by the boot-time resolver — see the registry
  // discipline rationale above) and harvest every declared
  // contribution into the merged catalog.
  const mergedViewContributions = mergeBuiltInViewContributions(
    pluginRuntime.viewContributions,
    options.noBuiltIns,
  );
  kernel.setRegisteredViewContributions(mergedViewContributions);
  const contributionsRegistry = buildContributionsRegistry(kernel);
  return { pluginRuntime, kindRegistry, contributionsRegistry, kernel };
}

/**
 * Collect every built-in `IProvider` instance regardless of the
 * boot-time resolver verdict. Used by `assembleBootBundle` to seed
 * the `kindRegistry` so re-enabling a built-in mid-session paints
 * its kinds correctly on the next scan. Type assertion is safe by
 * construction (`built-ins.ts` keeps `kind === 'provider'` entries
 * shaped as `IProvider`).
 */
function collectBuiltInProviders(): import('../kernel/extensions/index.js').IProvider[] {
  const out: import('../kernel/extensions/index.js').IProvider[] = [];
  for (const bundle of builtInBundles) {
    for (const ext of bundle.extensions) {
      if (ext.kind === 'provider') {
        out.push(ext as import('../kernel/extensions/index.js').IProvider);
      }
    }
  }
  return out;
}

/**
 * Walk every built-in extension and harvest declared
 * `viewContributions` from any extension that is NOT already in the
 * user-plugin catalog (`pluginRuntime.viewContributions`). This is
 * how built-in bundles' declared contributions land on the kernel
 * catalog without forcing every consumer of `composeScanExtensions`
 * to re-run the user-plugin path. The boot-time resolver verdict is
 * intentionally NOT consulted here — see `assembleBootBundle` for
 * the rationale (mid-session re-enable would otherwise leave kinds
 * and footer icons unrenderable).
 */
// Complexity counts the type-guard chain on each contribution's
// optional fields (label, tooltip, icon, emptyText, emitWhenEmpty)
// plus the per-extension nested loop. Splitting the per-field
// hydration into a helper would scatter the projection without
// making the algorithm clearer.
// eslint-disable-next-line complexity
function mergeBuiltInViewContributions(
  userPluginContributions: readonly import('../kernel/index.js').IRegisteredViewContribution[],
  noBuiltIns: boolean,
): import('../kernel/index.js').IRegisteredViewContribution[] {
  const merged = [...userPluginContributions];
  if (noBuiltIns) return merged;
  const userKey = new Set(
    userPluginContributions.map(
      (c) => `${c.pluginId}/${c.extensionId}/${c.contributionId}`,
    ),
  );
  // Walk every built-in extension — extractors + analyzers carry
  // `viewContributions` per `IExtensionBase`. We DELIBERATELY ignore
  // the boot-time resolver verdict here: the registry must list every
  // built-in declaration so a mid-session re-enable surfaces correctly
  // (the scan composer's fresh resolver still gates execution). See
  // `assembleBootBundle` for the rationale.
  for (const bundle of builtInBundles) {
    for (const ext of bundle.extensions) {
      if (ext.kind !== 'extractor' && ext.kind !== 'analyzer') continue;
      const raw = (ext as { viewContributions?: unknown }).viewContributions;
      if (typeof raw !== 'object' || raw === null) continue;
      for (const [contributionId, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value !== 'object' || value === null) continue;
        const v = value as { slot?: unknown; label?: unknown; tooltip?: unknown; icon?: unknown; emptyText?: unknown; emitWhenEmpty?: unknown };
        if (typeof v.slot !== 'string') continue;
        const qualified = `${ext.pluginId}/${ext.id}/${contributionId}`;
        if (userKey.has(qualified)) continue;
        const entry: import('../kernel/index.js').IRegisteredViewContribution = {
          pluginId: ext.pluginId,
          extensionId: ext.id,
          contributionId,
          slot: v.slot as never,
          emitWhenEmpty: v.emitWhenEmpty === true,
        };
        if (typeof v.label === 'string') entry.label = v.label;
        if (typeof v.tooltip === 'string') entry.tooltip = v.tooltip;
        if (typeof v.icon === 'string') entry.icon = v.icon;
        if (typeof v.emptyText === 'string') entry.emptyText = v.emptyText;
        merged.push(entry);
      }
    }
  }
  return merged;
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
