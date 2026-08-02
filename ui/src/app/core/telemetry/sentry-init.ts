/**
 * Browser-UI Sentry wiring for opt-in error reporting
 * (`spec/telemetry.md`, surface `skill-map-ui`).
 *
 * DORMANT BY DEFAULT, BY DESIGN, AT EVERY LEVEL. `initUiSentry` is a
 * hard no-op unless BOTH of the following hold:
 *
 *   1. A real DSN is configured (`SENTRY_DSN_UI` in `core/public-config.ts`).
 *      Setting it to `''` there forces the whole telemetry surface inert:
 *      no SDK `init`, no client, no network call, zero Sentry side effects,
 *      the SDK chunk is never even fetched.
 *   2. The operator has explicitly opted in. Consent lives per-machine
 *      in `~/.skill-map/settings.json` under `telemetry.errorsEnabled`
 *      and reaches the browser through `GET /api/preferences`
 *      (`preferences.telemetry.errorsEnabled`). Absent / false is OFF;
 *      `true` is the only value that enables reporting.
 *
 * Today the DSN ships populated (a real `skill-map-ui` project), so gate
 * (1) is satisfied in normal builds and the live, default-off gate is
 * consent (2). The `''` DSN stays a kill switch for forks / forced
 * dormancy, it is not the day-to-day reason telemetry is off.
 *
 * The `@sentry/angular` SDK is DYNAMICALLY imported, never statically.
 * That keeps ~90 KB of SDK out of the eager initial bundle: while the
 * feature is dormant (consent off) the chunk is never even fetched, so
 * the dormant contract holds at the network AND the bundle level. The
 * one consequence is that the Angular `ErrorHandler` cannot call
 * `Sentry.createErrorHandler()` directly (that would re-introduce the
 * static import); instead `app.config.ts` provides a thin wrapper handler
 * that delegates to `captureUiException` below, which is a no-op until
 * the SDK has been loaded and initialised here.
 *
 * Because the DSN gate is checked first, the Settings toggle can be wired,
 * persisted, and round-tripped WITHOUT this module ever importing the SDK
 * or touching the network while consent is off. The toggle is a recorded
 * preference this module only acts on once consent is on.
 *
 * Errors only (Level 1). No tracing (`tracesSampleRate: 0`), no session
 * replay, no user-feedback widget, no performance, no PII
 * (`sendDefaultPii: false`). Under per-incident consent
 * (`spec/telemetry.md` §Per-incident crash-report consent) capture
 * happens exclusively through `captureUiException`, called by
 * `CrashReportConsentService` after the operator accepted the consent
 * dialog; the SDK's own auto-capturing listeners are dropped in
 * `buildUiIntegrations`. Every event is run through the pure `scrubEvent`
 * scrubber in `beforeSend` before it leaves the browser, per
 * `spec/telemetry.md` §Scrubbing rules.
 *
 * The `skill-map-ui` Sentry project is additionally hardened server-side
 * per `spec/telemetry.md` §Server-side guarantees (IP storage off, a
 * matching path-scrubbing rule); loopback-only reporting is enforced
 * client-side via the SDK `allowUrls` option below.
 */

import { SENTRY_DSN_UI } from '../public-config';
import { scrubEvent } from './scrub';

/**
 * DSN for the `skill-map-ui` Sentry project lives in `core/public-config.ts`
 * (the workspace home for public, ship-in-the-bundle identifiers). Set it to
 * `''` there to force the UI telemetry surface dormant: `initUiSentry` then
 * never imports the SDK, never initialises it, and nothing is ever sent.
 */

let initialised = false;
/**
 * The dynamically-loaded `@sentry/angular` namespace, captured once init
 * succeeds. Used by `captureUiException` so the ErrorHandler wrapper can
 * forward exceptions without a static import. `null` while dormant.
 */
let sdk: typeof import('@sentry/angular') | null = null;

/**
 * `true` when a real UI DSN has been configured (it ships populated, so
 * this is `true` in normal builds). Set the DSN to `''` (a fork /
 * kill-switch build) and the whole telemetry surface stays dormant
 * regardless of consent; exposed so the bootstrap (and any future
 * consent affordance) can gate on it and so the dormant contract is
 * unit-testable without standing up the SDK.
 */
export function isUiDsnConfigured(): boolean {
  return SENTRY_DSN_UI !== '';
}

/**
 * Initialise the UI Sentry client when (and only when) a real DSN is
 * configured AND the operator has opted in. Idempotent: a second call
 * after a successful init is a no-op, so it is safe to call from app
 * bootstrap without guarding the caller.
 *
 * The SDK is dynamic-imported only on the active path, so a dormant
 * boot never pulls the chunk. `release` becomes the Sentry release tag
 * (the running CLI / impl version, sourced from `/api/health`). `null`
 * (health not yet loaded, or fetch failed) leaves the release unset
 * rather than blocking init.
 */
export async function initUiSentry(opts: {
  consentEnabled: boolean;
  release: string | null;
  environment: 'dev' | 'prod';
  /**
   * Absolute project root (`/api/health` `cwd`), collapsed to
   * `<PROJECT>` by the scrubber so the project directory name never
   * rides an event (the CLI passes `process.cwd()` the same way).
   * `null` (health failed / not loaded) falls back to home-only
   * scrubbing.
   */
  projectRoot?: string | null;
}): Promise<void> {
  if (initialised) return;
  // DSN gate first: keeps the whole surface a no-op while the
  // placeholder is empty, regardless of the persisted consent value.
  // No dynamic import happens on this path, so the SDK chunk is never
  // fetched while dormant.
  if (SENTRY_DSN_UI === '' || !opts.consentEnabled) return;
  const scrubRoots = typeof opts.projectRoot === 'string' ? [opts.projectRoot] : [];
  const Sentry = await import('@sentry/angular');
  Sentry.init({
    dsn: SENTRY_DSN_UI,
    release: opts.release ?? undefined,
    environment: opts.environment,
    // Errors only, plus a tightened breadcrumb set. The transform is
    // factored into `buildUiIntegrations` (below) so the privacy posture
    // is unit-testable without loading the SDK or calling `Sentry.init`.
    integrations: (defaults) => buildUiIntegrations(Sentry.breadcrumbsIntegration, defaults),
    tracesSampleRate: 0,
    sendDefaultPii: false,
    // Loopback-only reporting: the UI is only ever served from
    // localhost / 127.0.0.1, so only accept events whose frames originate
    // there. This is the client-side replacement for Sentry's retired
    // server-side "Allowed Domains" project setting (see spec/telemetry.md
    // §Server-side guarantees).
    allowUrls: [/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//],
    beforeSend: (event) => scrubEvent(event, scrubRoots),
  });
  sdk = Sentry;
  initialised = true;
}

/**
 * Forward an uncaught error to Sentry. A NO-OP until `initUiSentry` has
 * loaded and initialised the SDK (i.e. always, while dormant), so the
 * Angular ErrorHandler wrapper in `app.config.ts` can call this
 * unconditionally on every error without importing the SDK itself.
 *
 * Scrubbing still happens inside the SDK `beforeSend` hook, so the raw
 * error handed here never leaves the browser un-scrubbed.
 */
export function captureUiException(error: unknown): void {
  if (!initialised || sdk === null) return;
  sdk.captureException(error);
}

/** The SDK's `breadcrumbsIntegration` factory (erased type-only import). */
type BreadcrumbsFactory = (typeof import('@sentry/angular'))['breadcrumbsIntegration'];
/**
 * A Sentry integration, in its GENERAL shape: an element of the SDK's own
 * default set (erased type-only access, so the SDK stays lazily loaded).
 * Not `ReturnType<BreadcrumbsFactory>`: since @sentry/angular 10.66 the
 * factories return name-narrowed subtypes (`Integration & { name:
 * "Breadcrumbs" }`), which would poison the whole defaults array with
 * the literal and break both the `init` callback assignment and the
 * `BrowserSession` name comparison below. The `Integration` interface
 * itself is not re-exported by `@sentry/angular`, so it is derived from
 * `getDefaultIntegrations` instead.
 */
export type UiIntegration = ReturnType<
  (typeof import('@sentry/angular'))['getDefaultIntegrations']
>[number];

/**
 * Build the UI integration set from the SDK defaults. Pure (no SDK init,
 * no network), exported so the privacy posture is unit-testable without
 * loading `@sentry/angular` or calling `Sentry.init`.
 *
 *   - Drops `BrowserSession` so NO release-health session beacon is sent
 *     on page load / route change: the error surface MUST stay silent
 *     until a real error (`spec/telemetry.md` §Surface: Errors).
 *   - Drops `GlobalHandlers` (the SDK's own window `error` /
 *     `unhandledrejection` listeners): under per-incident consent
 *     (`spec/telemetry.md` §Per-incident crash-report consent) capture
 *     happens exclusively through `captureUiException` AFTER the operator
 *     answered the dialog; an auto-capturing listener would send before
 *     the dialog could open. Window errors still reach the flow via
 *     Angular's `provideBrowserGlobalErrorListeners` → `ErrorHandler`.
 *   - Re-configures `Breadcrumbs` to stop auto-recording the sources that
 *     carry free-form strings the home-only scrubber cannot fully redact:
 *     console log text, fetch / xhr request URLs (with `?path=` / `?node=`
 *     query), and DOM interaction selectors. Navigation (history)
 *     breadcrumbs stay for triage; their route is home-scrubbed in
 *     `beforeSend`.
 *
 * Every other default integration passes through untouched. No
 * browserTracing / replay / feedback is ever added.
 */
export function buildUiIntegrations(
  breadcrumbsIntegration: BreadcrumbsFactory,
  defaults: UiIntegration[],
): UiIntegration[] {
  return defaults
    .filter(
      (integration) =>
        integration.name !== 'BrowserSession' && integration.name !== 'GlobalHandlers',
    )
    .map((integration) =>
      integration.name === 'Breadcrumbs'
        ? breadcrumbsIntegration({ console: false, fetch: false, xhr: false, dom: false })
        : integration,
    );
}
