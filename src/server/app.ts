/**
 * Hono app construction, the BFF's request pipeline assembled in the
 * exact order the single-port mandate requires.
 *
 * Route registration order (matters, Hono matches in declaration order):
 *
 *   1. `GET  /api/health`            → real handler (`routes/health.ts`).
 *   2. `GET  /api/scan[?fresh=1]`    → persisted ScanResult (or fresh in-memory).
 *   3. `GET  /api/nodes/:pathB64`    → single-node detail bundle.
 *   4. `GET  /api/nodes`             → paginated, filtered node list.
 *   5. `GET  /api/links`             → filtered link list.
 *   6. `GET  /api/issues`            → filtered issue list.
 *   7. `GET  /api/graph?format=...`  → formatter-rendered graph.
 *   8. `GET  /api/config`            → merged effective config.
 *   9. `GET  /api/plugins`           → installed plugins + load status.
 *   *. `GET  /api/update-status`     → CLI update-check cache projection.
 *  10. `ALL  /api/*` (catch-all)     → 404 with structured error envelope.
 *  11. `GET  /ws`                    → WebSocket upgrade (registered via
 *                                       `deps.attachWs(app)`, at 14.1 the
 *                                       no-op closer; at 14.4 the
 *                                       chokidar broadcaster).
 *  12. `GET  *` (static)             → `serveStatic` rooted at `uiDist`.
 *  13. `GET  *` (SPA fallback)       → `index.html` for any other GET.
 *
 * `/ws` is a real Hono route, `@hono/node-server@2.x` natively
 * supports WebSocket upgrades through its built-in `upgradeWebSocket`
 * helper. The Node http `'upgrade'` listener is wired by node-server
 * itself when `serve({ websocket: { server: wss } })` is called from
 * the composition root.
 *
 * Error envelope (mirrors `cli-contract.md` §Machine-readable output rules):
 *
 *   ```json
 *   {
 *     "ok": false,
 *     "error": { "code": "<short>", "message": "<human>", "details": { ... } | null }
 *   }
 *   ```
 *
 * `app.onError` funnels every uncaught throw through this shape:
 *
 *   - `HTTPException(404)`    → `code: 'not-found'`.
 *   - `HTTPException(400)`    → `code: 'bad-query'`.
 *   - `ConflictError(409)`    → `code: 'scan-busy' | 'sidecar-fresh'`
 *                               (typed subclass, dispatched by `code`).
 *   - `ActionRefusedError(409)` → `code: <report.reason> | 'action-refused'`
 *                               (generic action refusal, open-ended code).
 *   - `HTTPException(413)`    → `code: 'payload-too-large'` (audit M4).
 *   - `ExportQueryError`      → `code: 'bad-query'`, `status: 400`.
 *   - any other status / `Error` → `code: 'internal'`, `status: 500`.
 *
 * `formatErrorMessage` from the CLI's error reporter ensures the
 * server-side log line matches the CLI's `*.texts.ts` framing, same
 * vocabulary across both surfaces.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
// eslint-disable-next-line import-x/extensions
import { bodyLimit } from 'hono/body-limit';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status';

import { formatErrorMessage } from '../kernel/util/format-error.js';
import { ConfigService } from '../core/config/service.js';
import { EConsentRequiredError, ESidecarWritersForbiddenError } from '../core/config/sidecar-consent.js';
import type { IPluginRuntime } from '../core/runtime/plugin-runtime.js';
import type { IRuntimeContext } from '../core/runtime/runtime-context.js';
import { ExportQueryError } from '../kernel/index.js';
import type { Kernel } from '../kernel/index.js';
import { log } from '../kernel/util/logger.js';
import { sanitizeForTerminal } from '../kernel/util/safe-text.js';
import { tx } from '../kernel/util/tx.js';
import type { WsBroadcaster } from './broadcaster.js';
import type { TContributionsRegistry, TKindRegistry, TProviderRegistry } from './envelope.js';
import type { IProvider } from '../kernel/extensions/index.js';
import type { IWatcherServiceHolder } from './watcher.js';
import { SERVER_TEXTS } from './i18n/server.texts.js';
import { createLoopbackGate } from './loopback-gate.js';
import type { IServerOptions } from './options.js';
import { createSecurityHeaders } from './security-headers.js';
import { createSentryRequestCapture } from './telemetry/sentry.js';
import { registerAnnotationsRoute } from './routes/annotations.js';
import { registerContributionsRoutes } from './routes/contributions.js';
import { registerConfigRoute } from './routes/config.js';
import type { IRouteDeps } from './routes/deps.js';
import { registerFavoritesRoutes } from './routes/favorites.js';
import { registerGraphRoute } from './routes/graph.js';
import { registerHealthRoute } from './routes/health.js';
import { registerIssuesRoute } from './routes/issues.js';
import { registerLinksRoute } from './routes/links.js';
import { registerNodesRoutes } from './routes/nodes.js';
import { registerPluginsRoute } from './routes/plugins.js';
import { registerPreferencesRoute } from './routes/preferences.js';
import { registerProjectIgnoreRoute } from './routes/project-ignore.js';
import { registerProjectPreferencesRoute } from './routes/project-preferences.js';
import { registerActiveProviderRoute } from './routes/active-provider.js';
import { registerActionsRoutes } from './routes/actions.js';
import { registerScanRoute } from './routes/scan.js';
import { registerUpdateStatusRoute } from './routes/update-status.js';
import { createSpaFallback, createStaticHandler } from './static.js';
import { attachBroadcasterRoute } from './ws.js';

/**
 * Audit M4, hard cap on the request-body buffer for `/api/*`. 1 MiB is
 * comfortably above the largest legitimate write path (the union of
 * `changes` on bulk PATCH /api/plugins and `scan.referencePaths[]` on
 * PATCH /api/project-preferences) and well below the smallest plausible
 * heap-exhaustion payload, so it gives defence-in-depth without
 * breaking any current consumer. Exported so tests can probe the
 * exact threshold without re-encoding the literal.
 */
export const BODY_LIMIT_BYTES = 1024 * 1024;

export type TErrorCode =
  | 'not-found'
  | 'bad-query'
  | 'db-missing'
  | 'sidecar-fresh'
  | 'scan-busy'
  | 'action-refused'
  | 'locked'
  | 'confirm-required'
  | 'sidecar-writers-forbidden'
  | 'host-not-allowed'
  | 'origin-not-allowed'
  | 'payload-too-large'
  | 'internal';

export interface IErrorEnvelope {
  ok: false;
  error: {
    code: TErrorCode;
    message: string;
    details: unknown | null;
  };
}

/**
 * Mutation-path failure when the project DB file is absent. Read-side
 * routes degrade to empty shapes; writes (`POST /api/scan`, the
 * `PATCH /api/plugins[/:id]` family) cannot persist without a DB so
 * they fail fast. Carried as a dedicated subclass so `formatError` can
 * stamp `code: 'db-missing'` without relying on a status+prefix dance
 * (mirrors how `ExportQueryError` / `EConsentRequiredError` flow
 * through the same handler).
 */
export class DbMissingError extends HTTPException {
  constructor(message: string) {
    super(500, { message });
    this.name = 'DbMissingError';
  }
}

/**
 * Per-id validation failure inside the bulk PATCH /api/plugins handler.
 * The bulk route validates the whole batch before writing; each entry's
 * failure ships with the offending `id` in `details.id` so the SPA can
 * pinpoint the row that broke the batch. The single-id PATCH siblings
 * use plain `HTTPException` (no `id` in `details`); this subclass
 * keeps the bulk-only enrichment centralized in `formatError` instead
 * of every call site shaping its own envelope.
 */
export class BulkValidationError extends HTTPException {
  readonly id: string;
  readonly code: 'bad-query' | 'locked' | 'not-found';

  constructor(init: {
    status: 400 | 403 | 404;
    code: 'bad-query' | 'locked' | 'not-found';
    message: string;
    id: string;
  }) {
    super(init.status, { message: init.message });
    this.name = 'BulkValidationError';
    this.id = init.id;
    this.code = init.code;
  }
}

/**
 * First-stage DNS-rebinding / cross-origin gate failure. Thrown by
 * `createLoopbackGate` when the `Host` or `Origin` header hostname is
 * not loopback. Carried as a dedicated subclass so `formatError` can
 * stamp `code: 'host-not-allowed' | 'origin-not-allowed'` without
 * overloading the generic `403 -> 'locked'` mapping used by the plugin
 * lock-list. `details` stays `null` so the response is opaque to probes
 * (no per-request state leaked).
 */
export class LoopbackGateError extends HTTPException {
  readonly code: 'host-not-allowed' | 'origin-not-allowed';

  constructor(init: { code: 'host-not-allowed' | 'origin-not-allowed'; message: string }) {
    super(403, { message: init.message });
    this.name = 'LoopbackGateError';
    this.code = init.code;
  }
}

/**
 * The two `409 Conflict` conditions, carried as a dedicated subclass so
 * `formatError` can stamp the right `code` via `instanceof` instead of
 * regex-matching the human message prefix (both 409s share the status,
 * so a status-only mapping cannot tell them apart). Mirrors
 * `LoopbackGateError`'s one-class-two-codes shape:
 *
 *   - `scan-busy`     (`POST /api/scan`): another scan is in flight.
 *   - `sidecar-fresh` (legacy bump path): node is fresh and `force` was
 *     not passed. Retained for `POST /api/scan` parity; the generic
 *     `POST /api/actions/:id` route emits its refusals via the
 *     open-ended `ActionRefusedError` instead (the bump refusal now
 *     surfaces as `code: 'fresh'`, the report's own reason).
 *
 * The catalog messages keep their `scan-busy:` prefix for log-grep
 * affinity with the CLI, but the prefix is no longer load-bearing for
 * dispatch (the typed `code` is).
 */
export class ConflictError extends HTTPException {
  readonly code: 'scan-busy' | 'sidecar-fresh';

  constructor(init: { code: 'scan-busy' | 'sidecar-fresh'; message: string }) {
    super(409, { message: init.message });
    this.name = 'ConflictError';
    this.code = init.code;
  }
}

/**
 * Generic action-refusal conflict (Step 17), thrown by the
 * `POST /api/actions/:id` route when an Action's report comes back
 * `ok: false`. Distinct from `ConflictError` because the refusal
 * `code` is open-ended: a plugin Action names its own refusal reason
 * (e.g. `sidecar-fresh`, `cycle-detected`), so the code can't be a
 * closed host union. The reason travels on the envelope
 * `code` (sanitised); the full report ships under `details.report` so
 * the SPA can render the action-specific copy. When the report refuses
 * without naming a reason, the canonical `action-refused` is used.
 *
 * `details` carries `{ actionId, nodePath, report }` so the UI's
 * dispatch path can correlate the refusal with the button it clicked
 * and surface the report verbatim.
 */
export class ActionRefusedError extends HTTPException {
  /** Refusal code: the report's `reason` when present, else `'action-refused'`. */
  readonly code: string;
  readonly details: { actionId: string; nodePath: string; report: unknown };

  constructor(init: {
    code: string;
    message: string;
    actionId: string;
    nodePath: string;
    report: unknown;
  }) {
    super(409, { message: init.message });
    this.name = 'ActionRefusedError';
    this.code = init.code;
    this.details = {
      actionId: init.actionId,
      nodePath: init.nodePath,
      report: init.report,
    };
  }
}

/**
 * Composition-root bag for `createApp`. Most fields are forwarded
 * verbatim into `IRouteDeps` (see `routes/deps.ts`); the extras here
 * (`specVersion`, `broadcaster`, `kernel`) are consumed by
 * `createApp` itself (health route, `/ws` registration, kernel
 * accessors) and never travel into route handlers.
 */
export interface IAppDeps {
  options: IServerOptions;
  /** Pre-resolved spec version threaded through to `/api/health`. */
  specVersion: string;
  /**
   * The `/ws` broadcaster. Step 14.4.a wires `attachBroadcasterRoute`
   * inside `createApp` against this instance; the composition root
   * (`createServer`) owns its lifecycle (instantiate → register → close
   * via `broadcaster.shutdown()`).
   */
  broadcaster: WsBroadcaster;
  /**
   * Runtime context (`cwd`) consumed by the read-side routes.
   * `loadConfig` for `/api/config` and the fresh-scan branch of
   * `/api/scan` both need it; the kernel never reads `process.*`
   * itself. Threaded in by the composition root via `defaultRuntimeContext()`.
   */
  runtimeContext: IRuntimeContext;
  /**
   * Registry of kinds active in the current scope (Step 14.5.d).
   * Composition root builds it once at boot from every enabled
   * Provider via `buildKindRegistry`; every payload-bearing envelope
   * embeds it so the UI never has to hardcode kind visuals. Sentinel
   * envelopes (`health`, `scan`, `graph`) stay exempt.
   */
  kindRegistry: TKindRegistry;
  /**
   * Registry of Providers active in the current scope (sibling of
   * `kindRegistry`). Composition root builds it once at boot from every
   * registered Provider's `ui` block via `buildProviderRegistry`; every
   * payload-bearing envelope embeds it so the UI renders the active-lens
   * dropdown and the per-node provider chip from the real Provider set.
   * Sentinel envelopes (`health`, `scan`, `graph`) stay exempt.
   */
  providerRegistry: TProviderRegistry;
  /**
   * Registered Providers (built-ins + drop-in user plugins), the source
   * of `detect.markers` for active-lens auto-detection. Threaded to the
   * active-provider route; the wire `providerRegistry` omits detection
   * markers, so the route reads them off these manifest objects.
   */
  providers: readonly IProvider[];
  /**
   * Phase 3 / View contribution system, registry of plugin-declared
   * view contributions. Built once at boot via
   * `buildContributionsRegistry(kernel)`; every payload-bearing
   * envelope embeds it so the UI never has to fetch the catalog
   * separately. Sentinel envelopes (`health`, `scan`, `graph`) stay
   * exempt.
   */
  contributionsRegistry: TContributionsRegistry;
  /**
   * Plugin runtime resolved once at boot (audit M3). Threaded
   * through to every read-side route so `/api/graph`, `/api/plugins`,
   * and `/api/scan?fresh=1` reuse the cached discovery instead of
   * re-walking `.skill-map/plugins/` + recompiling AJV validators per
   * request. Mirrors the watcher's "loaded ONCE at boot" contract,
   * an operator that installs a new plugin restarts `sm serve`.
   */
  pluginRuntime: IPluginRuntime;
  /**
   * Watcher reference holder. Composition root passes the holder
   * before the watcher has booted; the route layer reads
   * `holder.current` at request time. See `routes/deps.ts` for the
   * full contract.
   */
  watcherHolder: IWatcherServiceHolder;
  /**
   * Kernel instance owned by the BFF, instantiated once at boot,
   * stamped with the runtime annotation catalog via
   * `setRegisteredAnnotationKeys(pluginRuntime.annotationContributions)`,
   * and exposed read-only by `GET /api/annotations/registered`
   * (Step 9.6.6). The kernel surface itself stays internal; routes
   * never reach into `kernel.registry` or any other accessor without
   * an explicit deps thread-through.
   */
  kernel: Kernel;
}

/**
 * Build the Hono app. Pure factory, every dependency comes through
 * `deps`. The composition root (`createServer`) is the only place
 * that reads env / globals.
 */
export function createApp(deps: IAppDeps): Hono {
  const app = new Hono();

  // Single ConfigService instance for the lifetime of the server.
  // Routes consume it via `IRouteDeps.configService`; mutating routes
  // (PATCH preferences / PATCH project-preferences / the
  // `always: true` arm of POST /api/actions/:id) call
  // `configService.reload()` after a successful write so the next
  // read does not hand out stale state. Mounted directly onto the
  // route deps instead of via a Hono `c.var` middleware, every
  // route already receives `deps` through its registrar, so threading
  // one more property is cheaper than a middleware indirection.
  const configService = new ConfigService({
    cwd: deps.runtimeContext.cwd,
  });

  // Outermost middleware: capture unhandled request-path errors for
  // opt-in telemetry, then re-throw so `app.onError` still formats the
  // response. Mounted first so it observes every downstream throw. A
  // no-op unless the BFF Sentry client was initialised (it is not while
  // the DSN placeholder is empty / consent is OFF). See
  // `server/telemetry/sentry.ts` and `spec/telemetry.md`.
  app.use('*', createSentryRequestCapture());

  // DNS rebinding + cross-origin defence, runs BEFORE every route
  // (including the CORS preflight handler below) so a hostile `Host`
  // or `Origin` is rejected with 403 before any state-changing logic
  // executes. The gate validates the hostname half of `Host` and
  // `Origin` only (port-agnostic, so ephemeral test ports and operator
  // overrides keep working). See `server/loopback-gate.ts` for the
  // threat model.
  app.use('*', createLoopbackGate({ port: deps.options.port }));

  // Audit L2, baseline security headers on every response. See
  // `server/security-headers.ts` for the policy rationale.
  app.use('*', createSecurityHeaders());

  // Audit M4, request body cap. `c.req.json()` / `parseBody()` buffer
  // the whole body in memory; without an upper bound, a misbehaving
  // (or malicious) loopback client could exhaust the server's heap.
  // Loopback-only + the DNS-rebinding gate above already narrow the
  // attack surface, this is defence-in-depth. The cap (1 MiB) is
  // well above every current write path's largest legitimate payload
  // (`scan.referencePaths[]`, `changes` array on PATCH /api/plugins,
  // sidecar bump body), so legitimate clients never hit it. Applied
  // to `/api/*` only, static assets and the WS upgrade do not buffer
  // request bodies through these helpers. The `onError` throws an
  // `HTTPException(413)` so the response funnels through the global
  // `app.onError` and emits the canonical `{ ok: false, error: ... }`
  // envelope with `code: 'payload-too-large'`.
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: () => {
        throw new HTTPException(413, { message: tx(SERVER_TEXTS.bodyTooLarge, { maxBytes: String(BODY_LIMIT_BYTES) }) });
      },
    }),
  );

  // Permissive CORS for the dev workflow, `--dev-cors` only ever
  // applies to a loopback host (validated in `options.ts`), so this
  // never widens the attack surface beyond the local machine.
  if (deps.options.devCors) {
    app.use('*', async (c, next) => {
      await next();
      c.res.headers.set('access-control-allow-origin', '*');
      c.res.headers.set('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
      c.res.headers.set('access-control-allow-headers', 'content-type, authorization');
    });
    app.options('*', (c) => c.body(null, 204));
  }

  // 1. /api/health, liveness / version probe.
  registerHealthRoute(app, {
    options: deps.options,
    runtimeContext: deps.runtimeContext,
    specVersion: deps.specVersion,
  });

  // 2-9. /api/*, Step 14.2 read-side endpoints. Order matters for
  //      the `/api/nodes/:pathB64` vs `/api/nodes` pair (see
  //      `routes/nodes.ts`, single first, list second).
  const routeDeps: IRouteDeps = {
    options: deps.options,
    runtimeContext: deps.runtimeContext,
    kindRegistry: deps.kindRegistry,
    providerRegistry: deps.providerRegistry,
    providers: deps.providers,
    contributionsRegistry: deps.contributionsRegistry,
    pluginRuntime: deps.pluginRuntime,
    configService,
    watcherHolder: deps.watcherHolder,
  };
  registerScanRoute(app, { ...routeDeps, broadcaster: deps.broadcaster });
  registerNodesRoutes(app, routeDeps);
  registerLinksRoute(app, routeDeps);
  registerIssuesRoute(app, routeDeps);
  registerGraphRoute(app, routeDeps);
  registerConfigRoute(app, routeDeps);
  registerPluginsRoute(app, routeDeps);
  // Step 17, `POST /api/actions/:qualifiedId` (generic Action
  // dispatch). Generalises the retired `POST /api/sidecar/bump`:
  // resolves any qualified action id off the kernel registry, invokes
  // it, materialises sidecar writes through the consent-gated store,
  // and fans out an `action.applied` WS event on success. Carries the
  // broadcaster + kernel.
  registerActionsRoutes(app, { ...routeDeps, broadcaster: deps.broadcaster, kernel: deps.kernel });
  // Per-user favorites, `PUT/DELETE /api/favorites/:pathB64`. Persists
  // to `state_node_favorites` (zone `state_`); decorated onto every
  // `/api/nodes` response via in-memory Set membership.
  registerFavoritesRoutes(app, routeDeps);
  // Step 9.6.6, `GET /api/annotations/registered`. Read-only catalog
  // of plugin-contributed annotation keys; pure projection of the
  // boot-time `kernel.getRegisteredAnnotationKeys()` view.
  registerAnnotationsRoute(app, { kernel: deps.kernel });
  // Phase 3 / View contribution system,
  //   `GET /api/contributions/registered` (catalog projection) and
  //   `GET /api/contributions/:pluginId/:contributionId?path=` (lazy lookup).
  registerContributionsRoutes(app, { ...routeDeps, kernel: deps.kernel });
  // Update-check cache projection, read-only view of the row the CLI's
  // post-run hook writes (`config_preferences/_kernel.update-check`).
  // Never triggers a registry probe.
  registerUpdateStatusRoute(app, routeDeps);
  // Per-machine preferences, `GET / PATCH /api/preferences`. Today
  // exposes a single sub-key (`updateCheck.enabled`); shape extends
  // additively as more per-machine settings (locale, theme) land.
  // Persists to `~/.skill-map/settings.json` (the documented
  // exception to the no-`$HOME`-reads principle, see
  // `spec/cli-contract.md` §Scope is always project-local) via
  // `cli/util/user-settings-store.ts`.
  registerPreferencesRoute(app, routeDeps);
  // Project-scope preferences, `GET / PATCH /api/project-preferences`.
  // Carries the privacy-sensitive `scan.referencePaths` key; writes
  // that expand the scan's disk-access surface require `confirm: true`
  // in the body. Persists to `<cwd>/.skill-map/settings.local.json`.
  registerProjectPreferencesRoute(app, routeDeps);
  // Active provider lens, `GET / PUT /api/active-provider`.
  // Switching the lens drops the scan_* zone atomically (see
  // `spec/architecture.md` §Active Provider Lens); state_* and
  // config_* survive. The UI's Settings → Project section consumes
  // this route to render the dropdown of enabled providers and to
  // persist the operator's choice.
  registerActiveProviderRoute(app, routeDeps);
  // Project-scope ignore patterns, `GET / PATCH /api/project-ignore`.
  // Backing is the project-root `.skillmapignore` file; comments and
  // blank lines are preserved on write. No privacy gate (patterns
  // only narrow the scan surface). Pairs with the Settings UI's
  // "Ignored patterns" row.
  registerProjectIgnoreRoute(app, routeDeps);

  // 10. /api/* (catch-all), every other API path returns the structured
  //     404 envelope. Keeps the contract honest as new endpoints land in
  //     post-14.2 sub-steps.
  //
  //     Audit L4, the path is sanitized before interpolation. Hono
  //     URL-decodes `c.req.path`, so attacker-controlled bytes (ANSI
  //     escapes, CR/LF) can otherwise flow into the JSON envelope and
  //     (more importantly) into stderr / log lines where the CLI mirrors
  //     them to a terminal. `sanitizeForTerminal` strips ANSI CSI/OSC
  //     sequences and the C0 control subset (NUL, BEL, BS, VT, FF, SO,
  //     SI, DEL, etc.), keeping `\t` `\n` `\r` for human readability.
  app.all('/api/*', (c) => {
    throw new HTTPException(404, {
      message: tx(SERVER_TEXTS.unknownApiEndpoint, { path: sanitizeForTerminal(c.req.path) }),
    });
  });

  // 3. /ws, WebSocket upgrade route. Must be declared BEFORE the
  //    static handler so a literal `/ws` path on disk in `uiDist`
  //    cannot accidentally shadow the upgrade route.
  attachBroadcasterRoute(app, deps.broadcaster);

  // 4. Static + 5. SPA fallback. Order matters: the static handler
  //    short-circuits on a real file match; everything else falls
  //    through to the SPA fallback (which serves index.html).
  app.use('*', createStaticHandler({ uiDist: deps.options.uiDist, noUi: deps.options.noUi }));
  app.get('*', createSpaFallback({ uiDist: deps.options.uiDist, noUi: deps.options.noUi }));

  app.notFound((c) => {
    // Audit L4, same path-sanitisation rationale as the `/api/*`
    // catch-all above.
    throw new HTTPException(404, {
      message: tx(SERVER_TEXTS.unknownPath, { path: sanitizeForTerminal(c.req.path) }),
    });
  });

  app.onError((err, c) => {
    return formatError(err, c);
  });

  return app;
}

// The two `409` codes (`scan-busy` / `sidecar-fresh`) are NOT resolved
// here: they share the HTTP status, so a status-only mapping cannot tell
// them apart. They flow through the dedicated `ConflictError` subclass,
// which carries the typed `code` and is dispatched by `instanceof` in
// `formatError` before this generic status mapper ever runs.
function codeForStatus(status: number): TErrorCode {
  if (status === 404) return 'not-found';
  if (status === 400) return 'bad-query';
  // 403, host-enforced policy refusal. Today only the plugin-lock
  // route uses it (`PATCH /api/plugins/:id` against an entry in
  // `src/server/locked-plugins.ts`).
  if (status === 403) return 'locked';
  // 412, preconditions not met. Today only the project-preferences
  // route uses it: a privacy-sensitive write that would expand the
  // scan's disk-access surface needs `confirm: true` in the body.
  if (status === 412) return 'confirm-required';
  // 413, request body exceeded the global `BODY_LIMIT_BYTES` cap
  // (audit M4). Thrown by the `bodyLimit` middleware's `onError`.
  if (status === 413) return 'payload-too-large';
  return 'internal';
}

/**
 * Exported for unit tests, the production wiring is via
 * `app.onError(...)` in `createApp`. Tests can drive every branch
 * (including the fall-through in audit L3) without booting the full
 * server.
 */
export function formatError(err: unknown, c: Context): Response {
  if (err instanceof DbMissingError) {
    const envelope: IErrorEnvelope = {
      ok: false,
      error: {
        code: 'db-missing',
        message: err.message,
        details: null,
      },
    };
    return c.json(envelope, 500);
  }

  if (err instanceof BulkValidationError) {
    const envelope: IErrorEnvelope = {
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        details: { id: err.id },
      },
    };
    return c.json(envelope, err.status as ContentfulStatusCode);
  }

  if (err instanceof LoopbackGateError) {
    const envelope: IErrorEnvelope = {
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        details: null,
      },
    };
    return c.json(envelope, 403);
  }

  const conflict = formatConflict(err, c);
  if (conflict) return conflict;

  if (err instanceof HTTPException) {
    const status = err.status as StatusCode;
    const envelope: IErrorEnvelope = {
      ok: false,
      error: {
        code: codeForStatus(status),
        message: err.message,
        details: null,
      },
    };
    return c.json(envelope, status as ContentfulStatusCode);
  }

  // `ExportQueryError` is the kernel's contract for malformed query
  // input, `parseExportQuery` throws it from inside
  // `urlParamsToExportQuery`. Map to 400 `bad-query` so the user sees
  // the same envelope shape as a `HTTPException(400)` thrown by a
  // route handler.
  if (err instanceof ExportQueryError) {
    const envelope: IErrorEnvelope = {
      ok: false,
      error: {
        code: 'bad-query',
        message: err.message,
        details: null,
      },
    };
    return c.json(envelope, 400);
  }

  const sidecar = formatSidecarConsentError(err, c);
  if (sidecar) return sidecar;

  return formatInternalErrorFallThrough(err, c);
}

/**
 * Format the two `.sm`-write gate errors into the canonical envelope.
 * Returns `null` when `err` is neither, so `formatError` can fall
 * through. Extracted alongside `formatConflict` so the dispatcher's
 * cyclomatic complexity stays inside the lint budget.
 *
 *   - `EConsentRequiredError`         -> 412 `confirm-required`. The
 *     operator needs to grant per-machine consent; the UI branches on
 *     the code to open a `ConfirmationService` dialog and retry with
 *     `confirm` / `always`. `details.key` names the consent key.
 *   - `ESidecarWritersForbiddenError` -> 403 `sidecar-writers-forbidden`.
 *     The project's committed `allowSidecarWriters` policy forbids
 *     writers; unlike consent it is NOT recoverable from the UI (no
 *     dialog, no retry). `details.key` names the policy key.
 */
function formatSidecarConsentError(err: unknown, c: Context): Response | null {
  if (err instanceof EConsentRequiredError) {
    const envelope: IErrorEnvelope = {
      ok: false,
      error: { code: 'confirm-required', message: err.message, details: { key: err.key } },
    };
    return c.json(envelope, 412);
  }
  if (err instanceof ESidecarWritersForbiddenError) {
    const envelope: IErrorEnvelope = {
      ok: false,
      error: { code: 'sidecar-writers-forbidden', message: err.message, details: { key: err.key } },
    };
    return c.json(envelope, 403);
  }
  return null;
}

/**
 * Format the two `409 Conflict` subclasses into the canonical error
 * envelope. Returns `null` when `err` is neither, so the caller can
 * fall through to the next mapping branch. Extracted from `formatError`
 * so the dispatcher's cyclomatic complexity stays inside the lint
 * budget (the two `instanceof` checks + the details ternary would
 * otherwise push it over).
 *
 *   - `ConflictError`      (`scan-busy` / `sidecar-fresh`): closed
 *     `code`, no `details`.
 *   - `ActionRefusedError` (`POST /api/actions/:id`): open-ended `code`
 *     (the report's `reason`, sanitised at the throw site, widened past
 *     the closed `TErrorCode` union, the UI's `TErrorCodeApi` accepts
 *     an open `string`), `details` carries `{ actionId, nodePath,
 *     report }` so the SPA renders action-specific copy.
 */
function formatConflict(err: unknown, c: Context): Response | null {
  if (err instanceof ActionRefusedError) {
    const envelope: IErrorEnvelope = {
      ok: false,
      error: { code: err.code as TErrorCode, message: err.message, details: err.details },
    };
    return c.json(envelope, 409);
  }
  if (err instanceof ConflictError) {
    const envelope: IErrorEnvelope = {
      ok: false,
      error: { code: err.code, message: err.message, details: null },
    };
    return c.json(envelope, 409);
  }
  return null;
}

/**
 * Audit L3, the unmapped-throw fall-through. The raw `err.message`
 * often carries kernel detail (absolute paths, registry-probe
 * hostnames, etc.) that has no business in a client-facing JSON
 * envelope. Redact the human-readable text to a generic constant and
 * route the real detail (message + stack when present) to `log.warn`
 * so operators still see it on stderr / their log file. `code` stays
 * `'internal'`; `details` stays `null` to match the documented envelope
 * shape.
 *
 * Extracted from `formatError` to keep the dispatcher's cyclomatic
 * complexity inside the project's lint budget.
 */
function formatInternalErrorFallThrough(err: unknown, c: Context): Response {
  const detail = formatErrorMessage(err);
  const stack = err instanceof Error && typeof err.stack === 'string' ? err.stack : undefined;
  const context = stack !== undefined ? { stack } : undefined;
  log.warn(`onError fall-through: ${detail}`, context);

  const envelope: IErrorEnvelope = {
    ok: false,
    error: {
      code: 'internal',
      message: SERVER_TEXTS.internalError,
      details: null,
    },
  };
  return c.json(envelope, 500);
}
