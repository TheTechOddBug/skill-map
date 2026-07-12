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

import type { Kysely, Selectable } from 'kysely';

import type { IDatabase, IStateJobsTable } from './schema.js';
import type { Job } from '../../types.js';
import type {
  IJobContentInput,
  IJobListFilter,
  IJobSubmitRow,
  IPruneResult,
} from '../../types/storage.js';

export type { IPruneResult } from '../../types/storage.js';

/** The queued/running statuses the duplicate pre-check and index cover. */
const ACTIVE_STATUSES = ['queued', 'running'] as const;

/** Map a `state_jobs` row to the domain `Job` shape. */
function rowToJob(row: Selectable<IStateJobsTable>): Job {
  return {
    id: row.id,
    actionId: row.actionId,
    actionVersion: row.actionVersion,
    nodeId: row.nodeId,
    contentHash: row.contentHash,
    nonce: row.nonce,
    priority: row.priority,
    status: row.status,
    failureReason: row.failureReason,
    runner: row.runner,
    ttlSeconds: row.ttlSeconds,
    createdAt: row.createdAt,
    claimedAt: row.claimedAt,
    finishedAt: row.finishedAt,
    expiresAt: row.expiresAt,
    submittedBy: row.submittedBy,
  };
}

/**
 * Submit a job: store its rendered content then insert the lifecycle row,
 * both inside ONE transaction (per `spec/job-lifecycle.md` §Submit steps
 * 8-9). The content row is written FIRST via `INSERT OR IGNORE` so the
 * `state_jobs.content_hash -> state_job_contents.content_hash` reference is
 * always satisfiable; a second submit of the same hash reuses the existing
 * blob. Returns the inserted job id.
 *
 * The insert into `state_jobs` may throw a UNIQUE-constraint error from the
 * partial index `ix_state_jobs_action_node_hash` when a matching
 * queued/running job already exists (the hard backstop `--force` cannot
 * defeat); callers surface that as the duplicate-conflict exit (3).
 */
export async function submitJob(
  db: Kysely<IDatabase>,
  row: IJobSubmitRow,
  content: IJobContentInput,
): Promise<string> {
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('state_job_contents')
      .values({
        contentHash: content.contentHash,
        content: content.content,
        createdAt: content.createdAt,
      })
      .onConflict((oc) => oc.column('contentHash').doNothing())
      .execute();

    await trx
      .insertInto('state_jobs')
      .values({
        id: row.id,
        actionId: row.actionId,
        actionVersion: row.actionVersion,
        nodeId: row.nodeId,
        contentHash: row.contentHash,
        nonce: row.nonce,
        priority: row.priority,
        status: row.status,
        ttlSeconds: row.ttlSeconds,
        createdAt: row.createdAt,
        failureReason: null,
        runner: null,
        claimedAt: null,
        finishedAt: null,
        expiresAt: null,
        submittedBy: row.submittedBy ?? null,
      })
      .execute();
  });
  return row.id;
}

/**
 * Duplicate pre-check (`spec/job-lifecycle.md` §Submit step 4): return the
 * id of any existing `queued`/`running` job matching
 * `(actionId, actionVersion, nodeId, contentHash)`, else `null`. This is
 * the soft gate `--force` skips; the unique partial index remains the hard
 * invariant that keeps a second live duplicate off the table.
 */
export async function findActiveDuplicate(
  db: Kysely<IDatabase>,
  actionId: string,
  actionVersion: string,
  nodeId: string,
  contentHash: string,
): Promise<string | null> {
  const row = await db
    .selectFrom('state_jobs')
    .select('id')
    .where('actionId', '=', actionId)
    .where('actionVersion', '=', actionVersion)
    .where('nodeId', '=', nodeId)
    .where('contentHash', '=', contentHash)
    .where('status', 'in', ACTIVE_STATUSES as unknown as string[] as never)
    .limit(1)
    .executeTakeFirst();
  return row?.id ?? null;
}

/**
 * List jobs for `sm job list`, filtered and ordered newest-first
 * (`created_at DESC`) for display. `actionId` matches the stored qualified
 * id exactly OR by bare-id suffix (`%/<id>`), mirroring the analyzer-filter
 * semantics so a short id finds its qualified row.
 */
export async function listJobs(
  db: Kysely<IDatabase>,
  filter: IJobListFilter,
): Promise<Job[]> {
  let query = db.selectFrom('state_jobs').selectAll();
  if (filter.status !== undefined) {
    query = query.where('status', '=', filter.status);
  }
  if (filter.actionId !== undefined) {
    const token = filter.actionId;
    query = query.where(({ eb, or }) =>
      or([eb('actionId', '=', token), eb('actionId', 'like', `%/${token}`)]),
    );
  }
  if (filter.nodeId !== undefined) {
    query = query.where('nodeId', '=', filter.nodeId);
  }
  const rows = await query.orderBy('createdAt', 'desc').orderBy('id', 'desc').execute();
  return rows.map(rowToJob);
}

/** Full job row by id, or `null` when absent (drives `sm job show`). */
export async function getJob(db: Kysely<IDatabase>, id: string): Promise<Job | null> {
  const row = await db
    .selectFrom('state_jobs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? rowToJob(row) : null;
}

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

/**
 * Fetch the rendered content blob for `contentHash` from
 * `state_job_contents`, or `null` when absent. `sm job preview` resolves a
 * job's `content_hash` through this; a `null` result means the content row
 * is missing (the DB-corruption-only `job-file-missing` state, since submit
 * and prune keep `state_jobs` and `state_job_contents` consistent).
 */
export async function getJobContent(
  db: Kysely<IDatabase>,
  contentHash: string,
): Promise<string | null> {
  const row = await db
    .selectFrom('state_job_contents')
    .select('content')
    .where('contentHash', '=', contentHash)
    .executeTakeFirst();
  return row?.content ?? null;
}
