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

import { sql } from 'kysely';
import type { Kysely, Selectable } from 'kysely';

import type { IDatabase, IStateJobsTable } from './schema.js';
import type { ExecutionRecord, Job, JobRunner, JobStatus } from '../../types.js';
import type {
  IJobClaim,
  IJobContentInput,
  IJobListFilter,
  IJobSubmitRow,
  IPruneResult,
  ISummaryWriteIntent,
  TJobTransitionOutcome,
} from '../../types/storage.js';
import { JobNotRunningError } from '../../jobs/errors.js';
import { insertExecution } from './history.js';
import { upsertSummaryForNode } from './summaries.js';

export type { IPruneResult } from '../../types/storage.js';

/** The queued/running statuses the duplicate pre-check and index cover. */
const ACTIVE_STATUSES: readonly JobStatus[] = ['queued', 'running'];

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
 * 9-10). The content row is written FIRST via `INSERT OR IGNORE` so the
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
    .where('status', 'in', ACTIVE_STATUSES)
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
  status: 'completed' | 'failed' | 'cancelled',
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

/** Row shape RETURNING projects; result keys are camelCased by the plugin. */
interface IClaimRow {
  id: string;
  nonce: string;
  contentHash: string;
}

/**
 * Atomic claim (`spec/job-lifecycle.md` §Atomic claim): transition the
 * highest-priority, oldest queued job to `running` in ONE statement and
 * return its `{ id, nonce, contentHash }`, or `null` when the queue is
 * empty (or nothing matches `filter`).
 *
 * Written as a raw `sql` UPDATE (verbatim spec transcription, snake_case
 * columns because the `CamelCasePlugin` does NOT rewrite raw fragments) so
 * it stays a single statement, a two-step `SELECT` then `UPDATE` would be a
 * double-claim conformance bug. The inner subquery picks the next job by
 * `priority DESC, created_at ASC`; the OUTER `AND status = 'queued'` is the
 * mandatory race guard, when two runners select the same id at the same
 * instant only one UPDATE lands (the other sees `status` already flipped
 * and matches zero rows). `expires_at` is computed in-statement from the
 * frozen `ttl_seconds` column. `filter`, when supplied, restricts the pick
 * to a single `action_id`.
 *
 * The dialect routes `RETURNING` DML through `.all()` so the projected
 * columns come back; result keys arrive camelCased (`content_hash` ->
 * `contentHash`).
 */
export async function claimNext(
  db: Kysely<IDatabase>,
  runner: JobRunner,
  nowMs: number,
  filter?: string,
): Promise<IJobClaim | null> {
  // Same matching semantics as `listJobs`: the stored qualified id
  // exactly, OR by bare-id suffix (`%/<id>`), so `--filter skill-echo`
  // claims a `prob-summarizer/skill-echo` job. Kept inside the single
  // atomic statement (a pre-resolution SELECT would reopen the
  // double-claim window the outer status guard closes).
  const filterCond =
    filter !== undefined
      ? sql`AND (action_id = ${filter} OR action_id LIKE '%/' || ${filter})`
      : sql``;
  const result = await sql<IClaimRow>`
    UPDATE state_jobs
       SET status = 'running',
           claimed_at = ${nowMs},
           runner = ${runner},
           expires_at = ${nowMs} + ttl_seconds * 1000
     WHERE id = (
             SELECT id FROM state_jobs
              WHERE status = 'queued'
                ${filterCond}
              ORDER BY priority DESC, created_at ASC
              LIMIT 1
           )
       AND status = 'queued'
     RETURNING id, nonce, content_hash
  `.execute(db);
  const row = result.rows[0];
  return row
    ? { id: row.id, nonce: row.nonce, contentHash: row.contentHash }
    : null;
}

/**
 * Cancel a single job (`spec/job-lifecycle.md` §Cancellation). A `queued`
 * or `running` job transitions to the terminal `cancelled` state with
 * `finishedAt = nowMs` and NO `failureReason` (cancellation is
 * self-explanatory, NOT a `failed` sub-reason); a terminal job is refused
 * (`already-terminal`) and an unknown id is `not-found`. DOES NOT interrupt
 * any subprocess (there is none yet): a running runner discovers the
 * terminal state on its next callback.
 *
 * The outcome derives from the guarded UPDATE's affected-row count, not a
 * pre-SELECT: a lost race (another writer terminalising the job between a
 * read and the write) would otherwise misreport `cancelled` for a job
 * that stayed untouched. 0 rows updated -> re-read once to discriminate
 * `already-terminal` from `not-found` (the row may also have been pruned
 * away entirely).
 */
export async function cancelJob(
  db: Kysely<IDatabase>,
  id: string,
  nowMs: number,
): Promise<TJobTransitionOutcome> {
  const res = await db
    .updateTable('state_jobs')
    .set({ status: 'cancelled', failureReason: null, finishedAt: nowMs })
    .where('id', '=', id)
    .where('status', 'in', ACTIVE_STATUSES)
    .executeTakeFirst();
  if (Number(res.numUpdatedRows ?? 0n) > 0) return 'cancelled';
  const existing = await db
    .selectFrom('state_jobs')
    .select('status')
    .where('id', '=', id)
    .executeTakeFirst();
  return existing ? 'already-terminal' : 'not-found';
}

/**
 * Cancel every active job in one statement: transition all `queued` /
 * `running` rows to the terminal `cancelled` state (`finishedAt = nowMs`,
 * no `failureReason`). Returns the number of rows transitioned. Powers
 * `sm job cancel --all`.
 */
export async function cancelAllActive(
  db: Kysely<IDatabase>,
  nowMs: number,
): Promise<number> {
  const res = await db
    .updateTable('state_jobs')
    .set({ status: 'cancelled', failureReason: null, finishedAt: nowMs })
    .where('status', 'in', ACTIVE_STATUSES)
    .executeTakeFirst();
  return Number(res.numUpdatedRows ?? 0n);
}

/**
 * Fail a single job (`spec/job-lifecycle.md` §Fail), the symmetric
 * counterpart of `cancelJob`. A `queued` or `running` job transitions to
 * the terminal `failed` state with `failureReason = user-failed` and
 * `finishedAt = nowMs`; a terminal job is refused (`already-terminal`) and
 * an unknown id is `not-found`. Same UPDATE-first race guard as cancel:
 * the outcome comes from the affected-row count, and a 0-row update
 * re-reads once to discriminate `already-terminal` from `not-found`.
 */
export async function failJob(
  db: Kysely<IDatabase>,
  id: string,
  nowMs: number,
): Promise<TJobTransitionOutcome> {
  const res = await db
    .updateTable('state_jobs')
    .set({ status: 'failed', failureReason: 'user-failed', finishedAt: nowMs })
    .where('id', '=', id)
    .where('status', 'in', ACTIVE_STATUSES)
    .executeTakeFirst();
  if (Number(res.numUpdatedRows ?? 0n) > 0) return 'failed';
  const existing = await db
    .selectFrom('state_jobs')
    .select('status')
    .where('id', '=', id)
    .executeTakeFirst();
  return existing ? 'already-terminal' : 'not-found';
}

/**
 * Fail every active job in one statement: transition all `queued` /
 * `running` rows to `failed` / `user-failed` (`finishedAt = nowMs`).
 * Returns the number of rows transitioned. Powers `sm job fail --all`.
 */
export async function failAllActive(
  db: Kysely<IDatabase>,
  nowMs: number,
): Promise<number> {
  const res = await db
    .updateTable('state_jobs')
    .set({ status: 'failed', failureReason: 'user-failed', finishedAt: nowMs })
    .where('status', 'in', ACTIVE_STATUSES)
    .executeTakeFirst();
  return Number(res.numUpdatedRows ?? 0n);
}

/**
 * Counts per lifecycle status,
 * `{ queued, running, completed, failed, cancelled }`, every key present
 * (missing statuses report `0`). Backs `sm job status` with no id argument.
 * One grouped `COUNT(*)` pass.
 */
export async function countJobsByStatus(
  db: Kysely<IDatabase>,
): Promise<Record<JobStatus, number>> {
  const rows = await db
    .selectFrom('state_jobs')
    .select('status')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .groupBy('status')
    .execute();
  const counts: Record<JobStatus, number> = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const row of rows) counts[row.status] = Number(row.count);
  return counts;
}

/**
 * Auto-reap (`spec/job-lifecycle.md` §Reap procedure): transition every
 * `running` job whose `expiresAt` has passed to `failed` / `abandoned`
 * with `finishedAt = nowMs`, in one statement. Returns the reaped count.
 * `expiresAt < nowMs` excludes NULL `expiresAt` rows automatically (SQLite
 * `NULL < n` is NULL, not true), so only claimed-and-expired jobs are
 * swept. Invoked at the start of `sm job run` (a later phase); there is no
 * standalone `sm job reap` verb.
 */
export async function reapExpired(
  db: Kysely<IDatabase>,
  nowMs: number,
): Promise<number> {
  const res = await db
    .updateTable('state_jobs')
    .set({ status: 'failed', failureReason: 'abandoned', finishedAt: nowMs })
    .where('status', '=', 'running')
    .where('expiresAt', '<', nowMs)
    .executeTakeFirst();
  return Number(res.numUpdatedRows ?? 0n);
}

/**
 * Record callback (`spec/job-lifecycle.md` §Record steps 5-6): write the
 * terminal `state_executions` row AND transition its `running` job to the
 * terminal state, both inside ONE transaction so the execution row and the
 * job's final status can never disagree (a crash between them would leave a
 * completed job with no history row, or an orphan execution for a still-
 * running job).
 *
 * The execution carries everything the job transition needs: `jobId`
 * (which `state_jobs` row), `status` (`completed` / `failed`, an
 * `ExecutionStatus` subset of `JobStatus`), `failureReason`
 * (`report-invalid` / `runner-error` / null), and `finishedAt`. The UPDATE
 * runs FIRST and guards on `status = 'running'`: when it matches zero
 * rows, the job was reaped / cancelled / recorded out from under this
 * callback between the caller's pre-check and the transaction, so the
 * whole record is a lost race. A typed `JobNotRunningError` is thrown
 * INSIDE the transaction, rolling back everything (no execution row, no
 * summary) so a lost race never mutates state (spec §Record step 3: a
 * rejected transition "MUST NOT mutate state"). Callers surface it as the
 * "job not in running state" path (exit 2 for `sm record`).
 *
 * **Summary write-through** (`spec/job-lifecycle.md` §Record). When the
 * caller passes a `summary` intent (the recorded Action's report schema
 * is a per-node summary schema, only on the `completed` path), the validated report is
 * ALSO upserted into `state_summaries` inside the SAME transaction, keyed
 * by `(node_id, summarizer_action_id)`. The upsert reads the target node's
 * live `kind` + `body_hash` from `scan_nodes`; if the node has disappeared
 * (deleted / renamed since submit) the summary is skipped while the
 * execution row + job transition still land.
 */
export async function recordJobTerminal(
  db: Kysely<IDatabase>,
  execution: ExecutionRecord,
  summary?: ISummaryWriteIntent,
): Promise<void> {
  const jobId = execution.jobId;
  if (jobId === null || jobId === undefined) {
    throw new Error('recordJobTerminal: execution.jobId is required to transition the job');
  }
  await db.transaction().execute(async (trx) => {
    // UPDATE first: its affected-row count is the race arbiter. Zero rows
    // means the job left `running` since the caller checked; throwing here
    // rolls the transaction back before any execution / summary write.
    const res = await trx
      .updateTable('state_jobs')
      .set({
        status: execution.status,
        failureReason: execution.failureReason ?? null,
        finishedAt: execution.finishedAt,
      })
      .where('id', '=', jobId)
      .where('status', '=', 'running')
      .executeTakeFirst();
    if (Number(res.numUpdatedRows ?? 0n) === 0) {
      throw new JobNotRunningError(jobId);
    }
    await insertExecution(trx, execution);
    if (summary !== undefined) {
      const nodeId = execution.nodeIds?.[0];
      if (nodeId !== undefined) await upsertSummaryForNode(trx, nodeId, summary);
    }
  });
}
