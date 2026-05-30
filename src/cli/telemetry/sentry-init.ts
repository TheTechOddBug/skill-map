/**
 * CLI-side Sentry wiring for opt-in error reporting (`spec/telemetry.md`).
 *
 * Everything here is **inert by default**, and `@sentry/node` is not even
 * imported unless telemetry is actually active (see the lazy `sdk` below).
 * `initSentryCli` is a no-op unless ALL of the following hold (see
 * `isTelemetryActive`):
 *
 *   1. The kill switch `SKILL_MAP_TELEMETRY=0` is NOT set.
 *   2. A real DSN is configured (set the constant to `''` to force the
 *      whole surface dormant).
 *   3. The operator has explicitly opted in
 *      (`telemetry.errorsEnabled === true` in `~/.skill-map/settings.json`).
 *
 * When active, only uncaught exceptions and unhandled rejections are
 * captured (no tracing, no default integrations). Every event is run
 * through the pure `scrubEvent` scrubber in `beforeSend` before it leaves
 * the machine.
 *
 * Known gap (deferred): Clipanion catches errors thrown inside a verb's
 * `run()` and turns them into a non-zero exit code, so those do NOT reach
 * the `onUncaughtException` integration. Per-verb capture and the
 * per-extension `plugin_id` / `extension_kind` scope tags are a follow-up;
 * Level 1 captures the process-fatal crashes that today leave no signal.
 */

import { scrubEvent } from '../../core/telemetry/scrub.js';
import { isErrorTelemetryEnabled } from '../util/user-settings-store.js';

/**
 * DSN for the shared Node Sentry project. CLI and BFF intentionally report
 * to the SAME project (`BFF_SENTRY_DSN` in `src/server/telemetry/sentry.ts`
 * carries the identical value), distinguished by the `surface` tag (`cli`
 * vs `bff`). Public by design (a DSN identifies an ingest endpoint, it is
 * not a secret), so it is safe to hardcode in the published bundle.
 *
 * Typed `string` (not the literal) so the `=== ''` dormancy gate stays a
 * valid comparison. Set it to `''` to force the whole surface dormant.
 */
const CLI_SENTRY_DSN: string = 'https://8b73dbb2563da4b77def12ce5ee46e75@o4511475590037504.ingest.de.sentry.io/4511475708002384';

/** Environment variable kill switch. `=0` forces telemetry OFF everywhere. */
const KILL_SWITCH_ENV = 'SKILL_MAP_TELEMETRY';

/**
 * The dynamically-loaded `@sentry/node` namespace, captured once init runs;
 * `null` while dormant. `@sentry/node` drags in OpenTelemetry instrumentation
 * that calls `module.register()` at import time (a non-trivial startup cost,
 * and a `DEP0205` DeprecationWarning on Node >= 26). Importing it lazily, only
 * when telemetry is genuinely active, keeps that cost and that warning off
 * every normal `sm` invocation.
 */
let sdk: typeof import('@sentry/node') | null = null;

/**
 * `true` when a real CLI DSN has been configured. While the placeholder is
 * empty the entire telemetry surface (init AND the first-run prompt) stays
 * dormant, so this gates the consent prompt: there is no point asking the
 * operator to opt in to a sink that does not exist yet.
 */
export function isCliDsnConfigured(): boolean {
  return CLI_SENTRY_DSN !== '';
}

/** `true` when the `SKILL_MAP_TELEMETRY=0` kill switch is set. */
export function isTelemetryForcedOff(): boolean {
  return process.env[KILL_SWITCH_ENV] === '0';
}

/**
 * Pure-ish gate (reads env + persisted consent, no side effects). Telemetry
 * is active only when the kill switch is unset, a real DSN is present, and
 * the operator has opted in. Exposed so the decision can be unit-tested
 * without standing up the SDK or the network.
 */
export function isTelemetryActive(dsn: string): boolean {
  if (isTelemetryForcedOff()) return false;
  if (dsn === '') return false;
  return isErrorTelemetryEnabled();
}

/**
 * Initialise the CLI Sentry client when (and only when) telemetry is active.
 * Idempotent: a second call after a successful init is a no-op. `@sentry/node`
 * is dynamic-imported here, so a dormant boot never loads it. `version`
 * becomes the release tag.
 */
export async function initSentryCli(version: string): Promise<void> {
  if (sdk) return;
  if (!isTelemetryActive(CLI_SENTRY_DSN)) return;
  const Sentry = await import('@sentry/node');
  Sentry.init({
    dsn: CLI_SENTRY_DSN,
    release: `@skill-map/cli@${version}`,
    environment: 'production',
    // CLI and BFF share one Sentry project; the `surface` tag tells their
    // events apart in the shared issue stream.
    initialScope: { tags: { surface: 'cli' } },
    // Errors only: do NOT register the OpenTelemetry ESM loader hooks. We
    // run no tracing / auto-instrumentation, and the hook calls the
    // deprecated `module.register()` (a `DEP0205` warning on Node >= 26 that
    // would print on every telemetry-on invocation). Disabling it keeps
    // stderr clean and skips the loader's startup cost.
    registerEsmLoaderHooks: false,
    defaultIntegrations: false,
    integrations: [
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
    ],
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event),
  });
  sdk = Sentry;
}

/**
 * Tag the active scope with the verb being run (e.g. `scan`, `serve`) so a
 * captured crash can be attributed. No-op when telemetry is inactive.
 */
export function setTelemetryVerbTag(verb: string | undefined): void {
  if (!sdk || verb === undefined || verb === '') return;
  sdk.setTag('verb', verb);
}

/**
 * Flush buffered events and close the client, bounded by `timeoutMs` so a
 * slow network never hangs CLI shutdown. Best-effort and a no-op when
 * telemetry was never initialised.
 */
export async function closeSentryCli(timeoutMs = 2000): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.close(timeoutMs);
  } catch {
    // Shutdown flush is best-effort; never let it alter the exit path.
  }
}
