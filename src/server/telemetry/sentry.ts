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

import { SENTRY_DSN_NODE } from '../../public-config.js';
import { scrubEvent } from '../../core/telemetry/scrub.js';
import { isTelemetryActive } from '../../cli/telemetry/sentry-init.js';
import { resolveTelemetryEnv } from '../../cli/telemetry/telemetry-env.js';

/**
 * The BFF reports to the shared Node Sentry project (`SENTRY_DSN_NODE` in
 * `src/public-config.ts`, the same DSN the CLI uses): one project, told apart
 * by the `surface` tag (`cli` vs `bff`) plus the per-event `route` / `method`
 * tags. Set that constant to `''` to force the surface dormant.
 */

/**
 * Lazily-loaded `@sentry/node` namespace; `null` while dormant. Imported
 * only when telemetry is active so the OpenTelemetry instrumentation it
 * pulls in (a `module.register()` side effect, slow + a Node >= 26
 * DeprecationWarning) never runs on a server that has telemetry off.
 */
let sdk: typeof import('@sentry/node') | null = null;

/**
 * Loads the `@sentry/node` namespace. The default does the real dynamic
 * import; tests inject a fake to assert on capture without a network call.
 */
type TSentryNodeLoader = () => Promise<typeof import('@sentry/node')>;

/**
 * Initialise the BFF Sentry client when telemetry is active. Idempotent. The
 * SDK is loaded through `loadSdk` (defaults to a dynamic `import`, so a
 * dormant server never loads it; tests inject a fake). `version` becomes the
 * release tag.
 */
export async function initSentryBff(
  version: string,
  loadSdk: TSentryNodeLoader = () => import('@sentry/node'),
): Promise<void> {
  if (sdk) return;
  if (!isTelemetryActive(SENTRY_DSN_NODE)) return;
  const Sentry = await loadSdk();
  Sentry.init({
    dsn: SENTRY_DSN_NODE,
    release: `@skill-map/cli@${version}`,
    environment: resolveTelemetryEnv(),
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
    // The project root is redacted alongside the home patterns: a
    // checkout outside `$HOME` (`/srv/work/client-acme`, a WSL
    // `/mnt/d/...`) is invisible to those patterns and would otherwise
    // disclose the project name in every frame. Resolved by the driver
    // so the scrubber stays pure.
    beforeSend: (event) => scrubEvent(event, [process.cwd()]),
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

/**
 * Test seam: drop the cached client so a spec can re-run `initSentryBff`
 * with a fresh injected loader. Never called in production.
 */
export function resetBffTelemetryForTests(): void {
  sdk = null;
}
