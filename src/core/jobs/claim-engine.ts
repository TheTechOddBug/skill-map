/**
 * The shared job-claim engine, the SINGLE source of the reap + atomic
 * claim + content-fetch + corruption-handling core
 * (`spec/job-lifecycle.md` §Reap procedure + §Atomic claim). Extracted
 * from `cli/commands/job-queue.ts: JobClaimCommand` so every driver that
 * hands a job to a processing agent shares one implementation:
 *
 *   - `sm jobs claim` (`cli/commands/job-queue.ts`) wraps it with its
 *     `--wait` loop, its live-transition push, its stdout handover, and
 *     its exit codes;
 *   - the MCP `claim_job` tool (`server/mcp/queue-tools.ts`) wraps it with
 *     the broadcaster push and the structured tool result.
 *
 * The engine performs ONE reap + ONE atomic claim; it does NOT emit
 * events and does NOT print (callers own both surfaces). A claimed job
 * whose content row is missing (DB corruption) is marked failed /
 * `job-file-missing` through the shared `recordFailedOutcome` primitive
 * (`core/jobs/record-outcome.ts`, an execution row documents the
 * corruption) and reported back as
 * `corrupt`, never handed out with a null content.
 */

import type { Job, JobRunner } from '../../kernel/types.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import { recordFailedOutcome } from './record-outcome.js';

/** Default `report_json` detail stored on the `job-file-missing` execution. */
const DEFAULT_CONTENT_MISSING_DETAIL =
  'claimed job has no stored content (state_job_contents row missing)';

/**
 * Outcome of one `claimJob` attempt:
 *   - `claimed`, the job flipped to running; `content` is the rendered
 *     prompt and `nonce` the record credential (`job` is the freshly
 *     claimed row, for the caller's event data);
 *   - `empty`, the queue had nothing claimable (after reaping);
 *   - `corrupt`, the claimed job's content row was missing; the job is
 *     already marked failed / `job-file-missing` and skipped.
 */
export type TClaimOutcome =
  | { kind: 'claimed'; id: string; nonce: string; content: string; job: Job }
  | { kind: 'empty' }
  | { kind: 'corrupt'; jobId: string };

/**
 * Reap expired running jobs, then run the single-statement atomic claim
 * (`spec/job-lifecycle.md` §Atomic claim); on a claim, fetch its content.
 * A missing content row is the DB-corruption-only `job-file-missing`
 * state: mark the job failed through `recordFailedOutcome` and return
 * `corrupt` rather than handing out a null content. `filter` restricts the
 * claim to one extension id (same matching as `sm jobs list --extension`).
 */
export async function claimJob(
  adapter: StoragePort,
  opts: {
    runner: JobRunner;
    nowMs: number;
    filter?: string | undefined;
    /** `report_json` detail stored on the corruption execution row. */
    contentMissingDetail?: string;
  },
): Promise<TClaimOutcome> {
  await adapter.jobs.reapExpired(opts.nowMs);
  const claim = await adapter.jobs.claim(opts.runner, opts.nowMs, opts.filter);
  if (!claim) return { kind: 'empty' };

  const content = await adapter.jobs.getContent(claim.contentHash);
  if (content === null) {
    const job = await adapter.jobs.get(claim.id);
    if (job) {
      await recordFailedOutcome({
        adapter,
        job,
        failureReason: 'job-file-missing',
        errorText: opts.contentMissingDetail ?? DEFAULT_CONTENT_MISSING_DETAIL,
        metrics: {},
        now: opts.nowMs,
      });
    }
    return { kind: 'corrupt', jobId: claim.id };
  }

  // Re-read the claimed row so callers get the stamped runner / claimedAt /
  // expiresAt for their event data. The claim always exists here (we just
  // claimed it); the non-null assertion is safe by construction.
  const job = await adapter.jobs.get(claim.id);
  return { kind: 'claimed', id: claim.id, nonce: claim.nonce, content, job: job! };
}
