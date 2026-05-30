/**
 * CLI-side PostHog wiring for opt-in usage analytics (`spec/telemetry.md`
 * §Surface: Usage).
 *
 * Everything here is **inert by default**, and `posthog-node` is not even
 * imported unless the usage surface is actually active (see the lazy
 * `client` below). `initUsageCli` is a no-op unless ALL of the following
 * hold (see `isUsageCliTelemetryActive`):
 *
 *   1. The kill switch `SKILL_MAP_TELEMETRY=0` is NOT set (shared with the
 *      Sentry error surface, one switch for all telemetry).
 *   2. A real PostHog key is configured (`POSTHOG_KEY_NODE`; set it to `''`
 *      to force the whole usage surface dormant).
 *   3. The operator has explicitly opted in to CLI usage
 *      (`telemetry.usageCliEnabled === true` in `~/.skill-map/settings.json`).
 *
 * When active, only the allow-listed `cli.<verb>` event (one per invocation,
 * carrying the executed-extractor set on a scan) is sent, keyed by the shared
 * anonymous `distinct_id`. Every event is run
 * through the pure `scrubEvent` scrubber in `before_send` before it leaves
 * the machine, and client IP / geo enrichment is disabled.
 */

import type { EventMessage } from 'posthog-node';

import { POSTHOG_HOST, POSTHOG_KEY_NODE } from '../../public-config.js';
import { scrubEvent } from '../../core/telemetry/scrub.js';
import { VERSION } from '../../version.js';
import {
  isUsageCliTelemetryEnabled,
  readAnonymousId,
} from '../util/user-settings-store.js';
import {
  buildCliVerbProperties,
  cliVerbEventName,
  envUsageProps,
} from './usage-collector.js';
import { isTelemetryForcedOff } from './sentry-init.js';

/**
 * The dynamically-loaded PostHog client, captured once init runs; `null`
 * while dormant. Importing `posthog-node` lazily, only when the usage
 * surface is genuinely active, keeps its weight (and its transitive deps)
 * off every normal `sm` invocation.
 */
let client: import('posthog-node').PostHog | null = null;

/**
 * Loads the `posthog-node` namespace. The default does the real dynamic
 * import; tests inject a fake so they can assert on construction / capture
 * without a network call or the SDK's load.
 */
type TPosthogNodeLoader = () => Promise<typeof import('posthog-node')>;

/**
 * `true` when a real PostHog key has been configured. While the placeholder
 * is empty the entire usage surface (init AND the shared first-run prompt's
 * usage half) stays dormant.
 */
export function isUsageKeyConfigured(): boolean {
  return POSTHOG_KEY_NODE !== '';
}

/**
 * Pure-ish gate (reads env + persisted consent, no side effects). The CLI
 * usage surface is active only when the kill switch is unset, a real key is
 * present, and the operator opted in to CLI usage. Exposed so the decision
 * can be unit-tested without standing up the SDK or the network.
 */
export function isUsageCliTelemetryActive(key: string): boolean {
  if (isTelemetryForcedOff()) return false;
  if (key === '') return false;
  return isUsageCliTelemetryEnabled();
}

/**
 * The `before_send` hook: run every outgoing event through the pure
 * scrubber so a path can never leak even if a future property carries one.
 * Exported as a named function so the guarantee is directly unit-testable.
 */
export function scrubUsageEvent(event: EventMessage | null): EventMessage | null {
  return event === null ? null : scrubEvent(event);
}

/**
 * Initialise the CLI PostHog client when (and only when) the usage surface
 * is active. Idempotent: a second call after a successful init is a no-op.
 * The SDK is loaded through `loadSdk` (defaults to a dynamic
 * `import('posthog-node')`, so a dormant boot never loads it; tests inject a
 * fake).
 */
export async function initUsageCli(
  loadSdk: TPosthogNodeLoader = () => import('posthog-node'),
): Promise<void> {
  if (client) return;
  if (!isUsageCliTelemetryActive(POSTHOG_KEY_NODE)) return;
  const { PostHog } = await loadSdk();
  client = new PostHog(POSTHOG_KEY_NODE, {
    host: POSTHOG_HOST,
    // Second line of defense behind the project-level IP drop: the client
    // never attaches an IP or geo, and never autocaptures.
    disableGeoip: true,
    before_send: scrubUsageEvent,
  });
}

/**
 * Send an allow-listed usage event, keyed by the shared anonymous
 * `distinct_id`. No-op when the surface is dormant or no id has been minted.
 * The `before_send` hook scrubs the payload before it leaves the machine.
 */
export function captureUsage(event: string, properties: Record<string, unknown>): void {
  if (client === null) return;
  const distinctId = readAnonymousId();
  if (distinctId === null) return;
  client.capture({
    distinctId,
    event,
    properties: { ...envUsageProps(VERSION), ...properties },
  });
}

/**
 * The executed built-in extractor set from the in-flight scan, stashed so the
 * single per-invocation `cli.<verb>` event can carry it. `null` for any verb
 * that is not a scan. Module state because the scan verb (which has the set)
 * and the entry point (which emits the one event after the verb returns) are
 * different call sites.
 */
let pendingScanExtensions: readonly string[] | null = null;

/**
 * Record the executed-extractor set for the current scan so the `cli.<verb>`
 * event folds it in as `extensions`. Called from the scan verb; the entry
 * point reads and clears it when it emits.
 */
export function setScanExtensions(extensions: readonly string[]): void {
  pendingScanExtensions = extensions;
}

/**
 * Emit the single usage event for this invocation: the event name is
 * `cli.<verb>` (guarded against the registered closed set, unknown collapses
 * to `cli.unknown`), and the properties carry the flag names plus, on a scan,
 * the executed-extractor set (read + cleared here so it never bleeds into a
 * later verb). No-op while the surface is dormant.
 */
export function captureCliInvocation(
  verb: string,
  flagNames: Iterable<string>,
  knownVerbs: ReadonlySet<string>,
): void {
  const extensions = pendingScanExtensions;
  pendingScanExtensions = null;
  captureUsage(cliVerbEventName(verb, knownVerbs), buildCliVerbProperties(flagNames, extensions));
}

/**
 * Flush buffered events and stop the client, bounded by `timeoutMs` so a
 * slow network never hangs CLI shutdown. Best-effort and a no-op when the
 * usage surface was never initialised.
 */
export async function flushUsageCli(timeoutMs = 2000): Promise<void> {
  if (client === null) return;
  try {
    await client.shutdown(timeoutMs);
  } catch {
    // Shutdown flush is best-effort; never let it alter the exit path.
  }
}

/**
 * Test seam: drop the cached client so a spec can re-run `initUsageCli` with
 * a fresh injected loader. Never called in production.
 */
export function resetUsageTelemetryForTests(): void {
  client = null;
  pendingScanExtensions = null;
}
