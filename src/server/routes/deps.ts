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
import type { IPluginRuntime } from '../../core/runtime/plugin-runtime.js';
import type { ISkillActionCatalog } from '../../core/skill-actions/catalog.js';

/**
 * Mutable one-field box around the plugin runtime, so a swap performed
 * by `reloadPluginRuntime` reaches every route, including the ones
 * registered through an object spread. Mirrors `IWatcherServiceHolder`.
 */
export interface IPluginRuntimeHolder {
  current: IPluginRuntime;
}
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
   * Plugin runtime, resolved at boot (audit M3) and swappable at
   * runtime. Routes that previously called `loadPluginRuntime` per
   * request read `pluginRuntimeHolder.current` instead; an operator that
   * installs a NEW plugin still restarts `sm serve`, matching the
   * watcher's contract.
   *
   * A holder, not a bare value, because enabling a previously-disabled
   * extension has to REBUILD the runtime (see `reloadPluginRuntime`) and
   * several routes are registered through `{ ...routeDeps }`. A plain
   * field, or a getter, would be copied by value at registration and go
   * stale; the holder's reference survives the spread. Read
   * `.current` at the point of use, never stash it across an `await`.
   */
  pluginRuntimeHolder: IPluginRuntimeHolder;
  /**
   * Rebuild the runtime in `pluginRuntimeHolder` from the current config.
   *
   * Required by any route that ENABLES a previously-disabled extension.
   * The loader gates the import on the enabled axis, so a disabled
   * extension has no live instance to un-filter; without this, a toggle
   * in Settings would silently do nothing until the next restart, which
   * is the interface lying about what is running.
   *
   * Disabling needs no reload: the instance stays loaded and every
   * consumer re-resolves the enabled state per read. Only the
   * false → true direction has something to build.
   */
  reloadPluginRuntime: () => Promise<void>;
  /**
   * Boot-discovered skill-action catalog (`spec/skill-actions.md`).
   * BOOT-FROZEN by contract (§Discovery: discovery runs ONCE at
   * `sm serve` boot, alongside plugin discovery; installing or editing a
   * skill requires a server restart, and the body bytes are cached in
   * memory for the life of the process). Deliberately NO holder and NO
   * reload seam, unlike `pluginRuntimeHolder`: skills have no enable
   * toggles and no mid-session mutation surface, so a plain frozen value
   * is the honest shape. Consumed by the launcher catalog
   * (`node-prob-extensions.ts`, the `skills` bucket) and the submit
   * route (`node-jobs.ts`, `skill:<name>` targets).
   */
  readonly skillActionCatalog: ISkillActionCatalog;
  /**
   * Lazily-cached view over `loadConfig`. Routes consume
   * `c.var.configService.get()` (or `.effective()`) instead of calling
   * `loadConfig()` per request, the BFF is long-lived and the layered
   * walk + AJV validation on every read would be wasted work. Routes
   * that mutate the config (`PATCH /api/preferences`,
   * `PATCH /api/project-preferences`, the `always: true` arm of
   * `POST /api/actions/:id`) MUST call `configService.reload()`
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
