/**
 * Resolve the telemetry `environment` signal (`spec/telemetry.md`).
 *
 * Both surfaces (Sentry errors, PostHog usage) tag every event with an
 * `environment` so the maintainers can filter their own dogfooding /
 * development runs out of the real-world data. The signal is driven by a
 * single env var the dev tooling sets automatically (the `smt` wrapper, the
 * `bff:dev` / `bff:scan` scripts), so a developer never has to remember it: an
 * operator running the published `sm` leaves it unset and reports
 * `production`.
 *
 * Lives in the CLI adapter layer (NOT `core/` / `kernel/`, which must never
 * read `process.env`); the BFF imports it the same way it imports the
 * user-settings store. Deliberately NOT the kill switch
 * (`SKILL_MAP_TELEMETRY`): this never disables telemetry, it only labels where
 * an event came from.
 */

export type TTelemetryEnv = 'dev' | 'prod';

/** Env var that flips events to the `dev` environment. */
export const TELEMETRY_ENV_VAR = 'SKILL_MAP_TELEMETRY_ENV';

/**
 * `prod` when `SKILL_MAP_TELEMETRY_ENV` is absent, empty, or an explicit
 * production marker (`prod` / `production`); any other non-empty value marks a
 * `dev` run. The dev tooling sets the var (to `dev`) so a dogfooding run is
 * tagged; the operator's published `sm` leaves it unset and reports `prod`.
 * Pure read of the environment, so it is trivially unit-testable.
 */
export function resolveTelemetryEnv(): TTelemetryEnv {
  const raw = process.env[TELEMETRY_ENV_VAR];
  if (raw === undefined || raw.trim() === '' || raw === 'prod' || raw === 'production') {
    return 'prod';
  }
  return 'dev';
}
