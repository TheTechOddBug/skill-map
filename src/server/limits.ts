/**
 * Centralised numeric caps for the BFF. Every magic limit that lived
 * inline inside a `routes/*.ts` file moves here so the catalogue is
 * grep-able in one place. The values match what each route hardcoded
 * previously; tuning is unsupported pre-v1 (`ROADMAP.md` § UI
 * contribution system, Hard caps).
 *
 * The matching request-body cap (`BODY_LIMIT_BYTES`) intentionally
 * stays in `server/app.ts`: it is wired into the global middleware at
 * the composition root and exported from there so tests can probe the
 * exact threshold without re-encoding the literal. The constants in
 * this file are route-local and have no global-middleware equivalent.
 */

/**
 * Default page size for list endpoints (`/api/nodes`, `/api/issues`).
 * Used when the caller omits `?limit=`.
 */
export const DEFAULT_LIMIT = 100;

/**
 * Hard cap on the page size accepted by list endpoints. `?limit=N`
 * above this value rejects with `400 bad-query`. Above the bulk
 * contributions cap below, the UI also stops receiving embedded
 * `contributions[]` arrays.
 */
export const MAX_LIMIT = 1000;

/**
 * Hard cap on the page size for which `/api/nodes` (bulk list)
 * embeds per-node `contributions[]`. Above the cap, the response
 * omits the arrays and the UI falls back to the lazy
 * `/api/contributions/:pluginId/:contributionId?path=` endpoint.
 * Single-node `/api/nodes/:pathB64` ignores this cap entirely.
 *
 * The 200 cap protects against very-large monorepos where embedding
 * contributions for a 1000-node page could blow the response size.
 * Documented but not promoted in `ROADMAP.md` § UI contribution
 * system, Hard caps; tuning is unsupported pre-v1.
 */
export const BFF_MAX_BULK_CONTRIBUTIONS = 200;
