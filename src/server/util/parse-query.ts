/**
 * Shared query-string helpers for the BFF routes.
 *
 * Three primitives every list-style route was hand-rolling at 14.x:
 *
 *   - `parseCsv(value)` — collapses repeats of the comma-separated-list
 *     pattern (`severity=error,warn`, `kind=invokes,references`) into
 *     one canonical implementation.
 *   - `parsePagination({ offset, limit }, defaults)` — `/api/nodes`
 *     used to declare its own `parseNonNegativeInt` + `parsePagination`
 *     pair; the Issues / Links / Scan / future-paginated routes need the
 *     same shape, with the same `paginationInvalidInteger` /
 *     `paginationLimitTooLarge` error catalogue. Folding them together
 *     means a single bug fix moves every consumer.
 *   - `parseBooleanFlag(value)` — accepts the two literal strings
 *     `'1'` and `'true'` and returns false for everything else
 *     (absent, `'0'`, `''`, garbage). Mirrors what
 *     `routes/scan.ts:43` was already doing for `?fresh=`.
 *
 * Invalid input throws `HTTPException(400)` with a message routed
 * through `SERVER_TEXTS` so error catalog / shape match every other
 * BFF surface (Hono's global `app.onError` formats it into the
 * `IErrorEnvelope`).
 *
 * Why no Zod: the repo deliberately pins `ajv@8` for schema
 * validation. Adding a second validation library for three small
 * helpers would inflate dist size for no win — these primitives are
 * trivial enough to live as plain TS.
 */

// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { tx } from '../../kernel/util/tx.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';

export interface IPaginationDefaults {
  /** Limit applied when the query param is absent. */
  limit: number;
  /** Hard ceiling — `limit` requests above this throw 400. */
  max: number;
}

export interface IPagination {
  offset: number;
  limit: number;
}

/**
 * Split a comma-separated query value into a non-empty list.
 * `undefined` (param absent) → empty list; whitespace-only entries
 * are dropped so a trailing `,` doesn't change the matched set.
 */
export function parseCsv(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Resolve `offset` / `limit` from the route's query bag, defaulting
 * the limit when absent and rejecting requests that would exceed
 * `defaults.max`. The error catalogue comes from `SERVER_TEXTS` so
 * every paginated route reads identically on a 400 response.
 */
export function parsePagination(
  query: { offset?: string; limit?: string },
  defaults: IPaginationDefaults,
): IPagination {
  const offset = parseNonNegativeInt(query.offset, 'offset', 0);
  const limit = parseNonNegativeInt(query.limit, 'limit', defaults.limit);
  if (limit > defaults.max) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.paginationLimitTooLarge, {
        value: limit,
        max: defaults.max,
      }),
    });
  }
  return { offset, limit };
}

/**
 * Strict boolean parse — `'1'` and `'true'` are truthy, everything
 * else is false. Routes that accept `?fresh=1` use this so the
 * truthy-string set is uniform across the BFF.
 */
export function parseBooleanFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

/**
 * Require a non-empty query / path string. Absent / empty input throws
 * `HTTPException(400)` with the `queryRequiredString` template
 * (interpolates the param name). Mirror of `parseNonNegativeInt`'s
 * shape: the caller passes the raw value AND the user-facing name so
 * the error message names the offending parameter rather than a
 * generic "missing input".
 */
export function parseRequiredString(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.queryRequiredString, { name }),
    });
  }
  return value;
}

function parseNonNegativeInt(
  raw: string | undefined,
  name: string,
  fallback: number,
): number {
  if (raw === undefined || raw.length === 0) return fallback;
  const trimmed = raw.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== trimmed) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.paginationInvalidInteger, { name, value: raw }),
    });
  }
  return parsed;
}
