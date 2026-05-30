/**
 * Public, ship-in-the-bundle configuration for the UI. Hardcoded identifiers
 * that are safe to commit and to publish in the browser bundle because they
 * are NOT secrets (a Sentry DSN identifies an ingest endpoint, not a
 * credential). This is the single home in this workspace for that kind of
 * value; future public keys belong here too. Secrets never live here.
 */

/**
 * DSN for the `skill-map-ui` Sentry project. Typed `string` so the `=== ''`
 * dormancy gate stays a valid comparison; set to `''` to force the UI
 * telemetry surface dormant.
 */
export const SENTRY_DSN_UI: string =
  'https://bb9dce0fd2cb4ab27ac0475aa394aeb4@o4511475590037504.ingest.de.sentry.io/4511475725959248';

/**
 * Public project key for the PostHog usage-analytics project (browser SDK).
 * Like a Sentry DSN, a PostHog project key is a public ingest identifier, not
 * a secret. Typed `string` so the `=== ''` dormancy gate stays valid; set to
 * `''` to force the UI usage surface dormant (no SDK fetch, no init, no
 * network).
 */
export const POSTHOG_KEY_UI: string = 'phc_vMX3PcNeDsacWNg2hYEbKVXDijSWcjKFzabCkzU7RNEr';

/** PostHog Cloud ingest host, EU region (parity with the Sentry `.de` projects). */
export const POSTHOG_HOST_UI = 'https://eu.i.posthog.com';
