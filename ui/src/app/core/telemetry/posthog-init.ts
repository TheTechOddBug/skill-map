/**
 * Browser-UI PostHog wiring for opt-in usage analytics
 * (`spec/telemetry.md` §Surface: Usage).
 *
 * DORMANT BY DEFAULT, AT EVERY LEVEL. `initUiUsage` is a hard no-op unless
 * ALL of the following hold:
 *
 *   1. A real key is configured (`POSTHOG_KEY_UI` in `core/public-config.ts`).
 *      Setting it to `''` there forces the whole surface inert: no SDK
 *      `init`, no client, no network, the `posthog-js` chunk is never fetched.
 *   2. The operator has opted in to UI usage. Consent lives per-machine in
 *      `~/.skill-map/settings.json` under `telemetry.usageUiEnabled` and
 *      reaches the browser through `GET /api/preferences`.
 *   3. A shared anonymous `distinct_id` exists (`telemetry.anonymousId`,
 *      surfaced read-only on the same envelope) so CLI and UI usage are
 *      attributed to one install.
 *
 * The `posthog-js` SDK is DYNAMICALLY imported, never statically, so a
 * dormant boot never pulls the chunk (mirrors the UI Sentry surface). Only
 * the allow-listed events (`ui.view`, `ui.feature`) are sent; autocapture,
 * pageview/pageleave capture, and session recording are all off, and every
 * event is run through the pure `scrubEvent` scrubber in `before_send` before
 * it leaves the browser.
 */

import { POSTHOG_HOST_UI, POSTHOG_KEY_UI } from '../public-config';
import { scrubEvent } from './scrub';

type TPosthog = (typeof import('posthog-js'))['default'];

let initialised = false;
/** The dynamically-loaded PostHog browser client; `null` while dormant. */
let client: TPosthog | null = null;

/**
 * `true` when a real UI PostHog key has been configured. While the
 * placeholder is empty the entire usage surface stays dormant; exposed so the
 * dormant contract is unit-testable without standing up the SDK.
 */
export function isUiUsageKeyConfigured(): boolean {
  return POSTHOG_KEY_UI !== '';
}

/**
 * Initialise the UI PostHog client when (and only when) a real key is
 * configured, the operator opted in, and a shared anonymous id exists.
 * Idempotent: a second call after a successful init is a no-op. The SDK is
 * dynamic-imported only on the active path, so a dormant boot never pulls the
 * chunk.
 */
export async function initUiUsage(opts: {
  consentEnabled: boolean;
  distinctId: string | null;
}): Promise<void> {
  if (initialised) return;
  // Key gate first: keeps the whole surface a no-op (and the chunk unfetched)
  // while the placeholder is empty, regardless of the persisted consent.
  if (POSTHOG_KEY_UI === '' || !opts.consentEnabled || opts.distinctId === null) return;
  const { default: posthog } = await import('posthog-js');
  posthog.init(POSTHOG_KEY_UI, {
    api_host: POSTHOG_HOST_UI,
    // Send nothing beyond the allow-listed events: no DOM autocapture, no
    // pageview/pageleave, no session recording. The shared anonymous id is
    // bootstrapped so the first event already carries the right distinct_id.
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    person_profiles: 'identified_only',
    bootstrap: { distinctID: opts.distinctId },
    before_send: (event) => (event === null ? null : scrubEvent(event)),
  });
  client = posthog;
  initialised = true;
}

/**
 * Send an allow-listed usage event. A NO-OP until `initUiUsage` has loaded and
 * initialised the SDK (i.e. always, while dormant), so view-tracking callers
 * can fire unconditionally without importing the SDK themselves.
 */
export function captureUiUsage(event: string, properties: Record<string, unknown> = {}): void {
  if (client === null) return;
  client.capture(event, properties);
}

/**
 * Register super-properties: values attached to EVERY subsequent UI event
 * until they change (used for the active theme, so any metric can be broken
 * down by it). No-op while the surface is dormant; re-register to update a
 * value mid-session.
 */
export function registerUsageSuperProps(properties: Record<string, unknown>): void {
  if (client === null) return;
  client.register(properties);
}
