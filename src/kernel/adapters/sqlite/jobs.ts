/**
 * Storage helper for `state_jobs` retention GC. Powers `sm job prune`.
 *
 * DB-only model: job content lives in `state_job_contents` keyed by
 * `content_hash`, there is no `.skill-map/jobs/*.md` on-disk artifact and
 * this helper never touches the filesystem (kept portable across runner
 * backends and future adapters).
 *
 * Retention GC (`pruneTerminalJobs`) does two things in ONE transaction,
 * per `spec/job-lifecycle.md` §Retention and GC:
 *
 *   1. Delete `state_jobs` rows whose `status` is terminal (`completed`
 *      or `failed`) and whose `finishedAt` is older than the supplied
 *      cutoff.
 *   2. Collect orphaned `state_job_contents` rows, every content row
 *      whose `content_hash` is referenced by zero surviving `state_jobs`
 *      rows. Ordering is fixed: prune the terminal jobs first, THEN sweep
 *      the now-unreferenced content.
 *
 * Per `spec/job-lifecycle.md`, this MUST NOT run implicitly during normal
 * verb execution. The helper itself is a pure side-effect on the DB; the
 * policy decision lives in the CLI (`sm job prune`).
 *
 * Per `spec/db-schema.md`, `state_executions` is append-only through
 * `v1.0`. This helper does NOT touch that table, pruning a job row leaves
 * the matching execution row (and its inline `report_json`) in place so
 * post-mortem queries still work after a job's audit trail in `state_jobs`
 * is gone.
 */

import type { Kysely } from 'kysely';

import type { IDatabase } from './schema.js';
import type { IPruneResult } from '../../types/storage.js';

export type { IPruneResult } from '../../types/storage.js';

/**
 * Delete terminal `state_jobs` rows past the cutoff and GC orphaned
 * `state_job_contents` rows, both inside one transaction.
 *
 * Deletes `state_jobs` rows in terminal `status` whose `finishedAt` is
 * older than `cutoffMs` (Unix ms), then deletes every
 * `state_job_contents` row whose `content_hash` no longer appears in any
 * `state_jobs` row. Returns the deleted job count plus the collected
 * content-row count.
 *
 * `cutoffMs` is computed by the caller from the configured retention:
 * `Date.now() - retentionSeconds * 1000`.
 */
export async function pruneTerminalJobs(
  db: Kysely<IDatabase>,
  status: 'completed' | 'failed',
  cutoffMs: number,
): Promise<IPruneResult> {
  return db.transaction().execute(async (trx) => {
    const jobDelete = await trx
      .deleteFrom('state_jobs')
      .where('status', '=', status)
      .where('finishedAt', 'is not', null)
      .where('finishedAt', '<', cutoffMs)
      .executeTakeFirst();
    const deletedCount = Number(jobDelete.numDeletedRows ?? 0n);

    // Orphan content sweep: drop every content blob no surviving job
    // references. `state_jobs.content_hash` is NOT NULL, so the subquery
    // never yields NULL and `NOT IN (empty)` correctly returns every row
    // when the job table is empty.
    const contentDelete = await trx
      .deleteFrom('state_job_contents')
      .where(
        'contentHash',
        'not in',
        trx.selectFrom('state_jobs').select('contentHash'),
      )
      .executeTakeFirst();
    const prunedContents = Number(contentDelete.numDeletedRows ?? 0n);

    return { deletedCount, prunedContents };
  });
}
