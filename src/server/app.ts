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
 *   - `ConflictError(409)`    → `code: 'scan-busy' | 'job-terminal' | ...`
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
import { DbSchemaDriftError } from '../core/sqlite/db-version-check.js';
import {
  emptyPluginRuntime,
  loadPluginRuntime,
  type IPluginRuntime,
} from '../core/runtime/plugin-runtime.js';
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
import { registerBranchRoute } from './routes/branch.js';
import { registerContributionsRoutes } from './routes/contributions.js';
import { registerConfigRoute } from './routes/config.js';
import type { IPluginRuntimeHolder, IRouteDeps } from './routes/deps.js';
import { registerFavoritesRoutes } from './routes/favorites.js';
import { registerFoldersRoute } from './routes/folders.js';
import { registerGraphRoute } from './routes/graph.js';
import { registerHealthRoute } from './routes/health.js';
import { registerMcpStatusRoute } from './routes/mcp-status.js';
import { registerIssuesRoute } from './routes/issues.js';
import { registerLinksRoute } from './routes/links.js';
import { registerNodeFindingActionsRoutes } from './routes/node-finding-actions.js';
import { registerNodeIssueActionsRoutes } from './routes/node-issue-actions.js';
import { registerNodeFindingsRoute } from './routes/node-findings.js';
import { registerNodeSummaryRoute } from './routes/node-summary.js';
import { registerNodeJobsRoute } from './routes/node-jobs.js';
import { registerNodeProbExtensionsRoute } from './routes/node-prob-extensions.js';
import { registerNodesRoutes } from './routes/nodes.js';
import { registerPluginsRoute } from './routes/plugins.js';
import { registerPreferencesRoute } from './routes/preferences.js';
import { registerProjectIgnoreRoute } from './routes/project-ignore.js';
import { registerProjectPreferencesRoute } from './routes/project-preferences.js';
import type { ActivityConversationStore } from './activity-conversations.js';
import type { ActivityOwnerIndex } from './activity-owner-index.js';
import type { ActivityStatsService } from './activity-stats.js';
import type { AgentPresenceTracker } from './agent-presence.js';
import { registerActiveProviderRoute } from './routes/active-provider.js';
import { registerActionsRoutes } from './routes/actions.js';
import { registerActivityRoute } from './routes/activity.js';
import { registerActivityCaptureRoutes } from './routes/activity-capture.js';
import { registerActivityDetailRoutes } from './routes/activity-detail.js';
import { registerActivityInstallRoutes } from './routes/activity-install.js';
import { registerActivitySummaryRoute } from './routes/activity-summary.js';
import { registerAgentInstallRoutes } from './routes/agent-install.js';
import { registerAgentPresenceRoute } from './routes/agent-presence.js';
import { registerJobBulkRoutes } from './routes/job-bulk.js';
import { registerJobCancelRoute } from './routes/job-cancel.js';
import { registerJobEventsRoute } from './routes/job-events.js';
import { registerJobsRoute } from './routes/jobs.js';
import { registerScanRoute } from './routes/scan.js';
import { registerGithubStarsRoute } from './routes/github-stars.js';
import { registerUpdateStatusRoute } from './routes/update-status.js';
import { createSpaFallback, createStaticHandler } from './static.js';
import type { McpSessionManager } from './mcp/index.js';
import { registerMcpRoute } from './mcp/index.js';
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
  | 'db-drift'
  | 'scan-busy'
  | 'action-refused'
  | 'locked'
  | 'confirm-required'
  | 'sidecar-writers-forbidden'
  | 'host-not-allowed'
  | 'origin-not-allowed'
  | 'token-mismatch'
  | 'payload-too-large'
  // Job-submit 409s (`POST /api/nodes/:pathB64/jobs`, Step 16 piece 1;
  // `spec/cli-contract.md` §BFF endpoint POST /api/nodes/:pathB64/jobs).
  // Carried by `JobSubmitConflictError`.
  | 'no-processing-agent'
  | 'duplicate-job'
  | 'job-running'
  | 'node-drifted'
  | 'no-findings'
  // Cancel 409 (`POST /api/jobs/:jobId/cancel`, Step 16 launcher stop;
  // `spec/cli-contract.md` route row): the job is already terminal.
  // Carried by `ConflictError`.
  | 'job-terminal'
  // Finding-action 409s (`POST /api/nodes/:pathB64/findings/:id/...`,
  // the inspector's per-finding dismiss / resolve; `spec/cli-contract.md`
  // route rows). Carried by `ConflictError`.
  | 'finding-not-dismissible'
  | 'finding-already-fixed'
  | 'finding-terminal'
  | 'finding-open'
  // Issue-action 409 (`POST /api/nodes/:pathB64/issues/undismiss`, the
  // inspector's per-issue undismiss; `spec/cli-contract.md` route row):
  // no matching `annotations.issueSuppressions` entry to lift. Carried
  // by `ConflictError`.
  | 'issue-suppression-not-found'
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
 * 412 `confirm-required` whose consent dialog needs DATA beyond prose.
 * A plain `HTTPException(412)` maps to `details: null`; gates whose UI
 * dialog enumerates something structured throw this subclass instead so
 * `formatError` can ship the payload under `error.details` (mirrors the
 * sidecar gate's `details.key` and `BulkValidationError`'s `details.id`
 * precedents). Today only the project-preferences path-exposure gate
 * uses it (`details: { paths: string[] }`, the out-of-project folders a
 * `scan.referencePaths` write would expose; `spec/cli-contract.md`
 * §BFF endpoint PATCH /api/project-preferences).
 */
export class ConfirmRequiredError extends HTTPException {
  readonly details: unknown;

  constructor(message: string, details: unknown) {
    super(412, { message });
    this.name = 'ConfirmRequiredError';
    this.details = details ?? null;
  }
}

/**
 * Base for policy-refusal 403s whose envelope is intentionally OPAQUE:
 * a fixed catalog message, a typed `code`, and `details: null` so the
 * response leaks no per-request state to probes. One `instanceof`
 * branch in `formatError` serves every subclass, keeping the dispatch
 * funnel's complexity flat as new opaque 403 gates land.
 */
export class OpaqueForbiddenError extends HTTPException {
  readonly code: TErrorCode;

  constructor(init: { code: TErrorCode; message: string }) {
    super(403, { message: init.message });
    this.name = 'OpaqueForbiddenError';
    this.code = init.code;
  }
}

/**
 * First-stage DNS-rebinding / cross-origin gate failure. Thrown by
 * `createLoopbackGate` when the `Host` or `Origin` header hostname is
 * not loopback. Carried as a dedicated subclass so `formatError` can
 * stamp `code: 'host-not-allowed' | 'origin-not-allowed'` without
 * overloading the generic `403 -> 'locked'` mapping used by the plugin
 * lock-list.
 */
export class LoopbackGateError extends OpaqueForbiddenError {
  declare readonly code: 'host-not-allowed' | 'origin-not-allowed';

  constructor(init: { code: 'host-not-allowed' | 'origin-not-allowed'; message: string }) {
    super(init);
    this.name = 'LoopbackGateError';
  }
}

/**
 * Ingest-token gate failure on the push-leg routes, `POST /api/activity`
 * (live node activity, `spec/provider-activity.md` §Ingest) and
 * `POST /api/job-events` (job transitions, `spec/job-events.md`
 * §Transport). Thrown BEFORE any body processing when the
 * `x-skill-map-token` header is missing or does not match the
 * per-session token minted at boot (published via
 * `.skill-map/serve.json`). Shared throw site:
 * `util/ingest-token.ts`.
 */
export class ActivityTokenError extends OpaqueForbiddenError {
  declare readonly code: 'token-mismatch';

  constructor() {
    super({ code: 'token-mismatch', message: SERVER_TEXTS.activityTokenMismatch });
    this.name = 'ActivityTokenError';
  }
}

/**
 * The closed-code, no-details `409 Conflict` conditions, carried as a
 * dedicated subclass so `formatError` can stamp the right `code` via
 * `instanceof` instead of regex-matching the human message prefix (the
 * 409s share the status, so a status-only mapping cannot tell them
 * apart). Mirrors `LoopbackGateError`'s one-class-N-codes shape:
 *
 *   - `scan-busy`     (`POST /api/scan`): another scan is in flight.
 *   - `job-terminal`  (`POST /api/jobs/:jobId/cancel`): the job already
 *     reached a terminal state, nothing left to cancel (the HTTP face
 *     of the CLI's "already terminal" exit-2 refusal).
 *
 * The catalog messages keep their `scan-busy:` prefix for log-grep
 * affinity with the CLI, but the prefix is no longer load-bearing for
 * dispatch (the typed `code` is).
 */
export class ConflictError extends HTTPException {
  readonly code:
    | 'scan-busy'
    | 'job-terminal'
    | 'finding-not-dismissible'
    | 'finding-already-fixed'
    | 'finding-terminal'
    | 'finding-open'
    | 'issue-suppression-not-found';

  constructor(init: { code: ConflictError['code']; message: string }) {
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
 * (e.g. `fresh`, `cycle-detected`), so the code can't be a
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
 * Job-submit conflict (`POST /api/nodes/:pathB64/jobs`, Step 16 piece 1),
 * the third 409 family next to `ConflictError` / `ActionRefusedError`.
 * A dedicated subclass because the submit surface needs BOTH a closed
 * host `code` union (unlike the open-ended `ActionRefusedError`) AND a
 * per-code `details` payload (`{ existingId }` on `duplicate-job` /
 * `job-running`, which the two-code `ConflictError` cannot carry). The
 * codes mirror the CLI submit refusals 1:1
 * (`spec/cli-contract.md` §BFF endpoint POST /api/nodes/:pathB64/jobs):
 *
 *   - `no-processing-agent`, the operator gate (no installed skill).
 *   - `duplicate-job`, active identical job (`details.existingId`).
 *   - `job-running`, a RUNNING sibling holds its claim, never superseded
 *     (`details.existingId`).
 *   - `node-drifted`, the on-disk body no longer matches the scanned
 *     hash (advisory names `sm scan`).
 *   - `no-findings`, fixer over a node with zero matching findings
 *     (defensive: the UI hides that launcher).
 */
export class JobSubmitConflictError extends HTTPException {
  readonly code: Extract<
    TErrorCode,
    'no-processing-agent' | 'duplicate-job' | 'job-running' | 'node-drifted' | 'no-findings'
  >;

  readonly details: unknown | null;

  constructor(init: {
    code: JobSubmitConflictError['code'];
    message: string;
    details?: unknown;
  }) {
    super(409, { message: init.message });
    this.name = 'JobSubmitConflictError';
    this.code = init.code;
    this.details = init.details ?? null;
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
   * Per-session ingest token for `POST /api/activity` (live node
   * activity). Minted by the composition root at boot
   * (`randomBytes(32).toString('hex')`), published to co-located local
   * processes via `.skill-map/serve.json` (written by the `sm serve`
   * verb), rotated on every restart. The activity route rejects
   * requests without it (403 `token-mismatch`).
   */
  activityToken: string;
  /**
   * Boot-scoped execution-stats accumulator (live node activity, see
   * `spec/provider-activity.md` §Execution stats). Instantiated by the
   * composition root; threaded ONLY to the activity routes (ingest,
   * summary, node detail) as an explicit extra dep, never placed on
   * `IRouteDeps`.
   */
  activityStats: ActivityStatsService;
  /**
   * Boot-scoped `owner -> agent node` index (see
   * `activity-owner-index.ts`). Instantiated by the composition root;
   * threaded ONLY to the ingest route as an explicit extra dep, never
   * placed on `IRouteDeps`. Holds paths, never content.
   */
  activityOwners: ActivityOwnerIndex;
  /**
   * Consent-gated conversation store (see `activity-conversations.ts`
   * for the custody contract). Instantiated ONLY by the composition
   * root; threaded ONLY to the activity routes (ingest, detail,
   * capture) as an explicit extra dep, never placed on `IRouteDeps`,
   * never reachable from the kernel / plugin runtime.
   */
  activityConversations: ActivityConversationStore;
  /**
   * Boot-scoped agent-presence tracker (see `agent-presence.ts`).
   * Instantiated by the composition root, which ALSO registers its
   * `observe` as the broadcaster's envelope observer; `createApp` only
   * threads it to the read route (`GET /api/agent/presence`) as an
   * explicit extra dep, never onto `IRouteDeps`.
   */
  agentPresence: AgentPresenceTracker;
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
  /**
   * Read-only MCP session manager (see `spec/mcp-server.md`), present
   * ONLY when the MCP server is enabled (`options.mcpServer`). Built and
   * owned by the composition root (`createMcpIntegration` in
   * `createServer`), which also registers its realtime broadcaster sink
   * and disposes it on shutdown; `createApp` only wires the top-level
   * `POST/GET/DELETE /mcp` routes into it. `null` when the MCP server is
   * off, in which case no `/mcp` route is mounted and a `/mcp` request
   * falls through to the SPA `*` handler.
   */
  mcpManager: McpSessionManager | null;
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

  // 1b. /api/mcp/status, live MCP connection probe (Quick Start "MCP
  //     installed on your agent" check). `mcpManager` is null when the MCP
  //     server is off, so the route reports enabled=false / connected=false.
  registerMcpStatusRoute(app, { options: deps.options, mcpManager: deps.mcpManager });

  // 1c. /api/agent/presence, "has a processing agent been observed
  //     attending this project's queue?". Pure read over the boot-scoped
  //     tracker the broadcaster feeds; counts a CLI-parked agent (which
  //     holds no MCP session) exactly like an MCP one.
  registerAgentPresenceRoute(app, { presence: deps.agentPresence });

  // 2-9. /api/*, Step 14.2 read-side endpoints. Order matters for
  //      the `/api/nodes/:pathB64` vs `/api/nodes` pair (see
  //      `routes/nodes.ts`, single first, list second).
  // The plugin runtime is a LIVE view, not a boot-time snapshot.
  //
  // It used to be a plain value, and that was fine while the loader
  // imported every discovered extension and the composer filtered the
  // disabled ones out afterwards: flipping a toggle changed the filter,
  // not the set of imported modules, so a config reload was enough.
  //
  // Since the loader gates the IMPORT on the enabled axis (an extension
  // the operator disabled never has its module evaluated), enabling one
  // mid-session has nothing to re-filter, the instance does not exist.
  // The runtime has to be rebuilt for it to appear.
  //
  // A HOLDER rather than a getter, deliberately: half the routes below
  // are registered with `{ ...routeDeps, broadcaster }`, and a spread
  // evaluates a getter once and freezes the result, so a getter would
  // have gone stale exactly where it mattered. Copying a holder copies
  // the reference, so every route sees the swap. Same shape as
  // `watcherHolder`, which solves the same problem for the watcher.
  const pluginRuntimeHolder: IPluginRuntimeHolder = { current: deps.pluginRuntime };
  const routeDeps: IRouteDeps = {
    options: deps.options,
    runtimeContext: deps.runtimeContext,
    kindRegistry: deps.kindRegistry,
    providerRegistry: deps.providerRegistry,
    providers: deps.providers,
    contributionsRegistry: deps.contributionsRegistry,
    pluginRuntimeHolder,
    reloadPluginRuntime: async (): Promise<void> => {
      pluginRuntimeHolder.current = deps.options.noPlugins
        ? emptyPluginRuntime()
        : await loadPluginRuntime({ runtimeContext: deps.runtimeContext });
    },
    configService,
    watcherHolder: deps.watcherHolder,
  };
  registerScanRoute(app, { ...routeDeps, broadcaster: deps.broadcaster });
  registerNodesRoutes(app, routeDeps);
  // Step 16 piece 1, the findings workbench (inspector half):
  //   `GET  /api/nodes/:pathB64/findings`        -> per-node judgment tray
  //   `GET  /api/nodes/:pathB64/prob-extensions` -> launcher catalog
  //   `POST /api/nodes/:pathB64/jobs`            -> submit via the shared
  //     core engine (broadcasts `job.submitted` on success).
  //   `POST /api/jobs/:jobId/cancel`             -> launcher stop
  //     (broadcasts `job.cancelled` on success).
  registerNodeFindingsRoute(app, routeDeps);
  registerNodeSummaryRoute(app, routeDeps);
  // Per-finding mutations (inspector tray): dismiss / resolve / undismiss,
  // the HTTP faces of the `sm findings` verbs (read-time suppression lens).
  registerNodeFindingActionsRoutes(app, routeDeps);
  // Per-issue mutations (inspector issue rows): dismiss / undismiss, the
  // HTTP faces of `sm issues dismiss / undismiss` (emission-time
  // suppressions; dismiss also deletes the covered scan_issues rows).
  registerNodeIssueActionsRoutes(app, routeDeps);
  registerNodeProbExtensionsRoute(app, routeDeps);
  registerNodeJobsRoute(app, { ...routeDeps, broadcaster: deps.broadcaster });
  registerJobCancelRoute(app, {
    options: routeDeps.options,
    broadcaster: deps.broadcaster,
    runtimeContext: routeDeps.runtimeContext,
  });
  // Queue-inspector bulk affordances: cancel-all (broadcasts one
  // `job.cancelled` per affected id) and prune (silent GC of all terminal
  // jobs). Same narrow bag as the single-job cancel route.
  registerJobBulkRoutes(app, {
    options: routeDeps.options,
    broadcaster: deps.broadcaster,
    runtimeContext: routeDeps.runtimeContext,
  });
  // Cross-corpus job list (`GET /api/jobs`), the read side of the UI queue
  // inspector. Narrow read-only bag (dbPath only), like the cancel route;
  // strips the nonce off every row (`spec/job-lifecycle.md` §Nonce exposure).
  registerJobsRoute(app, { options: routeDeps.options });
  registerLinksRoute(app, routeDeps);
  registerIssuesRoute(app, routeDeps);
  registerFoldersRoute(app, routeDeps);
  registerBranchRoute(app, routeDeps);
  registerGraphRoute(app, routeDeps);
  registerConfigRoute(app, routeDeps);
  // Carries the broadcaster for the disable cascade's per-job
  // `job.cancelled` fan-out (spec/job-lifecycle.md §Cancellation).
  registerPluginsRoute(app, { ...routeDeps, broadcaster: deps.broadcaster });
  // Step 17, `POST /api/actions/:qualifiedId` (generic Action
  // dispatch). Generalises the retired `POST /api/sidecar/bump`:
  // resolves any qualified action id off the kernel registry, invokes
  // it, materialises sidecar writes through the consent-gated store,
  // and fans out an `action.applied` WS event on success. Carries the
  // broadcaster + kernel.
  registerActionsRoutes(app, { ...routeDeps, broadcaster: deps.broadcaster, kernel: deps.kernel });
  // Live node activity ingest, `POST /api/activity` (see
  // `spec/provider-activity.md`). Token-gated (403 `token-mismatch`)
  // BEFORE any body processing; maps the raw provider hook payload via
  // the Provider's `activity.mapEvent`, feeds the stats accumulator +
  // the consent-gated conversation store, and broadcasts one
  // stats-enriched `node.activity` WS event per resolved signal plus
  // one metadata-only `agent.spawn` event per spawn relation. Always
  // answers 202 on a well-formed request (fire-and-forget bridge
  // contract).
  registerActivityRoute(app, {
    ...routeDeps,
    broadcaster: deps.broadcaster,
    activityToken: deps.activityToken,
    stats: deps.activityStats,
    owners: deps.activityOwners,
    conversations: deps.activityConversations,
  });
  // Job-event push ingest, `POST /api/job-events` (the CLI-to-server
  // push leg of `spec/job-events.md` §Transport). Same serve.json
  // session token as the activity ingest (403 `token-mismatch` BEFORE
  // any body processing); validates the canonical `job.*` envelope and
  // rebroadcasts it VERBATIM over `/ws`. DB-free by construction, the
  // narrow deps bag carries only the broadcaster + token.
  registerJobEventsRoute(app, {
    broadcaster: deps.broadcaster,
    ingestToken: deps.activityToken,
  });
  // Live-activity install management, `GET/POST /api/activity/install`
  // + `POST /api/activity/uninstall` (see `spec/provider-activity.md`
  // §Install management over HTTP). The SPA's Settings → Project
  // install/uninstall button; mutations are consent-gated (412
  // `confirm-required` without `confirm: true`, nothing written).
  registerActivityInstallRoutes(app, routeDeps);
  // Agent-process-skill install management, `GET/POST /api/agent/install`
  // + `POST /api/agent/uninstall` (see `spec/cli-contract.md` §Agent
  // process skill). The SPA's Settings → Project Install / Update / Up to
  // date button; mutations are consent-gated (412 `confirm-required`
  // without `confirm: true`, nothing written).
  registerAgentInstallRoutes(app, routeDeps);
  // Execution-stats snapshot, `GET /api/activity/summary` (client
  // hydration on connect / reconnect / re-enable). Stats-only; no
  // token, loopback-gated like every /api/* route.
  registerActivitySummaryRoute(app, { stats: deps.activityStats, options: deps.options });
  // Per-node + per-spawn activity detail, `GET /api/activity/node/:pathB64`
  // and `GET /api/activity/spawns/:spawnId` (inspector Activity section
  // + spawn-edge click). Conversation content only while the capture
  // gate is on.
  registerActivityDetailRoutes(app, {
    ...routeDeps,
    stats: deps.activityStats,
    conversations: deps.activityConversations,
  });
  // Conversation-capture gate, `GET/POST /api/activity/capture`.
  // Consent-gated mutation (412 `confirm-required`); persists to the
  // project-local config layer and updates the store synchronously.
  registerActivityCaptureRoutes(app, {
    ...routeDeps,
    conversations: deps.activityConversations,
  });
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
  // Non-essential decoration, no deps: the probe + its memory cache are
  // owned by the route module itself.
  registerGithubStarsRoute(app);
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

  // Read-only MCP server, top-level `POST/GET/DELETE /mcp` (a sibling of
  // `/ws`, OUTSIDE `/api/*`). Mounted ONLY when the MCP server is enabled
  // and registered BEFORE the static handler + SPA fallback so a literal
  // `/mcp` path on disk cannot shadow it. When disabled, `deps.mcpManager`
  // is null and `/mcp` falls through to the SPA `*` handler. The manager
  // (and its broadcaster sink) are built + disposed by the composition
  // root; this only wires the routes. See `spec/mcp-server.md`.
  if (deps.mcpManager) {
    registerMcpRoute(app, deps.mcpManager);
  }

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

// The `409` codes (`scan-busy`, `job-terminal`, the finding / issue
// lifecycle refusals) are NOT resolved
// here: they share the HTTP status, so a status-only mapping cannot tell
// them apart. They flow through the dedicated `ConflictError` subclass,
// which carries the typed `code` and is dispatched by `instanceof` in
// `formatError` before this generic status mapper ever runs.
function codeForStatus(status: number): TErrorCode {
  if (status === 404) return 'not-found';
  if (status === 400) return 'bad-query';
  // 403, host-enforced policy refusal. Today only the plugin-lock
  // route uses it (`PATCH /api/plugins/:id` against an entry in
  // the manifest `locked` flag via `src/plugins/locked-built-ins.ts`).
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
  const dbError = formatDbError(err, c);
  if (dbError) return dbError;

  const detailed = formatDetailCarryingError(err, c);
  if (detailed) return detailed;

  if (err instanceof OpaqueForbiddenError) {
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
 * Format the two DB-open failures into the canonical envelope, both 500s.
 * Returns `null` when `err` is neither so `formatError` can fall through.
 * Extracted alongside `formatConflict` / `formatSidecarConsentError` so the
 * dispatcher's cyclomatic complexity stays inside the lint budget.
 *
 *   - `DbMissingError`     -> `db-missing`. A mutation (`POST /api/scan`,
 *     the plugin-toggle family) cannot persist without a project DB file.
 *   - `DbSchemaDriftError` -> `db-drift`. A mutating request opened a DB
 *     whose on-disk schema drifted from the bundled migrations; the
 *     write-side `withSqlite` guard refuses rather than crash on a missing
 *     column. The plain `err.message` advisory (rebuild via
 *     `sm db reset --hard` + `sm scan`) is surfaced so the SPA can guide
 *     the operator instead of showing the redacted `internal` fall-through.
 */
function formatDbError(err: unknown, c: Context): Response | null {
  if (err instanceof DbMissingError) {
    const envelope: IErrorEnvelope = {
      ok: false,
      error: { code: 'db-missing', message: err.message, details: null },
    };
    return c.json(envelope, 500);
  }
  if (err instanceof DbSchemaDriftError) {
    const envelope: IErrorEnvelope = {
      ok: false,
      error: { code: 'db-drift', message: err.message, details: null },
    };
    return c.json(envelope, 500);
  }
  return null;
}

/**
 * Format the `HTTPException` subclasses that carry a STRUCTURED
 * `error.details` payload (the generic `HTTPException` branch always
 * emits `details: null`): `BulkValidationError` ships the offending
 * `id`, `ConfirmRequiredError` ships the consent dialog's data (today
 * `{ paths }` from the project-preferences path-exposure gate). Runs
 * before the generic branch so the payload survives. Returns `null`
 * when `err` is neither so `formatError` can fall through. Extracted
 * alongside `formatDbError` / `formatConflict` to keep the dispatcher
 * inside the lint complexity budget.
 */
function formatDetailCarryingError(err: unknown, c: Context): Response | null {
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
  if (err instanceof ConfirmRequiredError) {
    const envelope: IErrorEnvelope = {
      ok: false,
      error: {
        code: 'confirm-required',
        message: err.message,
        details: err.details,
      },
    };
    return c.json(envelope, 412);
  }
  return null;
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
 * Format the `409 Conflict` subclasses into the canonical error
 * envelope. Returns `null` when `err` is none of them, so the caller can
 * fall through to the next mapping branch. Extracted from `formatError`
 * so the dispatcher's cyclomatic complexity stays inside the lint
 * budget (the two `instanceof` checks + the details ternary would
 * otherwise push it over).
 *
 *   - `ConflictError`      (`scan-busy` / `job-terminal` / the
 *     finding + issue lifecycle refusals): closed `code`, no `details`.
 *   - `ActionRefusedError` (`POST /api/actions/:id`): open-ended `code`
 *     (the report's `reason`, sanitised at the throw site, widened past
 *     the closed `TErrorCode` union, the UI's `TErrorCodeApi` accepts
 *     an open `string`), `details` carries `{ actionId, nodePath,
 *     report }` so the SPA renders action-specific copy.
 *   - `JobSubmitConflictError` (`POST /api/nodes/:pathB64/jobs`): closed
 *     five-code union, `details` carries `{ existingId }` on the
 *     duplicate / running codes and stays `null` elsewhere.
 */
function formatConflict(err: unknown, c: Context): Response | null {
  if (err instanceof ActionRefusedError) {
    const envelope: IErrorEnvelope = {
      ok: false,
      error: { code: err.code as TErrorCode, message: err.message, details: err.details },
    };
    return c.json(envelope, 409);
  }
  if (err instanceof JobSubmitConflictError) {
    const envelope: IErrorEnvelope = {
      ok: false,
      error: { code: err.code, message: err.message, details: err.details },
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
