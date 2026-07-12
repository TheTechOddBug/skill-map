/**
 * `sm job prune`, retention GC for `state_jobs` rows plus orphaned
 * `state_job_contents` collection. DB-only model: job content lives in
 * `state_job_contents` keyed by `content_hash`, there is no
 * `.skill-map/jobs/*.md` on-disk artifact to unlink.
 *
 * Default behaviour (no flags):
 *   - Read `jobs.retention.completed` and `jobs.retention.failed` from
 *     the layered config. Each is `seconds | null`, `null` means
 *     "never auto-prune".
 *   - For each terminal status with a non-null retention:
 *       cutoffMs = Date.now() - retentionSeconds * 1000
 *     Delete `state_jobs` rows in that status with `finished_at <
 *     cutoffMs`, then collect every orphaned `state_job_contents` row
 *     (content referenced by zero surviving jobs) in the SAME
 *     transaction (per `spec/job-lifecycle.md` §Retention and GC).
 *   - `state_executions` is NOT touched (append-only through v1.0 per
 *     `spec/db-schema.md`).
 *
 * `--dry-run`: print what would happen and touch nothing. The retention
 * counts are exact; the orphaned-content count is reported as `0` in
 * dry-run (the sweep is only computable after the jobs are actually
 * gone, and the live mode reports the real figure).
 *
 * `--json`: emit a single document on stdout shaped as
 *
 *   {
 *     dryRun: boolean,
 *     retention: {
 *       completed: { policySeconds: 2592000 | null, deleted: 4 },
 *       failed:    { policySeconds: null,           deleted: 0 }
 *     },
 *     prunedContents: 2
 *   }
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  on success (or no-op).
 *   2  config load failure / IO error.
 *   5  DB missing, run `sm init` first.
 */

import { Command, Option } from 'clipanion';

import type { IPruneResult, StoragePort } from '../../kernel/ports/storage.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { ExitCode } from '../util/exit-codes.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { JOBS_TEXTS } from '../i18n/jobs.texts.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { withSqlite } from '../util/with-sqlite.js';

interface IRetentionStatusOutput {
  policySeconds: number | null;
  deleted: number;
}

interface IPruneOutput {
  dryRun: boolean;
  retention: {
    completed: IRetentionStatusOutput;
    failed: IRetentionStatusOutput;
    cancelled: IRetentionStatusOutput;
  };
  /**
   * Orphaned `state_job_contents` rows collected across the retention
   * passes (content blobs left unreferenced once terminal jobs were
   * pruned). `0` in dry-run.
   */
  prunedContents: number;
}

export class JobPruneCommand extends SmCommand {
  static override paths = [['job', 'prune']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Retention GC for completed / failed / cancelled jobs (per config policy), plus orphaned job-content collection.',
    details: `
      Reads jobs.retention.completed, jobs.retention.failed, and
      jobs.retention.cancelled from the layered config. For each non-null
      policy, deletes terminal jobs whose finishedAt is older than the
      cutoff, then collects orphaned
      state_job_contents rows (content referenced by no surviving job)
      in the same transaction. Job content is DB-only, there is no
      .skill-map/jobs/ directory to clean.

      With --dry-run: counts and reports what would happen without
      touching the DB.

      Exits 0 on success, 5 if the DB is missing (run \`sm init\`
      first), 2 on any other operational failure (malformed config,
      IO error).
    `,
    examples: [
      ['Apply retention policy', '$0 job prune'],
      ['Preview without touching the DB', '$0 job prune --dry-run --json'],
    ],
  });

  dryRun = Option.Boolean('-n,--dry-run', false, {
    description: 'Report what would be pruned without touching the DB.',
  });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });

    const exit = requireDbOrExit(dbPath, this.context.stderr);
    if (exit !== null) return exit;

    const stderrAnsi = this.ansiFor('stderr');
    const errGlyph = stderrAnsi.red('✕');

    let cfg;
    try {
      cfg = loadConfig({ ...defaultRuntimeContext() }).effective;
    } catch (err) {
      const message = formatErrorMessage(err);
      this.printer!.error(tx(JOBS_TEXTS.pruneErrorPrefix, { glyph: errGlyph, message }));
      return ExitCode.Error;
    }

    const completedPolicy = cfg.jobs.retention.completed;
    const failedPolicy = cfg.jobs.retention.failed;
    const cancelledPolicy = cfg.jobs.retention.cancelled;
    const now = Date.now();

    const out: IPruneOutput = {
      dryRun: this.dryRun,
      retention: {
        completed: { policySeconds: completedPolicy, deleted: 0 },
        failed: { policySeconds: failedPolicy, deleted: 0 },
        cancelled: { policySeconds: cancelledPolicy, deleted: 0 },
      },
      prunedContents: 0,
    };

    try {
      await withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
        // One independent retention pass per terminal status
        // (completed / failed / cancelled). Each live pass prunes its rows
        // AND sweeps content orphaned by that deletion in the same
        // transaction; a later pass catches any content an earlier one
        // could not yet see. For dry-run we mirror the same query but stop
        // before DELETE.
        if (completedPolicy !== null) {
          const cutoff = now - completedPolicy * 1000;
          const result = await this.pruneOrPreview('completed', cutoff, adapter, this.dryRun);
          out.retention.completed.deleted = result.deletedCount;
          out.prunedContents += result.prunedContents;
        }
        if (failedPolicy !== null) {
          const cutoff = now - failedPolicy * 1000;
          const result = await this.pruneOrPreview('failed', cutoff, adapter, this.dryRun);
          out.retention.failed.deleted = result.deletedCount;
          out.prunedContents += result.prunedContents;
        }
        if (cancelledPolicy !== null) {
          const cutoff = now - cancelledPolicy * 1000;
          const result = await this.pruneOrPreview('cancelled', cutoff, adapter, this.dryRun);
          out.retention.cancelled.deleted = result.deletedCount;
          out.prunedContents += result.prunedContents;
        }
      });
    } catch (err) {
      const message = formatErrorMessage(err);
      this.printer!.error(tx(JOBS_TEXTS.pruneErrorPrefix, { glyph: errGlyph, message }));
      return ExitCode.Error;
    }

    if (this.json) {
      this.printer!.data(JSON.stringify(out) + '\n');
      return ExitCode.Ok;
    }
    this.printPretty(out);
    return ExitCode.Ok;
  }

  private async pruneOrPreview(
    status: 'completed' | 'failed' | 'cancelled',
    cutoffMs: number,
    adapter: StoragePort,
    dryRun: boolean,
  ): Promise<IPruneResult> {
    return dryRun
      ? adapter.jobs.listTerminalCandidates(status, cutoffMs)
      : adapter.jobs.pruneTerminal(status, cutoffMs);
  }

  private printPretty(out: IPruneOutput): void {
    const tag = out.dryRun ? JOBS_TEXTS.pruneTagDryRun : JOBS_TEXTS.pruneTagApply;
    const c = out.retention.completed;
    const f = out.retention.failed;
    const x = out.retention.cancelled;
    const rowsVerb = out.dryRun ? JOBS_TEXTS.pruneRowsVerbDryRun : JOBS_TEXTS.pruneRowsVerbApply;
    const contentsVerb = out.dryRun
      ? JOBS_TEXTS.pruneContentsVerbDryRun
      : JOBS_TEXTS.pruneContentsVerbApply;
    // Pretty-printed retention rows are human commentary, not the verb's
    // primary payload (`--json` carries the same fields on stdout). Routes
    // through `printer.info` so a `-q` invocation silences it and so the
    // channel matches the rest of the M1 wiring.
    const printer = this.printer!;
    printer.info(
      `${tag}\n` +
        tx(JOBS_TEXTS.pruneRetentionRow, {
          label: JOBS_TEXTS.pruneLabelCompleted,
          policy: formatPolicy(c.policySeconds),
          rows: c.deleted,
          rowsVerb,
        }) +
        tx(JOBS_TEXTS.pruneRetentionRow, {
          label: JOBS_TEXTS.pruneLabelFailed,
          policy: formatPolicy(f.policySeconds),
          rows: f.deleted,
          rowsVerb,
        }) +
        tx(JOBS_TEXTS.pruneRetentionRow, {
          label: JOBS_TEXTS.pruneLabelCancelled,
          policy: formatPolicy(x.policySeconds),
          rows: x.deleted,
          rowsVerb,
        }) +
        tx(JOBS_TEXTS.pruneContentsRow, {
          count: out.prunedContents,
          verb: contentsVerb,
        }),
    );
  }
}

function formatPolicy(seconds: number | null): string {
  if (seconds === null) return JOBS_TEXTS.pruneRetentionPolicyNever;
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return `${seconds}s`;
}
