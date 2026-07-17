/**
 * Shared session-token gate for the loopback ingest routes
 * (`POST /api/activity`, `POST /api/job-events`).
 *
 * Both push legs authenticate the same way (`spec/provider-activity.md`
 * §serve.json, `spec/job-events.md` §Transport): the caller reads the
 * per-session token `sm serve` published in `.skill-map/serve.json` and
 * sends it in the `x-skill-map-token` header. The gate runs BEFORE any
 * body processing so a missing / wrong token rejects 403
 * `token-mismatch` without touching the (potentially privacy-sensitive)
 * payload.
 *
 * Extracted from `routes/activity.ts` when the job-events ingest landed
 * so the constant-time comparison has exactly one implementation.
 */

import { timingSafeEqual } from 'node:crypto';

import { ActivityTokenError } from '../app.js';

/** Header the ingest clients send the serve.json session token in. */
export const INGEST_TOKEN_HEADER = 'x-skill-map-token';

/**
 * Constant-time token comparison. Lengths are compared first (an
 * unavoidable length oracle, the token length is public in the schema
 * anyway); equal-length buffers go through `timingSafeEqual`. Throws
 * the typed `ActivityTokenError` (403 `token-mismatch`, opaque
 * envelope) on any mismatch.
 */
export function assertIngestToken(presented: string | null, expected: string): void {
  if (presented !== null && presented.length === expected.length) {
    const a = Buffer.from(presented, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length === b.length && timingSafeEqual(a, b)) return;
  }
  throw new ActivityTokenError();
}
