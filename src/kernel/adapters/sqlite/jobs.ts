/**
 * Storage helper for `state_jobs` retention GC. Powers `sm jobs prune`.
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
 * policy decision lives in the CLI (`sm jobs prune`).
 *
 * Per `spec/db-schema.md`, `state_executions` is append-only through
 * `v1.0`. This helper does NOT touch that table, pruning a job row leaves
 * the matching execution row (and its inline `report_json`) in place so
 * post-mortem queries still work after a job's audit trail in `state_jobs`
 * is gone.
 */

import { sql } from 'kysely';
import type { Kysely, Selectable, Transaction } from 'kysely';

import type { IDatabase, IStateJobsTable } from './schema.js';
import type { ExecutionRecord, Job, JobRunner, JobStatus } from '../../types.js';
import type {
  IFindingResolutionIntent,
  IFindingsWriteIntent,
  IJobClaim,
  IJobContentInput,
  IJobListFilter,
  IJobsIntegrityCounts,
  IJobSubmitRow,
  IPruneResult,
  ISummaryWriteIntent,
  TFixerSubmitOutcome,
  TJobTransitionOutcome,
} from '../../types/storage.js';
import { JobNotRunningError } from '../../jobs/errors.js';
import { stampFindingResolutions, writeFindingsForNode } from './findings.js';
import { insertExecution } from './history.js';
import { upsertSummaryForNode } from './summaries.js';

export type { IPruneResult } from '../../types/storage.js';

/** The queued/running statuses the duplicate pre-check and index cover. */
const ACTIVE_STATUSES: readonly JobStatus[] = ['queued', 'running'];

/** Map a `state_jobs` row to the domain `Job` shape. */
function rowToJob(row: Selectable<IStateJobsTable>): Job {
  return {
    id: row.id,
    extensionId: row.extensionId,
    extensionVersion: row.extensionVersion,
    extensionKind: row.extensionKind,
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
 * partial index `ix_state_jobs_extension_node_hash` when a matching
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
        extensionId: row.extensionId,
        extensionVersion: row.extensionVersion,
        extensionKind: row.extensionKind,
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
 * Atomic FIXER supersede submit (`spec/job-lifecycle.md` §Findings injection
 * for fixers · Supersede). Semantically every job for a `(fixer, node)` pair
 * is "fix this node with this fixer"; a second one whose findings / body
 * changed since the first was queued makes the first stale (it would waste an
 * agent pass on findings already resolved), so the newer submit CANCELS the
 * stale queued sibling and enqueues itself in ONE transaction.
 *
 * Inside the transaction, in order:
 *   1. A `running` job for the pair is NEVER superseded (an agent holds its
 *      claim): return `running-conflict` with no writes.
 *   2. A `queued` job with THIS exact `contentHash` is the plain duplicate:
 *      return `duplicate` with no writes (mirrors the `submit(...)` +
 *      partial-index backstop, detected explicitly so the insert never has to
 *      trip the unique constraint).
 *   3. Otherwise CANCEL every stale `queued` sibling (a DIFFERENT
 *      `contentHash`) to the terminal `cancelled` state (`finishedAt = now`,
 *      no `failureReason`, the same transition `cancelJob` uses), then insert
 *      the content (`INSERT OR IGNORE`) + the new queued row. Return `created`
 *      with the superseded ids.
 *
 * The pair key is `(extension_id, node_id)`, matching the duplicate partial
 * index (`ix_state_jobs_extension_node_hash`, which is NOT keyed on
 * `extension_version`); a version change re-keys the `contentHash` anyway.
 */
export async function submitFixerJob(
  db: Kysely<IDatabase>,
  row: IJobSubmitRow,
  content: IJobContentInput,
): Promise<TFixerSubmitOutcome> {
  return db.transaction().execute(async (trx) => {
    const running = await trx
      .selectFrom('state_jobs')
      .select('id')
      .where('extensionId', '=', row.extensionId)
      .where('nodeId', '=', row.nodeId)
      .where('status', '=', 'running')
      .orderBy('claimedAt', 'asc')
      .limit(1)
      .executeTakeFirst();
    if (running) return { outcome: 'running-conflict', runningId: running.id };

    const duplicate = await trx
      .selectFrom('state_jobs')
      .select('id')
      .where('extensionId', '=', row.extensionId)
      .where('nodeId', '=', row.nodeId)
      .where('status', '=', 'queued')
      .where('contentHash', '=', row.contentHash)
      .limit(1)
      .executeTakeFirst();
    if (duplicate) return { outcome: 'duplicate', existingId: duplicate.id };

    const superseded = await trx
      .updateTable('state_jobs')
      .set({ status: 'cancelled', failureReason: null, finishedAt: row.createdAt })
      .where('extensionId', '=', row.extensionId)
      .where('nodeId', '=', row.nodeId)
      .where('status', '=', 'queued')
      .where('contentHash', '!=', row.contentHash)
      .returning('id')
      .execute();

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
        extensionId: row.extensionId,
        extensionVersion: row.extensionVersion,
        extensionKind: row.extensionKind,
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

    return { outcome: 'created', jobId: row.id, supersededIds: superseded.map((r) => r.id) };
  });
}

/**
 * Duplicate pre-check (`spec/job-lifecycle.md` §Submit step 4): return the
 * id of any existing `queued`/`running` job matching
 * `(extensionId, extensionVersion, nodeId, contentHash)`, else `null`.
 * This is the soft gate `--force` skips; the unique partial index remains
 * the hard invariant that keeps a second live duplicate off the table.
 */
export async function findActiveDuplicate(
  db: Kysely<IDatabase>,
  extensionId: string,
  extensionVersion: string,
  nodeId: string,
  contentHash: string,
): Promise<string | null> {
  const row = await db
    .selectFrom('state_jobs')
    .select('id')
    .where('extensionId', '=', extensionId)
    .where('extensionVersion', '=', extensionVersion)
    .where('nodeId', '=', nodeId)
    .where('contentHash', '=', contentHash)
    .where('status', 'in', ACTIVE_STATUSES)
    .limit(1)
    .executeTakeFirst();
  return row?.id ?? null;
}

/**
 * List jobs for `sm jobs list`, filtered and ordered newest-first
 * (`created_at DESC`) for display. `extensionId` matches the stored
 * qualified id exactly OR by bare-id suffix (`%/<id>`), mirroring the
 * analyzer-filter semantics so a short id finds its qualified row.
 */
export async function listJobs(
  db: Kysely<IDatabase>,
  filter: IJobListFilter,
): Promise<Job[]> {
  let query = db.selectFrom('state_jobs').selectAll();
  if (filter.status !== undefined) {
    query = query.where('status', '=', filter.status);
  }
  if (filter.extensionId !== undefined) {
    const token = filter.extensionId;
    query = query.where(({ eb, or }) =>
      or([eb('extensionId', '=', token), eb('extensionId', 'like', `%/${token}`)]),
    );
  }
  if (filter.nodeId !== undefined) {
    query = query.where('nodeId', '=', filter.nodeId);
  }
  const rows = await query.orderBy('createdAt', 'desc').orderBy('id', 'desc').execute();
  return rows.map(rowToJob);
}

/** Full job row by id, or `null` when absent (drives `sm jobs show`). */
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
 * Read-only integrity counts for `sm doctor`: `state_jobs` rows whose
 * `content_hash` has no `state_job_contents` row (corruption; the claim
 * path would mark these `job-file-missing`), and `state_job_contents`
 * rows referenced by zero `state_jobs` rows (retention leftovers that
 * `sm jobs prune` collects). Both `content_hash` columns are NOT NULL,
 * so the `NOT IN` subqueries never trip the SQL NULL semantics.
 */
export async function jobsIntegrityCounts(
  db: Kysely<IDatabase>,
): Promise<IJobsIntegrityCounts> {
  const missing = await db
    .selectFrom('state_jobs')
    .where(
      'contentHash',
      'not in',
      db.selectFrom('state_job_contents').select('contentHash'),
    )
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .executeTakeFirst();
  const stragglers = await db
    .selectFrom('state_job_contents')
    .where(
      'contentHash',
      'not in',
      db.selectFrom('state_jobs').select('contentHash'),
    )
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .executeTakeFirst();
  return {
    missingContent: Number(missing?.n ?? 0),
    contentStragglers: Number(stragglers?.n ?? 0),
  };
}

/**
 * Fetch the rendered content blob for `contentHash` from
 * `state_job_contents`, or `null` when absent. `sm jobs preview` resolves a
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
 * mandatory race guard, when two claimants select the same id at the same
 * instant only one UPDATE lands (the other sees `status` already flipped
 * and matches zero rows). `expires_at` is computed in-statement from the
 * frozen `ttl_seconds` column. `filter`, when supplied, restricts the pick
 * to a single `extension_id`.
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
      ? sql`AND (extension_id = ${filter} OR extension_id LIKE '%/' || ${filter})`
      : sql``;
  const result = await sql<IClaimRow>`
    UPDATE state_jobs
       SET status = 'running',
           claimed_at = ${nowMs},
           runner = ${runner},
           expires_at = CASE WHEN ttl_seconds IS NULL THEN NULL
                             ELSE ${nowMs} + ttl_seconds * 1000 END
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
 * (`already-terminal`) and an unknown id is `not-found`. DOES NOT
 * interrupt the external agent working the job: it discovers the
 * terminal state when its `sm record` callback is refused.
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
 * no `failureReason`). Returns the transitioned ids, mirroring
 * `reapExpired`: `sm jobs cancel --all` reports their count and pushes
 * one `job.cancelled` live event per id (`spec/job-events.md`
 * §Transport).
 */
export async function cancelAllActive(
  db: Kysely<IDatabase>,
  nowMs: number,
): Promise<string[]> {
  const rows = await db
    .updateTable('state_jobs')
    .set({ status: 'cancelled', failureReason: null, finishedAt: nowMs })
    .where('status', 'in', ACTIVE_STATUSES)
    .returning('id')
    .execute();
  return rows.map((r) => r.id);
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
 * Returns the transitioned ids (mirroring `reapExpired`, see
 * `cancelAllActive`). Powers `sm jobs fail --all`.
 */
export async function failAllActive(
  db: Kysely<IDatabase>,
  nowMs: number,
): Promise<string[]> {
  const rows = await db
    .updateTable('state_jobs')
    .set({ status: 'failed', failureReason: 'user-failed', finishedAt: nowMs })
    .where('status', 'in', ACTIVE_STATUSES)
    .returning('id')
    .execute();
  return rows.map((r) => r.id);
}

/**
 * Counts per lifecycle status,
 * `{ queued, running, completed, failed, cancelled }`, every key present
 * (missing statuses report `0`). Backs `sm jobs status` with no id argument.
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
 * with `finishedAt = nowMs`, in one statement. Returns the reaped ids.
 * `expiresAt < nowMs` excludes NULL `expiresAt` rows automatically (SQLite
 * `NULL < n` is NULL, not true), so only claimed-and-expired jobs are
 * swept. Invoked at the start of every `sm jobs claim`, before the claim
 * statement; there is no standalone `sm jobs reap` verb.
 */
export async function reapExpired(
  db: Kysely<IDatabase>,
  nowMs: number,
): Promise<string[]> {
  const rows = await db
    .updateTable('state_jobs')
    .set({ status: 'failed', failureReason: 'abandoned', finishedAt: nowMs })
    .where('status', '=', 'running')
    // Only TTL-armed jobs are reapable: a NULL expiresAt never matches
    // (explicit guard per spec/job-lifecycle.md §Reap procedure; a
    // TTL-less claim waits for the operator / the jobs-overdue check).
    .where('expiresAt', 'is not', null)
    .where('expiresAt', '<', nowMs)
    .returning('id')
    .execute();
  return rows.map((r) => r.id);
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
 *
 * **Findings write-through** (`spec/job-lifecycle.md` §Record, mirror
 * shape). When the caller passes a `findings` intent (the recorded job's
 * extension is probabilistic and its `completed` report produced finder /
 * safety rows, possibly zero), the pair's `state_findings` rows are
 * REPLACED inside the SAME transaction: every existing row for
 * `(node_id, extension_id)`, both origins, is deleted, then the intent's
 * rows land stamped with the node's live `body_hash`. An empty intent is
 * a clean verdict (pure erase). Same skip rule as summaries when the
 * target node has disappeared (previous rows kept).
 *
 * **Fixer resolution stamps** (`spec/db-schema.md` §state_findings). When
 * the caller passes a `resolutions` intent (the recorded job's extension
 * is a FIXER, an Action declaring `precondition.analyzerIds`), each
 * `resolved[]` entry is stamped onto the finding its `id` names, in the
 * SAME transaction. This targets the FINDER's rows, never the fixer's
 * own id, so it never collides with the findings replace above (which is
 * keyed by the fixer's `extension_id`). Out-of-scope and unknown-id
 * entries are skipped silently.
 */
export async function recordJobTerminal(
  db: Kysely<IDatabase>,
  execution: ExecutionRecord,
  summary?: ISummaryWriteIntent,
  findings?: IFindingsWriteIntent,
  resolutions?: IFindingResolutionIntent,
): Promise<void> {
  const jobId = execution.jobId;
  if (jobId === null || jobId === undefined) {
    throw new Error('recordJobTerminal: execution.jobId is required to transition the job');
  }
  await db.transaction().execute(async (trx) => {
    // UPDATE first: its affected-row count is the race arbiter. Zero rows
    // means the job left `running` since the caller checked; throwing here
    // rolls the transaction back before any execution / summary /
    // findings write.
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
    await applyWriteThroughs(trx, execution, summary, findings, resolutions);
  });
}

/**
 * Fold the optional per-node write-throughs into the record transaction:
 * the summary upsert, the findings replace, and the fixer resolution
 * stamps, all keyed by the execution's target node. Each helper reads the
 * live `scan_nodes` row itself and skips silently when the node has
 * disappeared (the stamps skip per-entry on their own scope guards).
 */
async function applyWriteThroughs(
  trx: Transaction<IDatabase>,
  execution: ExecutionRecord,
  summary?: ISummaryWriteIntent,
  findings?: IFindingsWriteIntent,
  resolutions?: IFindingResolutionIntent,
): Promise<void> {
  const nodeId = execution.nodeIds?.[0];
  if (nodeId === undefined) return;
  if (summary !== undefined) await upsertSummaryForNode(trx, nodeId, summary);
  if (findings !== undefined) await writeFindingsForNode(trx, nodeId, findings);
  if (resolutions !== undefined) await stampFindingResolutions(trx, nodeId, resolutions);
}
