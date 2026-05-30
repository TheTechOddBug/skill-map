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

import { SENTRY_DSN_NODE } from '../../public-config.js';
import { scrubEvent } from '../../core/telemetry/scrub.js';
import { isErrorTelemetryEnabled } from '../util/user-settings-store.js';
import { resolveTelemetryEnv } from './telemetry-env.js';

/**
 * The CLI reports to the shared Node Sentry project (`SENTRY_DSN_NODE` in
 * `src/public-config.ts`, also used by the BFF; the per-event `surface` tag,
 * `cli` vs `bff`, separates their events). Set that constant to `''` to force
 * the whole Node telemetry surface dormant.
 */

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
 * Loads the `@sentry/node` namespace. The default does the real dynamic
 * import; tests inject a fake so they can assert on `init` / capture without
 * a network call or the SDK's heavy load.
 */
type TSentryNodeLoader = () => Promise<typeof import('@sentry/node')>;

/**
 * `true` when a real CLI DSN has been configured. While the placeholder is
 * empty the entire telemetry surface (init AND the first-run prompt) stays
 * dormant, so this gates the consent prompt: there is no point asking the
 * operator to opt in to a sink that does not exist yet.
 */
export function isCliDsnConfigured(): boolean {
  return SENTRY_DSN_NODE !== '';
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
 * Idempotent: a second call after a successful init is a no-op. The SDK is
 * loaded through `loadSdk` (defaults to a dynamic `import('@sentry/node')`,
 * so a dormant boot never loads it; tests inject a fake). `version` is
 * folded into the release tag `skill-map-cli@<version>` (slash-free per
 * Sentry's release-name rules; a `/` is rejected).
 */
export async function initSentryCli(
  version: string,
  loadSdk: TSentryNodeLoader = () => import('@sentry/node'),
): Promise<void> {
  if (sdk) return;
  if (!isTelemetryActive(SENTRY_DSN_NODE)) return;
  const Sentry = await loadSdk();
  Sentry.init({
    dsn: SENTRY_DSN_NODE,
    release: `skill-map-cli@${version}`,
    environment: resolveTelemetryEnv(),
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

/**
 * Test seam: drop the cached client so a spec can re-run `initSentryCli`
 * with a fresh injected loader. Never called in production.
 */
export function resetCliTelemetryForTests(): void {
  sdk = null;
}
