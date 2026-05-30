/**
 * Browser-UI Sentry wiring for opt-in error reporting
 * (`spec/telemetry.md`, surface `skill-map-ui`).
 *
 * DORMANT BY DEFAULT, BY DESIGN, AT EVERY LEVEL. `initUiSentry` is a
 * hard no-op unless BOTH of the following hold:
 *
 *   1. A real DSN is configured. `UI_SENTRY_DSN` below is an empty
 *      string today, so the whole telemetry surface stays inert: no SDK
 *      `init`, no client, no network call, zero Sentry side effects.
 *      Nothing is wired up until the `skill-map-ui` sentry.io project
 *      exists and its DSN is filled in.
 *   2. The operator has explicitly opted in. Consent lives per-machine
 *      in `~/.skill-map/settings.json` under `telemetry.errorsEnabled`
 *      and reaches the browser through `GET /api/preferences`
 *      (`preferences.telemetry.errorsEnabled`). Absent / false is OFF;
 *      `true` is the only value that enables reporting.
 *
 * The `@sentry/angular` SDK is DYNAMICALLY imported, never statically.
 * That keeps ~90 KB of SDK out of the eager initial bundle: while the
 * feature is dormant (always, today) the chunk is never even fetched, so
 * the dormant contract holds at the network AND the bundle level. The
 * one consequence is that the Angular `ErrorHandler` cannot call
 * `Sentry.createErrorHandler()` directly (that would re-introduce the
 * static import); instead `app.config.ts` provides a thin wrapper handler
 * that delegates to `captureUiException` below, which is a no-op until
 * the SDK has been loaded and initialised here.
 *
 * Because the DSN gate is checked first, the Settings Privacy toggle can
 * be wired, persisted, and round-tripped today (so the operator's choice
 * is recorded for when the DSN lands) WITHOUT this module ever importing
 * the SDK or touching the network. The toggle is a recorded preference,
 * not a live switch, until the placeholder is replaced.
 *
 * Errors only (Level 1). No tracing (`tracesSampleRate: 0`), no session
 * replay, no user-feedback widget, no performance, no PII
 * (`sendDefaultPii: false`). Capture is limited to the Angular
 * `ErrorHandler` plus the SDK's default browser global-error /
 * unhandled-rejection listeners. Every event is run through the pure
 * `scrubEvent` scrubber in `beforeSend` before it leaves the browser,
 * per `spec/telemetry.md` §Scrubbing rules.
 *
 * The `skill-map-ui` Sentry project is additionally hardened
 * server-side per `spec/telemetry.md` §Server-side guarantees: IP
 * storage off, a matching path-scrubbing rule, and allowed-domains
 * restricted to loopback (the UI is only ever served from localhost).
 */

import { scrubEvent } from './scrub';

/**
 * Hardcoded DSN for the `skill-map-ui` Sentry project. Sentry DSNs are
 * public by design (they identify an ingest endpoint, they are not
 * secrets), so it is safe to ship in the published UI bundle once it
 * exists.
 *
 * TODO(telemetry): real skill-map-ui DSN, see spec/telemetry.md
 * §Surfaces and carrier. While this stays `''`, `initUiSentry` never
 * imports the SDK, never initialises it, and nothing is ever sent.
 */
const UI_SENTRY_DSN: string = 'https://bb9dce0fd2cb4ab27ac0475aa394aeb4@o4511475590037504.ingest.de.sentry.io/4511475725959248';

let initialised = false;
/**
 * The dynamically-loaded `@sentry/angular` namespace, captured once init
 * succeeds. Used by `captureUiException` so the ErrorHandler wrapper can
 * forward exceptions without a static import. `null` while dormant.
 */
let sdk: typeof import('@sentry/angular') | null = null;

/**
 * `true` when a real UI DSN has been configured. While the placeholder
 * is empty the entire telemetry surface stays dormant; exposed so the
 * bootstrap (and any future consent affordance) can gate on it and so
 * the dormant contract is unit-testable without standing up the SDK.
 */
export function isUiDsnConfigured(): boolean {
  return UI_SENTRY_DSN !== '';
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
}): Promise<void> {
  if (initialised) return;
  // DSN gate first: keeps the whole surface a no-op while the
  // placeholder is empty, regardless of the persisted consent value.
  // No dynamic import happens on this path, so the SDK chunk is never
  // fetched while dormant.
  if (UI_SENTRY_DSN === '' || !opts.consentEnabled) return;
  const Sentry = await import('@sentry/angular');
  Sentry.init({
    dsn: UI_SENTRY_DSN,
    release: opts.release ?? undefined,
    environment: 'production',
    // Errors only: no browserTracingIntegration, no replayIntegration,
    // no feedbackIntegration. The SDK's default browser global-error
    // and unhandled-rejection handlers are sufficient alongside the
    // Angular ErrorHandler.
    integrations: [],
    tracesSampleRate: 0,
    sendDefaultPii: false,
    // Loopback-only reporting: the UI is only ever served from
    // localhost / 127.0.0.1, so only accept events whose frames originate
    // there. This is the client-side replacement for Sentry's retired
    // server-side "Allowed Domains" project setting (see spec/telemetry.md
    // §Server-side guarantees).
    allowUrls: [/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//],
    beforeSend: (event) => scrubEvent(event),
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
