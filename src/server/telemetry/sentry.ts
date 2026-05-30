/**
 * BFF-side Sentry wiring for opt-in error reporting (`spec/telemetry.md`).
 *
 * Like the CLI side, this is **inert by default**: `initSentryBff` is a
 * no-op unless the kill switch is unset, a real DSN is configured (the
 * placeholder below is empty), and the operator has opted in. The gate is
 * shared with the CLI via `isTelemetryActive`.
 *
 * The server initialises its OWN Sentry client (a different project from
 * the CLI), so `sm serve` MUST init only the BFF, not the CLI, to avoid
 * one global client overwriting the other. The entry point enforces that
 * by skipping `initSentryCli` for the `serve` verb.
 *
 * Unlike the CLI, the BFF registers no uncaught/unhandled integrations: a
 * long-running server should not capture-and-exit on every stray rejection.
 * Request-path errors are captured by the middleware below, which wraps
 * `next()`, tags the route + method, reports, and re-throws so the global
 * `app.onError` still formats the HTTP response.
 */

import * as Sentry from '@sentry/node';
import type { Context, Next } from 'hono';

import { scrubEvent } from '../../core/telemetry/scrub.js';
import { isTelemetryActive } from '../../cli/telemetry/sentry-init.js';

/**
 * DSN for the BFF. Intentionally the SAME value as `CLI_SENTRY_DSN`
 * (`src/cli/telemetry/sentry-init.ts`): the CLI and the BFF report to one
 * shared Node Sentry project, told apart by the `surface` tag (`cli` vs
 * `bff`) plus the per-event `verb` / `route` / `method` tags. Public by
 * design.
 *
 * Typed `string` so the `=== ''` dormancy gate stays a valid comparison.
 * Set to `''` to force the surface dormant. Keep this in sync with
 * `CLI_SENTRY_DSN` (same project = same DSN).
 */
const BFF_SENTRY_DSN: string = 'https://8b73dbb2563da4b77def12ce5ee46e75@o4511475590037504.ingest.de.sentry.io/4511475708002384';

let initialised = false;

/**
 * Initialise the BFF Sentry client when telemetry is active. Idempotent.
 * `version` becomes the release tag.
 */
export function initSentryBff(version: string): void {
  if (initialised) return;
  if (!isTelemetryActive(BFF_SENTRY_DSN)) return;
  Sentry.init({
    dsn: BFF_SENTRY_DSN,
    release: `@skill-map/cli@${version}`,
    environment: 'production',
    // Shared project with the CLI; the `surface` tag separates the two.
    initialScope: { tags: { surface: 'bff' } },
    defaultIntegrations: false,
    integrations: [],
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event),
  });
  initialised = true;
}

/**
 * Hono middleware that captures unhandled request-path errors. Mount it
 * outermost (before any other middleware) so it observes everything; it
 * re-throws so the existing `app.onError` still produces the response.
 * A no-op when telemetry is inactive (the client was never initialised).
 */
export function createSentryRequestCapture() {
  return async function sentryRequestCapture(c: Context, next: Next): Promise<void> {
    try {
      await next();
    } catch (err) {
      if (initialised) {
        Sentry.withScope((scope) => {
          scope.setTag('route', c.req.routePath ?? c.req.path);
          scope.setTag('method', c.req.method);
          Sentry.captureException(err);
        });
      }
      throw err;
    }
  };
}
