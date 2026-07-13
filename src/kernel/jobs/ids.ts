/**
 * Job-id, execution-id, and nonce generation.
 *
 *   - `generateJobId(now?, suffix?)` produces the spec id shape
 *     `d-YYYYMMDD-HHMMSS-XXXX` (`job.schema.json#/properties/id`,
 *     pattern `^d-\d{8}-\d{6}-[0-9a-f]{4}$`). Human-readable and
 *     lexicographically sortable by submit time (UTC). `XXXX` is 2 random
 *     bytes (16 bits) of hex tie-breaker so two jobs submitted in the
 *     same second (e.g. an `--all` fan-out) get distinct ids; the
 *     `state_jobs.id` PRIMARY KEY is the hard backstop on the rare clash.
 *
 *   - `generateExecutionId(now?, suffix?)` produces the sibling
 *     `e-YYYYMMDD-HHMMSS-XXXX` shape
 *     (`execution-record.schema.json#/properties/id`). Same UTC-sortable
 *     layout as the job id with an `e-` prefix; `sm record` stamps one on
 *     every `state_executions` row it writes.
 *
 *   - `generateRunId(mode?)` produces the `r-[<mode>-]YYYYMMDD-HHMMSS-XXXX`
 *     run id carried by every job-event envelope (`spec/job-events.md`).
 *
 *   - `generateNonce()` is the per-job callback credential
 *     (`spec/job-lifecycle.md` §Submit step 7 / §Record): cryptographically
 *     random, >= 128 bits of entropy, hex. `randomBytes(16)` = 128 bits =
 *     32 hex chars. Never reused, never logged at info+.
 *
 * All accept injectable sources so unit tests can pin deterministic
 * output; production callers use the crypto defaults.
 */

import { randomBytes } from 'node:crypto';

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Default `XXXX` tie-breaker: 2 random bytes, 4 lowercase hex chars. */
function defaultJobSuffix(): string {
  return randomBytes(2).toString('hex');
}

/** `YYYYMMDD-HHMMSS` UTC stamp shared by the job / execution id shapes. */
function formatIdTimestamp(now: Date): string {
  const yyyy = pad(now.getUTCFullYear(), 4);
  const mm = pad(now.getUTCMonth() + 1, 2);
  const dd = pad(now.getUTCDate(), 2);
  const hh = pad(now.getUTCHours(), 2);
  const mi = pad(now.getUTCMinutes(), 2);
  const ss = pad(now.getUTCSeconds(), 2);
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

/**
 * Build the `d-YYYYMMDD-HHMMSS-XXXX` id from a timestamp (UTC) plus a
 * 4-hex-char random suffix. `now` and `suffix` are injectable for tests.
 */
export function generateJobId(
  now: Date = new Date(),
  suffix: () => string = defaultJobSuffix,
): string {
  return `d-${formatIdTimestamp(now)}-${suffix()}`;
}

/**
 * Build the `e-YYYYMMDD-HHMMSS-XXXX` execution-record id (UTC) plus a
 * 4-hex-char random suffix. Same injectable sources as `generateJobId`.
 */
export function generateExecutionId(
  now: Date = new Date(),
  suffix: () => string = defaultJobSuffix,
): string {
  return `e-${formatIdTimestamp(now)}-${suffix()}`;
}

/**
 * Build the `r-[<mode>-]YYYYMMDD-HHMMSS-XXXX` run id
 * (`spec/job-events.md` §Common envelope). The `mode` segment names the
 * invocation flavor (canonical modes: `ext` agent-driven claim/record
 * runs, the only job-run flavor; `scan`; `check`). Same UTC-sortable
 * layout + 4-hex tie-breaker as the job id.
 */
export function generateRunId(
  mode?: 'ext' | 'scan' | 'check',
  now: Date = new Date(),
  suffix: () => string = defaultJobSuffix,
): string {
  const prefix = mode === undefined ? 'r' : `r-${mode}`;
  return `${prefix}-${formatIdTimestamp(now)}-${suffix()}`;
}

/**
 * Cryptographically random nonce, hex-encoded. Defaults to 16 bytes (128
 * bits); callers may request more entropy but never less.
 */
export function generateNonce(bytes = 16): string {
  if (bytes < 16) {
    throw new Error(`generateNonce: refusing ${bytes} bytes; the nonce needs >= 128 bits (16 bytes)`);
  }
  return randomBytes(bytes).toString('hex');
}
