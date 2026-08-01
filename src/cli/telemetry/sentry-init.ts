/**
 * CLI-side Sentry wiring for consent-gated error reporting
 * (`spec/telemetry.md` §Per-incident crash-report consent).
 *
 * Everything here is **inert by default**, and `@sentry/node` is not even
 * imported until a report is actually about to be sent (see the lazy `sdk`
 * cache below). There is no boot-time init and no auto-capturing
 * integration: capture happens exclusively through `sendCrashReportOnce`,
 * which the crash-consent flow (`crash-consent.ts` and the fatal handler)
 * calls only after consent is resolved, either the operator's per-incident
 * yes on an interactive terminal, or the persisted
 * `telemetry.errorsEnabled` opt-in in non-promptable contexts. Two gates
 * stay hard regardless of consent (see `telemetryInactiveReason`):
 *
 *   1. The kill switch `SKILL_MAP_TELEMETRY=0` forces the surface off.
 *   2. An empty DSN (`SENTRY_DSN_NODE === ''`) keeps it dormant.
 *
 * Every event is run through the pure `scrubEvent` scrubber in
 * `beforeSend` before it leaves the machine.
 */

import { SENTRY_DSN_NODE } from '../../public-config.js';
import { scrubEvent } from '../../core/telemetry/scrub.js';
import { isErrorTelemetryEnabled } from '../util/user-settings-store.js';
import { VERSION } from '../../version.js';
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
 * The dynamically-loaded `@sentry/node` namespace, captured the first time a
 * report is sent; `null` while dormant. `@sentry/node` drags in OpenTelemetry
 * instrumentation that calls `module.register()` at import time (a
 * non-trivial startup cost, and a `DEP0205` DeprecationWarning on Node >=
 * 26). Importing it lazily, only at the moment a consented report is sent,
 * keeps that cost and that warning off every normal `sm` invocation.
 */
let sdk: typeof import('@sentry/node') | null = null;

/**
 * Loads the `@sentry/node` namespace. The default does the real dynamic
 * import; tests inject a fake so they can assert on `init` / capture without
 * a network call or the SDK's heavy load.
 */
export type TSentryNodeLoader = () => Promise<typeof import('@sentry/node')>;

/**
 * `true` when a real CLI DSN has been configured. While the placeholder is
 * empty the entire telemetry surface (crash reporting AND the first-run
 * prompt) stays dormant, so this gates the consent prompt: there is no point
 * asking the operator to opt in to a sink that does not exist yet.
 */
export function isCliDsnConfigured(): boolean {
  return SENTRY_DSN_NODE !== '';
}

/** `true` when the `SKILL_MAP_TELEMETRY=0` kill switch is set. */
export function isTelemetryForcedOff(): boolean {
  return process.env[KILL_SWITCH_ENV] === '0';
}

/**
 * Which of the three gates is keeping error telemetry off. `null` means all
 * of them are open. Callers that need to EXPLAIN the dormancy to the
 * operator (`sm intentional-fail`) map this to a message; the crash-consent
 * gate (`decideCrashFlow`) maps it to prompt / auto-send / silent. Note that
 * under per-incident consent `no-consent` is a soft gate (it biases the
 * prompt default and silences only non-promptable contexts), while
 * `kill-switch` and `dsn-dormant` are hard gates: no prompt, no send, ever.
 */
export type TTelemetryInactiveReason = 'kill-switch' | 'dsn-dormant' | 'no-consent';

/**
 * Pure-ish gate (reads env + persisted consent, no side effects) resolving
 * WHY telemetry is off, in precedence order: the env kill switch first (it
 * overrides everything), then a dormant DSN (no sink exists in this build),
 * then the persisted consent flag. Exposed so the decision can be
 * unit-tested without standing up the SDK or the network.
 */
export function telemetryInactiveReason(dsn: string): TTelemetryInactiveReason | null {
  if (isTelemetryForcedOff()) return 'kill-switch';
  if (dsn === '') return 'dsn-dormant';
  if (!isErrorTelemetryEnabled()) return 'no-consent';
  return null;
}

/**
 * Pure-ish gate (reads env + persisted consent, no side effects). Persisted
 * telemetry is active only when the kill switch is unset, a real DSN is
 * present, and the operator has opted in.
 */
export function isTelemetryActive(dsn: string): boolean {
  return telemetryInactiveReason(dsn) === null;
}

/**
 * Load the SDK and initialise the client, errors-only, no auto-capturing
 * integrations: the crash-consent flow decides what gets captured, so the
 * SDK must never capture on its own (an `onUncaughtException` integration
 * would send BEFORE the consent prompt could run, which is exactly the
 * contract violation the per-incident model exists to prevent).
 */
async function armClient(
  loadSdk: TSentryNodeLoader,
): Promise<typeof import('@sentry/node')> {
  const Sentry = await loadSdk();
  Sentry.init({
    dsn: SENTRY_DSN_NODE,
    // Slash-free per Sentry's release-name rules; a `/` is rejected.
    release: `skill-map-cli@${VERSION}`,
    environment: resolveTelemetryEnv(),
    // CLI and BFF share one Sentry project; the `surface` tag tells their
    // events apart in the shared issue stream.
    initialScope: { tags: { surface: 'cli' } },
    // Errors only: do NOT register the OpenTelemetry ESM loader hooks. We
    // run no tracing / auto-instrumentation, and the hook calls the
    // deprecated `module.register()` (a `DEP0205` warning on Node >= 26).
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
  return Sentry;
}

/**
 * Send ONE consented crash report: lazily arm the client (cached across
 * calls), tag the verb, capture, and flush bounded so a slow network never
 * hangs the CLI. Returns `true` when the event was handed to the transport
 * and flushed within the bound. Consent is NOT re-checked here on purpose,
 * the caller resolved it (the prompt IS the consent); only the two hard
 * gates (kill switch, dormant DSN) are re-verified defensively. Never
 * throws.
 */
export async function sendCrashReportOnce(
  err: unknown,
  opts: {
    verb: string;
    level: 'error' | 'fatal';
    loadSdk?: TSentryNodeLoader | undefined;
    flushTimeoutMs?: number;
  },
): Promise<boolean> {
  if (isTelemetryForcedOff() || !isCliDsnConfigured()) return false;
  try {
    sdk ??= await armClient(opts.loadSdk ?? (() => import('@sentry/node')));
    if (opts.verb !== '') sdk.setTag('verb', opts.verb);
    // `fatal` marks the process-fatal path in the issue stream; the
    // verb-boundary path reports as a plain `error`.
    sdk.captureException(err, { level: opts.level });
    // `flush`, not `close`: the per-verb path may still need the client
    // for the entry tail's `closeSentryCli`, and a second crash in the
    // same process (fatal after verb) reuses the armed client.
    return await sdk.flush(opts.flushTimeoutMs ?? 3_000);
  } catch {
    return false;
  }
}

/**
 * Flush buffered events and close the client, bounded by `timeoutMs` so a
 * slow network never hangs CLI shutdown. Best-effort and a no-op when no
 * report was ever sent.
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
 * Test seam: drop the cached client so a spec can re-run
 * `sendCrashReportOnce` with a fresh injected loader. Never called in
 * production.
 */
export function resetCliTelemetryForTests(): void {
  sdk = null;
}
