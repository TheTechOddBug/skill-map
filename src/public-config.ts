/**
 * Public, ship-in-the-bundle configuration. Hardcoded identifiers that are
 * safe to commit and to publish inside the CLI bundle because they are NOT
 * secrets (a Sentry DSN identifies an ingest endpoint, not a credential).
 * This is the single home in this workspace for that kind of value; future
 * public keys / endpoint ids belong here too. Anything secret stays in the
 * environment / CI secrets, never in this file.
 */

/**
 * DSN for the shared Node Sentry project, used by BOTH the CLI and the BFF
 * (same workspace, same project; the per-event `surface` tag, `cli` vs
 * `bff`, separates their events). Typed `string` so a `=== ''` dormancy gate
 * stays a valid comparison; set to `''` to force the Node telemetry surface
 * dormant.
 */
export const SENTRY_DSN_NODE: string =
  'https://8b73dbb2563da4b77def12ce5ee46e75@o4511475590037504.ingest.de.sentry.io/4511475708002384';

/**
 * Public project key for the PostHog usage-analytics project, used by the
 * CLI usage surface (the UI carries its own key in
 * `ui/src/app/core/public-config.ts`). Like a Sentry DSN, a PostHog project
 * key is a public ingest identifier, not a secret. Typed `string` so a
 * `=== ''` dormancy gate stays a valid comparison; set to `''` to force the
 * usage surface dormant (no init, no network, the SDK is not even imported).
 */
export const POSTHOG_KEY_NODE: string = 'phc_vMX3PcNeDsacWNg2hYEbKVXDijSWcjKFzabCkzU7RNEr';

/**
 * PostHog Cloud ingest host. EU region, for data-residency parity with the
 * Sentry `.de` projects.
 */
export const POSTHOG_HOST = 'https://eu.i.posthog.com';
