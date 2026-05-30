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
 * (`sendDefaultPii: false`). Capture is limited to the Angular
 * `ErrorHandler` plus the SDK's default browser global-error /
 * unhandled-rejection listeners. Every event is run through the pure
 * `scrubEvent` scrubber in `beforeSend` before it leaves the browser,
 * per `spec/telemetry.md` §Scrubbing rules.
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
 * `true` when a real UI DSN has been configured. While the placeholder
 * is empty the entire telemetry surface stays dormant; exposed so the
 * bootstrap (and any future consent affordance) can gate on it and so
 * the dormant contract is unit-testable without standing up the SDK.
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
}): Promise<void> {
  if (initialised) return;
  // DSN gate first: keeps the whole surface a no-op while the
  // placeholder is empty, regardless of the persisted consent value.
  // No dynamic import happens on this path, so the SDK chunk is never
  // fetched while dormant.
  if (SENTRY_DSN_UI === '' || !opts.consentEnabled) return;
  const Sentry = await import('@sentry/angular');
  Sentry.init({
    dsn: SENTRY_DSN_UI,
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
