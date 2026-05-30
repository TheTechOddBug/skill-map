/**
 * BFF-side Sentry wiring for opt-in error reporting (`spec/telemetry.md`).
 *
 * Like the CLI side, this is **inert by default**: `initSentryBff` is a
 * no-op unless the kill switch is unset, a real DSN is configured (set the
 * constant to `''` to force it dormant), and the operator has opted in. The
 * gate is shared with the CLI via `isTelemetryActive`.
 *
 * `sm serve` MUST init only the BFF, not the CLI, so the two never register
 * on one global client; the entry point enforces that by skipping
 * `initSentryCli` for the `serve` verb. `@sentry/node` is dynamic-imported
 * (lazy) so a server with telemetry off never loads it (it drags in
 * OpenTelemetry instrumentation with a `module.register()` side effect).
 *
 * Unlike the CLI, the BFF registers no uncaught/unhandled integrations: a
 * long-running server should not capture-and-exit on every stray rejection.
 * Request-path errors are captured by the middleware below, which wraps
 * `next()`, tags the route + method, reports, and re-throws so the global
 * `app.onError` still formats the HTTP response.
 */

import type { Context, Next } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

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

/**
 * Lazily-loaded `@sentry/node` namespace; `null` while dormant. Imported
 * only when telemetry is active so the OpenTelemetry instrumentation it
 * pulls in (a `module.register()` side effect, slow + a Node >= 26
 * DeprecationWarning) never runs on a server that has telemetry off.
 */
let sdk: typeof import('@sentry/node') | null = null;

/**
 * Initialise the BFF Sentry client when telemetry is active. Idempotent.
 * `@sentry/node` is dynamic-imported here, so a dormant server never loads
 * it. `version` becomes the release tag.
 */
export async function initSentryBff(version: string): Promise<void> {
  if (sdk) return;
  if (!isTelemetryActive(BFF_SENTRY_DSN)) return;
  const Sentry = await import('@sentry/node');
  Sentry.init({
    dsn: BFF_SENTRY_DSN,
    release: `@skill-map/cli@${version}`,
    environment: 'production',
    // Shared project with the CLI; the `surface` tag separates the two.
    initialScope: { tags: { surface: 'bff' } },
    // Errors only: skip the OpenTelemetry ESM loader hooks (we run no
    // tracing). They call the deprecated `module.register()` (a Node >= 26
    // DEP0205 warning) and add startup cost for nothing here.
    registerEsmLoaderHooks: false,
    defaultIntegrations: false,
    integrations: [],
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event),
  });
  sdk = Sentry;
}

/**
 * Decide whether a thrown request-path error is worth reporting. Expected
 * client errors (a 4xx `HTTPException`: bad body, not found, payload too
 * large) are routine, not crashes, so they are NOT captured, reporting
 * them would flood the issue stream with normal client behaviour. Only
 * unexpected failures are captured: a 5xx `HTTPException` or anything that
 * is not an `HTTPException` at all (an uncaught bug). Pure, so the policy
 * is unit-tested without standing up the SDK.
 */
export function shouldCaptureError(err: unknown): boolean {
  if (err instanceof HTTPException) return err.status >= 500;
  return true;
}

/**
 * Hono middleware that captures unhandled request-path errors. Mount it
 * outermost (before any other middleware) so it observes everything; it
 * re-throws so the existing `app.onError` still produces the response.
 * A no-op when telemetry is inactive (the SDK was never loaded) or when the
 * error is an expected 4xx (see `shouldCaptureError`).
 */
export function createSentryRequestCapture() {
  return async function sentryRequestCapture(c: Context, next: Next): Promise<void> {
    try {
      await next();
    } catch (err) {
      const client = sdk;
      if (client && shouldCaptureError(err)) {
        client.withScope((scope) => {
          scope.setTag('route', c.req.routePath ?? c.req.path);
          scope.setTag('method', c.req.method);
          client.captureException(err);
        });
      }
      throw err;
    }
  };
}
