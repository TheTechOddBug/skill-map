/**
 * Shared deps bag for the per-route registrars under `routes/`.
 *
 * Every read-side route opens the DB on demand via `tryWithSqlite` /
 * `withSqlite`. Per-request open / close is what the CLI does too, a
 * persistent adapter would shave a few ms per request but introduces
 * lock contention that's not worth it before any real load lands.
 *
 * The `runtimeContext` field is mandatory because `loadConfig` and the
 * fresh-scan path both need a `cwd` (the kernel never reads
 * `process.*` itself). The composition root threads it from
 * `defaultRuntimeContext()` at boot.
 */

import type { IProvider } from '../../kernel/extensions/index.js';
import type { ConfigService } from '../../core/config/service.js';
import type { IPluginRuntimeBundle } from '../../core/runtime/plugin-runtime.js';
import type { IRuntimeContext } from '../../core/runtime/runtime-context.js';
import type { TContributionsRegistry, TKindRegistry, TProviderRegistry } from '../envelope.js';
import type { IServerOptions } from '../options.js';
import type { IWatcherServiceHolder } from '../watcher.js';

/**
 * Overlaps heavily with `IAppDeps` in `server/app.ts`, every field
 * below is also present in the composition-root bag. `createApp`
 * repacks `IAppDeps` into `IRouteDeps` at the seam (adding
 * `configService`, dropping `specVersion` / `broadcaster` / `kernel`).
 * A future refactor could extract a shared `IRouteDepsBase`, the
 * current shape is left flat to avoid touching every route at once.
 */
export interface IRouteDeps {
  options: IServerOptions;
  /**
   * Runtime context (`cwd`) consumed by `loadConfig` (for
   * `/api/config`) and by the fresh-scan branch of `/api/scan` (for the
   * scan runner's plugin discovery + ignore filter resolution).
   */
  runtimeContext: IRuntimeContext;
  /**
   * Registry of kinds active in the current scope (Step 14.5.d). Built
   * once per server boot from every enabled Provider's `kinds[*].ui`
   * map and embedded into every payload-bearing envelope so the UI can
   * render Provider-declared kinds without hardcoding a closed kind
   * enum. Sentinel routes (`health`, `scan`, `graph`) don't carry it
   * on the wire either.
   */
  kindRegistry: TKindRegistry;
  /**
   * Registry of Providers active in the current scope (sibling of
   * `kindRegistry`). Built once per server boot from every registered
   * Provider's `ui` block and embedded into every payload-bearing
   * envelope so the UI renders the active-lens dropdown and the per-node
   * provider chip from the real Provider set. Sentinel routes (`health`,
   * `scan`, `graph`) don't carry it on the wire either.
   */
  providerRegistry: TProviderRegistry;
  /**
   * Registered Providers (built-ins + drop-in user plugins). Source of
   * `detect.markers` for active-lens auto-detection in the
   * `/api/active-provider` route; the wire `providerRegistry` omits the
   * markers, so the route reads them off these manifest objects.
   */
  providers: readonly IProvider[];
  /**
   * Phase 3 / View contribution system, registry of plugin-declared
   * view contributions. Built once per server boot from
   * `kernel.getRegisteredViewContributions()` (sibling of
   * `kindRegistry`) and embedded into every payload-bearing envelope.
   * The UI's slot host consumes it once at boot and uses it to look up
   * each contribution's slot directly (no contract → slot indirection;
   * the slot fixes the renderer).
   */
  contributionsRegistry: TContributionsRegistry;
  /**
   * Plugin runtime bundle resolved once at boot (audit M3). Routes
   * that previously called `loadPluginRuntime` per request now reuse
   * this cached value, an operator that installs a new plugin
   * restarts `sm serve`, matching the watcher's contract.
   */
  pluginRuntime: IPluginRuntimeBundle;
  /**
   * Lazily-cached view over `loadConfig`. Routes consume
   * `c.var.configService.get()` (or `.effective()`) instead of calling
   * `loadConfig()` per request, the BFF is long-lived and the layered
   * walk + AJV validation on every read would be wasted work. Routes
   * that mutate the config (`PATCH /api/preferences`,
   * `PATCH /api/project-preferences`, the `confirm: true` arm of
   * `POST /api/sidecar/bump`) MUST call `configService.reload()`
   * immediately after the write so the next read sees the new state.
   */
  configService: ConfigService;
  /**
   * Late-bound watcher reference. Routes that mutate the scan surface
   * (e.g. `PATCH /api/project-preferences` changing
   * `scan.referencePaths`) call `watcherHolder.current?.restart()` so
   * the next batch sees the new side-set. The composition root
   * instantiates the holder before `createApp` and populates `current`
   * once the watcher has booted; the field stays null when
   * `sm serve --no-watcher` was passed or the boot itself failed.
   */
  watcherHolder: IWatcherServiceHolder;
}
