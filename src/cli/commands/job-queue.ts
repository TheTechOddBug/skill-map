/**
 * `sm jobs submit / list / show / preview / claim / status / cancel /
 * fail`, the DB-only queue front end. This module renders + stores
 * queued jobs, reads them back, and hands them over. skill-map never
 * executes a job itself: an external agent processes the queue via
 * `sm jobs claim` + `sm record` (`spec/architecture.md` §Execution
 * handover).
 *
 * `sm jobs submit <extension> [-n <node.path> | --all] [--force] [--ttl <s>]
 * [--priority <n>] [--json]`:
 *   1. Resolve the extension against the composed runtime registry
 *      (built-ins + enabled plugins). Missing -> exit 5.
 *   2. Reject non-probabilistic extensions (exit 2): deterministic
 *      extensions run in-process, not via the queue
 *      (`spec/cli-contract.md` §Jobs).
 *   3. Resolve the prompt template (the extension's `prompt.md`, by
 *      convention) + the canonical preamble; derive `promptTemplateHash`.
 *   4. Resolve target node(s): `-n` (one node, missing -> exit 5) or
 *      `--all` (every non-virtual node matching the extension
 *      precondition).
 *   5. Per node: compute `contentHash`, run the duplicate pre-check (unless
 *      `--force`), re-read the node body from disk and VERIFY it still
 *      hashes to the scanned `bodyHash` (`spec/job-lifecycle.md` §Submit
 *      step 8, the drift refusal: the DB stores hashes, not body text, so
 *      the render can only source disk bytes), render the content, and
 *      submit content + job row in one transaction. A single-target
 *      duplicate refuses with exit 3; drift / an unreadable file refuse
 *      with exit 2. In a `--all` fan-out every refusal is per-node, not
 *      fatal. `--force` skips the duplicate pre-check but never defeats
 *      the unique partial index, so it only succeeds once the prior job
 *      is terminal (and never skips the drift verification).
 *
 * `sm jobs list [--status] [--extension] [--node] [--json]` and
 * `sm jobs show <id> [--json]` are straight reads over `state_jobs`; their
 * `--json` projections OMIT the `nonce` (the record credential travels
 * only on `submit --json` / `claim --json`, spec §Atomic claim).
 *
 * The submit machinery itself (steps 1-5) lives in
 * `core/jobs/submit-engine.ts` (single source, shared with the record-path
 * auto-fix hook and the BFF submit route); this file owns the flag
 * surface, the processing-agent gate, the exit-code mapping, and every
 * human / `--json` output shape.
 *
 * Every job-transitioning verb here (submit / claim / cancel / fail) also
 * fires the best-effort live push to the project's running server
 * (`cli/util/job-event-push.ts`, `spec/job-events.md` §Transport) AFTER
 * its DB transition commits; the push can never alter output or exit
 * codes. The engine stays push-free by design so the BFF submit route
 * never double-pushes.
 *
 * Every path goes through the `StoragePort`; no CLI file reaches the SQLite
 * adapter internals. DB paths resolve through `cli/util/db-path.ts`.
 */

import { Command, Option } from 'clipanion';

import type { Job } from '../../kernel/types.js';
import type { IJobListFilter } from '../../kernel/types/storage.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import { loadConfig } from '../../kernel/config/loader.js';
import type { IJobsConfig } from '../../kernel/config/loader.js';
import {
  generateRunId,
  type ISuppressionMatch,
  unescapeUserContentClose,
} from '../../kernel/jobs/index.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import {
  nodeMatchesPrecondition,
  prepareSubmitContext,
  submitOneJob,
  type ISubmitContext,
  type TPrepareError,
  type TQueueableExtension,
  type TSubmitOutcome,
} from '../../core/jobs/submit-engine.js';
import { buildReadVersionCheck } from '../util/db-version-check.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { assertNoDriftForWrite } from '../../core/sqlite/db-version-runner.js';
import { processingSkillPresence } from '../../core/agent-skill/targets.js';
import { ExitCode, type TExitCode } from '../util/exit-codes.js';
import { JOBS_QUEUE_TEXTS as T } from '../i18n/jobs-queue.texts.js';
import { pushJobEvent } from '../util/job-event-push.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { readActiveSuppressions } from '../util/sidecar-suppressions.js';
import { SmCommand } from '../util/sm-command.js';
import { withSqlite } from '../util/with-sqlite.js';
import { loadActionRuntime } from './action-runtime.js';
import { recordFailedOutcome } from './record-outcome.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Comma-joined finder ids of a fixer submit, for the no-findings advisory
 * (`spec/job-lifecycle.md` §Findings injection for fixers). Empty string
 * when the submit is not a fixer (never reached, the no-findings outcome
 * only arises for fixers).
 */
function fixerFindersLabel(prepared: ISubmitContext): string {
  return (prepared.analyzerIds ?? []).join(', ');
}

/**
 * Human phrase for the suppressed-judgment advisory (`spec/job-lifecycle.md`
 * §Submit): the quoted, deduped, sorted `type`s of the matching suppression
 * entries, or the whole-finder wording when any entry carries no `type`
 * (a type-less suppression silences every type the finder emits).
 */
function suppressedWhatLabel(matching: readonly ISuppressionMatch[]): string {
  if (matching.some((s) => s.type === undefined)) return T.submitSuppressedAll;
  const types = [...new Set(matching.map((s) => s.type as string))].sort();
  return tx(T.submitSuppressedTypes, { types: types.map((t) => `'${t}'`).join(', ') });
}

/** Parse an integer flag; returns `undefined` when absent, throws on garbage. */
function parseIntFlag(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new Error(raw);
  }
  return Number.parseInt(raw.trim(), 10);
}

/**
 * Public projection of a `Job` for the read surfaces (`sm jobs list --json`
 * / `sm jobs show --json`): every field EXCEPT `nonce`. The nonce is the
 * sole record credential and travels only on the contracted carriers,
 * `sm jobs submit --json` (creator envelope) and `sm jobs claim --json`
 * (handover). See `spec/job-lifecycle.md` §Atomic claim · Nonce exposure.
 */
function toPublicJob(job: Job): Omit<Job, 'nonce'> {
  const { nonce: _nonce, ...pub } = job;
  return pub;
}

// ---------------------------------------------------------------------------
// sm jobs submit
// ---------------------------------------------------------------------------

export class JobSubmitCommand extends SmCommand {
  static override paths = [['jobs', 'submit']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Enqueue a probabilistic extension against one node (-n) or every matching node (--all).',
    details: `
      Renders the extension's prompt template + the canonical safety
      preamble, stores the content in state_job_contents (deduped by
      content hash), and inserts a queued state_jobs row. Only
      probabilistic extensions are queued; deterministic extensions run
      in-process.

      With -n <node.path>: enqueue one job (missing node -> exit 5). With
      --all: fan out to every non-virtual node matching the extension's
      precondition. --force skips the duplicate pre-check but never defeats
      the unique index, so it only lands once the prior job is terminal.

      Jobs never expire by default: --ttl <seconds> arms an expiry for
      this submit (0 explicitly disarms any config policy; negatives are
      rejected). Config sources: jobs.perExtensionTtl, then the global
      opt-in jobs.ttlSeconds.

      Exit codes: 0 on success, 2 on bad flags / non-probabilistic
      extension / unresolved prompt, 3 on a single-target duplicate
      refusal, 5 when the extension or node is not found (or the DB is
      missing).
    `,
    examples: [
      ['Enqueue against one node', '$0 job submit core/skill-summarizer -n .claude/skills/foo/SKILL.md'],
      ['Fan out to every matching node', '$0 job submit core/skill-summarizer --all'],
    ],
  });

  extension = Option.String({ required: true });
  node = Option.String('-n', { required: false });
  all = Option.Boolean('--all', false);
  force = Option.Boolean('--force', false);
  ttl = Option.String('--ttl', { required: false });
  priority = Option.String('--priority', { required: false });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;
    // Write verb: refuse a drifted DB (either axis) BEFORE the plugin
    // runtime loads, or secondary reads (trust store) misbehave and
    // surface as a misleading "extension not found"
    // (spec/cli-contract.md §Schema-drift rebuild).
    assertNoDriftForWrite(dbPath);

    const flagExit = this.validateFlags();
    if (flagExit !== null) return flagExit;

    const flags = this.parseNumericFlags();
    if (typeof flags === 'number') return flags;

    const jobs = this.loadJobsConfig(ctx);
    if (typeof jobs === 'number') return jobs;

    const runtime = await loadActionRuntime(this.printer!);
    // Resolve + prepare through the SHARED helper (also used by the
    // record-path auto-fix hook via `submitFixerJob`), then map any
    // structured failure to this command's exact error output + exit code.
    const prep = prepareSubmitContext({
      runtime,
      jobs,
      extensionId: this.extension,
      cwd: ctx.cwd,
      force: this.force,
      flagTtl: flags.ttl,
      flagPriority: flags.priority,
    });
    if (!prep.ok) return this.failPrepare(prep.error);

    const gateExit = this.checkProcessingAgentGate(ctx.cwd);
    if (gateExit !== null) return gateExit;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, (adapter) =>
      this.dispatch(adapter, prep.extension, prep.prepared),
    );
  }

  /**
   * Processing-agent gate (`spec/job-lifecycle.md` §Submit): refuse (exit 2)
   * when the project has NO processing skill installed under any scaffold
   * destination, since the queued job would never be claimed; the message
   * explains the pull-only mechanism and the remedy. An installed-but-stale
   * skill passes with a refresh advisory (human mode only). Evaluated after
   * target resolution so the more specific refusals win, and only on this
   * operator surface: `submitFixerJob` (the auto-fix hook path) bypasses it,
   * because it fires inside `sm record`, where an agent is demonstrably
   * processing the queue.
   */
  private checkProcessingAgentGate(cwd: string): TExitCode | null {
    const presence = processingSkillPresence(cwd);
    if (!presence.installed) return this.fail(T.submitErrNoProcessingAgent);
    if (!presence.fresh && !this.json) {
      this.printer!.info(tx(T.submitStaleSkillLine, { glyph: this.warnGlyph() }));
    }
    return null;
  }

  /**
   * Map a `prepareSubmitContext` failure to this command's directed error
   * output + exit code, preserving the exact messages / codes the extracted
   * methods used to emit (unresolved extension -> 5; non-probabilistic /
   * ambiguous / unresolved prompt or schema / bad ttl-priority -> 2).
   */
  private failPrepare(error: TPrepareError): TExitCode {
    switch (error.kind) {
      case 'not-found':
        this.printer!.error(
          tx(T.submitErrPrefix, {
            glyph: this.errGlyph(),
            message: tx(T.submitErrExtensionNotFound, { extension: this.extension }),
          }),
        );
        return ExitCode.NotFound;
      case 'deterministic':
        return this.fail(
          tx(T.submitErrExtensionNotProbabilistic, { extension: this.extension, mode: error.mode }),
        );
      case 'ambiguous':
        return this.fail(
          tx(T.submitErrAmbiguousExtension, {
            extension: this.extension,
            actionId: error.actionId,
            analyzerId: error.analyzerId,
          }),
        );
      case 'prompt-unresolved':
        return this.fail(
          tx(T.submitErrPromptUnresolved, { extension: this.extension, detail: error.detail }),
        );
      case 'report-schema-unresolved':
        return this.fail(
          tx(T.submitErrReportSchemaUnresolved, { extension: this.extension, detail: error.detail }),
        );
      case 'invalid-ttl':
      case 'invalid-priority':
        return this.fail(error.message);
    }
  }

  /** Flag-shape validation (mutual exclusion, target presence). */
  private validateFlags(): TExitCode | null {
    if (this.all && this.node !== undefined) return this.fail(T.submitErrTargetConflict);
    if (!this.all && this.node === undefined) return this.fail(T.submitErrNeedTarget);
    return null;
  }

  /** Parse `--ttl` / `--priority`. Returns the values or an exit-2 code. */
  private parseNumericFlags(): { ttl: number | undefined; priority: number | undefined } | TExitCode {
    let ttl: number | undefined;
    let priority: number | undefined;
    try {
      ttl = parseIntFlag(this.ttl);
    } catch (err) {
      return this.fail(tx(T.submitErrBadTtl, { value: (err as Error).message }));
    }
    try {
      priority = parseIntFlag(this.priority);
    } catch (err) {
      return this.fail(tx(T.submitErrBadPriority, { value: (err as Error).message }));
    }
    return { ttl, priority };
  }

  /** Load the jobs config slice, or an exit-2 code on a config failure. */
  private loadJobsConfig(ctx: { cwd: string }): IJobsConfig | TExitCode {
    try {
      return loadConfig({ ...ctx }).effective.jobs;
    } catch (err) {
      return this.fail(formatErrorMessage(err));
    }
  }

  /** Route to the single-node or fan-out submit path. */
  private async dispatch(
    adapter: StoragePort,
    extension: TQueueableExtension,
    prepared: ISubmitContext,
  ): Promise<TExitCode> {
    if (this.all) return this.submitAll(adapter, extension, prepared);
    return this.submitOneTarget(adapter, prepared);
  }

  /** `-n <path>` path: resolve the node then submit exactly one job. */
  private async submitOneTarget(
    adapter: StoragePort,
    prepared: ISubmitContext,
  ): Promise<TExitCode> {
    const path = this.node!;
    const bundle = await adapter.scans.findNode(path);
    if (!bundle) {
      this.printer!.error(
        tx(T.submitErrPrefix, {
          glyph: this.errGlyph(),
          message: tx(T.submitErrNodeNotFound, { node: path }),
        }),
      );
      return ExitCode.NotFound;
    }
    if (bundle.node.virtual === true) {
      return this.fail(tx(T.submitErrNodeVirtual, { node: path }));
    }
    const outcome = await submitOneJob(adapter, bundle.node, prepared);
    return this.reportSingle(adapter, outcome, prepared);
  }

  /** `--all` path: fan out over precondition-matching non-virtual nodes. */
  private async submitAll(
    adapter: StoragePort,
    extension: TQueueableExtension,
    prepared: ISubmitContext,
  ): Promise<TExitCode> {
    const nodes = await adapter.scans.findNodes({});
    const targets = nodes.filter(
      (n) => n.virtual !== true && nodeMatchesPrecondition(n, extension.precondition),
    );
    const outcomes: TSubmitOutcome[] = [];
    for (const node of targets) {
      outcomes.push(await submitOneJob(adapter, node, prepared));
    }
    return this.reportAll(outcomes, targets.length, prepared);
  }

  // --- output --------------------------------------------------------------

  private async reportSingle(
    adapter: StoragePort,
    outcome: TSubmitOutcome,
    prepared: ISubmitContext,
  ): Promise<TExitCode> {
    if (outcome.kind === 'duplicate') {
      if (this.json) {
        this.printer!.data(
          JSON.stringify({ nodeId: outcome.nodeId, duplicate: true, existingId: outcome.existingId }) + '\n',
        );
      } else {
        this.printer!.info(
          tx(T.submitDuplicateLine, { glyph: this.warnGlyph(), id: outcome.existingId, node: outcome.nodeId }),
        );
      }
      return ExitCode.Duplicate;
    }
    // Drift / unreadable refusals: exit 2 with a clean advisory (never a
    // stack trace), per spec §Submit step 8.
    if (outcome.kind === 'drift') {
      return this.fail(tx(T.submitErrNodeDrifted, { node: outcome.nodeId }));
    }
    if (outcome.kind === 'unreadable') {
      return this.fail(
        tx(T.submitErrNodeUnreadable, { node: outcome.nodeId, detail: outcome.detail }),
      );
    }
    // Fixer with no matching findings: refuse (exit 2) with the finder-first
    // advisory (spec §Findings injection for fixers).
    if (outcome.kind === 'no-findings') {
      return this.fail(
        tx(T.submitErrNoFindings, {
          finders: fixerFindersLabel(prepared),
          node: outcome.nodeId,
        }),
      );
    }
    // Live-transition push (spec/job-events.md §Transport / §job.submitted):
    // best-effort hint to the project's running server, AFTER the submit
    // transaction committed. Cannot throw, never alters output or exit code.
    await pushJobEvent(prepared.cwd, {
      type: 'job.submitted',
      timestamp: Date.now(),
      runId: generateRunId('queue'),
      jobId: outcome.id,
      data: {
        nodePath: outcome.nodeId,
        extensionId: prepared.extensionId,
        supersededIds: outcome.supersededIds,
      },
    });
    if (this.json) {
      // --json stdout stays the plain new Job (the submit contract): a
      // supersession is a human-mode stderr advisory only, per spec §Supersede.
      const job = await adapter.jobs.get(outcome.id);
      this.printer!.data(JSON.stringify(job) + '\n');
    } else {
      this.emitSupersededAdvisory(outcome.supersededIds);
      this.emitSuppressedAdvisory(prepared, outcome.nodeId);
      this.printer!.data(outcome.id + '\n');
    }
    return ExitCode.Ok;
  }

  /**
   * Human-mode stderr advisory naming each stale queued job a FIXER submit
   * superseded (`spec/job-lifecycle.md` §Findings injection for fixers ·
   * Supersede). One line per cancelled sibling (normally exactly one). No-op
   * for non-fixer submits and fixers with nothing to supersede.
   */
  private emitSupersededAdvisory(supersededIds: readonly string[]): void {
    for (const id of supersededIds) {
      this.printer!.info(tx(T.submitSupersededLine, { glyph: this.warnGlyph(), id }));
    }
  }

  /**
   * Suppressed-judgment advisory (`spec/job-lifecycle.md` §Submit): a FINDER
   * submit whose target node's LIVE `.sm` sidecar suppresses the finder's
   * judgment (a standing `sm findings dismiss`) queues anyway, but warns the
   * operator that the record path will drop the matching findings, BEFORE
   * the agent pass is spent. Never a refusal (the kernel safety lane is
   * never suppressed, and a finder may emit types the suppression does not
   * cover). Human mode only (stderr); no-op for Action submits and for
   * nodes with no matching suppression.
   */
  private emitSuppressedAdvisory(prepared: ISubmitContext, nodeId: string): void {
    if (prepared.extensionKind !== 'analyzer') return;
    const matching = readActiveSuppressions(prepared.cwd, nodeId).filter(
      (s) => s.extension === prepared.extensionId,
    );
    if (matching.length === 0) return;
    this.printer!.info(
      tx(T.submitSuppressedLine, {
        glyph: this.warnGlyph(),
        node: nodeId,
        what: suppressedWhatLabel(matching),
        extension: prepared.extensionId,
      }),
    );
  }

  private async reportAll(
    outcomes: readonly TSubmitOutcome[],
    total: number,
    prepared: ISubmitContext,
  ): Promise<TExitCode> {
    const submitted = outcomes.filter(
      (o): o is Extract<TSubmitOutcome, { kind: 'created' }> => o.kind === 'created',
    );
    const refused = outcomes.filter(
      (o): o is Exclude<TSubmitOutcome, { kind: 'created' }> => o.kind !== 'created',
    );
    // Live-transition push per created job (spec/job-events.md §Transport /
    // §job.submitted): one queue-mode runId spans the whole fan-out (one
    // invocation = one run). After every submit committed; cannot throw.
    const runId = generateRunId('queue');
    for (const o of submitted) {
      await pushJobEvent(prepared.cwd, {
        type: 'job.submitted',
        timestamp: Date.now(),
        runId,
        jobId: o.id,
        data: {
          nodePath: o.nodeId,
          extensionId: prepared.extensionId,
          supersededIds: o.supersededIds,
        },
      });
    }
    if (this.json) {
      this.printer!.data(
        JSON.stringify({
          submitted: submitted.map((o) => ({ id: o.id, nodeId: o.nodeId })),
          refused: refused.map((o) => this.toRefusedJson(o)),
          counts: { submitted: submitted.length, refused: refused.length, total },
        }) + '\n',
      );
      return ExitCode.Ok;
    }
    if (total === 0) {
      this.printer!.info(tx(T.submitAllNoMatch, { glyph: this.warnGlyph(), extension: this.extension }));
      return ExitCode.Ok;
    }
    for (const o of submitted) {
      this.printer!.info(
        tx(T.submitQueuedLine, { glyph: this.okGlyph(), id: o.id, node: o.nodeId }),
      );
      // Per-node fixer supersede advisory (each fan-out submit applies the
      // Supersede rule independently, spec §Findings injection for fixers).
      this.emitSupersededAdvisory(o.supersededIds);
      // Per-node suppressed-judgment advisory (spec §Submit): fan-out finder
      // submits warn on every queued node whose sidecar dismisses them.
      this.emitSuppressedAdvisory(prepared, o.nodeId);
    }
    for (const o of refused) {
      this.printer!.info(this.toRefusedLine(o, prepared));
    }
    this.printer!.info(
      tx(T.submitAllSummary, {
        glyph: this.okGlyph(),
        submitted: submitted.length,
        refused: refused.length,
        total,
      }),
    );
    return ExitCode.Ok;
  }

  /** Per-node refusal row for the `--all` JSON envelope. */
  private toRefusedJson(o: Exclude<TSubmitOutcome, { kind: 'created' }>): Record<string, unknown> {
    if (o.kind === 'duplicate') {
      return { nodeId: o.nodeId, existingId: o.existingId, reason: 'duplicate' };
    }
    if (o.kind === 'unreadable') {
      return { nodeId: o.nodeId, reason: 'unreadable', detail: o.detail };
    }
    if (o.kind === 'no-findings') {
      return { nodeId: o.nodeId, reason: 'no-findings' };
    }
    return { nodeId: o.nodeId, reason: 'drift' };
  }

  /** Per-node refusal line for the `--all` human summary. */
  private toRefusedLine(
    o: Exclude<TSubmitOutcome, { kind: 'created' }>,
    prepared: ISubmitContext,
  ): string {
    if (o.kind === 'duplicate') {
      return tx(T.submitDuplicateLine, { glyph: this.warnGlyph(), id: o.existingId, node: o.nodeId });
    }
    if (o.kind === 'unreadable') {
      return tx(T.submitUnreadableLine, {
        glyph: this.warnGlyph(),
        node: o.nodeId,
        detail: o.detail,
      });
    }
    if (o.kind === 'no-findings') {
      return tx(T.submitNoFindingsLine, {
        glyph: this.warnGlyph(),
        node: o.nodeId,
        finders: fixerFindersLabel(prepared),
      });
    }
    return tx(T.submitDriftLine, { glyph: this.warnGlyph(), node: o.nodeId });
  }

  // --- small glyph / error helpers ----------------------------------------

  private fail(message: string): TExitCode {
    this.printer!.error(tx(T.submitErrPrefix, { glyph: this.errGlyph(), message }));
    return ExitCode.Error;
  }

  private errGlyph(): string {
    return this.ansiFor('stderr').red('✕');
  }

  private warnGlyph(): string {
    return this.ansiFor('stderr').yellow('•');
  }

  private okGlyph(): string {
    return this.ansiFor('stderr').green('✓');
  }
}

// ---------------------------------------------------------------------------
// sm jobs list
// ---------------------------------------------------------------------------

export class JobListCommand extends SmCommand {
  static override paths = [['jobs', 'list']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'List jobs, optionally filtered by status / extension / node.',
  });

  status = Option.String('--status', { required: false });
  extension = Option.String('--extension', { required: false });
  node = Option.String('--node', { required: false });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;

    const filter: IJobListFilter = {};
    if (this.status !== undefined) filter.status = this.status as never;
    if (this.extension !== undefined) filter.extensionId = this.extension;
    if (this.node !== undefined) filter.nodeId = this.node;

    return withSqlite(
      {
        databasePath: dbPath,
        autoBackup: false,
        // Read verb: advise on drift, never refuse (spec/db-schema.md
        // §Schema drift, read-side opens advise).
        versionCheck: buildReadVersionCheck(this.printer!, this.ansiFor('stderr')),
      },
      async (adapter) => {
        const jobs = await adapter.jobs.list(filter);
        if (this.json) {
          // Nonce stripped: list is a read surface (spec §Nonce exposure).
          this.printer!.data(JSON.stringify(jobs.map(toPublicJob)) + '\n');
          return ExitCode.Ok;
        }
        this.printPretty(jobs, Object.keys(filter).length > 0);
        return ExitCode.Ok;
      },
    );
  }

  private printPretty(jobs: readonly Job[], filtered: boolean): void {
    if (jobs.length === 0) {
      this.printer!.info(
        tx(T.listEmpty, {
          glyph: this.ansiFor('stderr').yellow('•'),
          suffix: filtered ? T.listFilterSuffix : '',
        }),
      );
      return;
    }
    let out = '';
    for (const job of jobs) {
      out += tx(T.listRow, {
        id: job.id,
        status: job.status,
        priority: job.priority,
        extension: job.extensionId,
        node: job.nodeId,
      });
    }
    this.printer!.data(out);
  }
}

// ---------------------------------------------------------------------------
// sm jobs show
// ---------------------------------------------------------------------------

export class JobShowCommand extends SmCommand {
  static override paths = [['jobs', 'show']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Job detail: state, claim time, TTL, priority, runner, content hash.',
  });

  id = Option.String({ required: true });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;

    return withSqlite(
      {
        databasePath: dbPath,
        autoBackup: false,
        // Read verb: advise on drift, never refuse.
        versionCheck: buildReadVersionCheck(this.printer!, this.ansiFor('stderr')),
      },
      async (adapter) => {
        const job = await adapter.jobs.get(this.id);
        if (!job) {
          this.printer!.error(
            tx(T.showErrNotFound, { glyph: this.ansiFor('stderr').red('✕'), id: this.id }),
          );
          return ExitCode.NotFound;
        }
        if (this.json) {
          // Nonce stripped: show is a read surface (spec §Nonce exposure).
          this.printer!.data(JSON.stringify(toPublicJob(job)) + '\n');
          return ExitCode.Ok;
        }
        this.printPretty(job);
        return ExitCode.Ok;
      },
    );
  }

  private printPretty(job: Job): void {
    const iso = (ms: number | null | undefined): string =>
      ms === null || ms === undefined ? T.showValueNone : new Date(ms).toISOString();
    this.printer!.data(
      tx(T.showDetail, {
        id: job.id,
        status: job.status,
        extension: job.extensionId,
        kind: job.extensionKind,
        node: job.nodeId,
        priority: job.priority,
        ttl:
          job.ttlSeconds === null
            ? T.showValueNone
            : tx(T.showTtlSeconds, { seconds: job.ttlSeconds }),
        contentHash: job.contentHash,
        createdAt: iso(job.createdAt),
        claimedAt: iso(job.claimedAt),
        finishedAt: iso(job.finishedAt),
        runner: job.runner ?? T.showValueNone,
      }),
    );
  }
}

export class JobPreviewCommand extends SmCommand {
  static override paths = [['jobs', 'preview']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Print the rendered content of a job without executing it (reads from state_job_contents; no on-disk artifact).',
    details: `
      With <job.id>: preview that job. With --last: preview the most
      recently submitted job (newest createdAt, any status), the natural
      follow-up to sm jobs submit without copying the id. Pass exactly one
      of <job.id> or --last (neither, or both, is a usage error -> exit 2);
      --last with no jobs at all exits 5.
    `,
  });

  id = Option.String({ required: false });
  last = Option.Boolean('--last', false);

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;

    if (this.last && this.id !== undefined) {
      this.printer!.error(tx(T.previewErrTargetConflict, { glyph: this.ansiFor('stderr').red('✕') }));
      return ExitCode.Error;
    }
    if (!this.last && this.id === undefined) {
      this.printer!.error(tx(T.previewErrNeedTarget, { glyph: this.ansiFor('stderr').red('✕') }));
      return ExitCode.Error;
    }

    return withSqlite(
      {
        databasePath: dbPath,
        autoBackup: false,
        // Read verb: advise on drift, never refuse.
        versionCheck: buildReadVersionCheck(this.printer!, this.ansiFor('stderr')),
      },
      async (adapter) => {
        // `jobs.list` is newest-first (createdAt DESC, id DESC), so the
        // head row IS the most recently submitted job.
        const job = this.last
          ? ((await adapter.jobs.list({}))[0] ?? null)
          : await adapter.jobs.get(this.id!);
        if (!job) {
          this.printer!.error(
            this.last
              ? tx(T.previewErrNoJobs, { glyph: this.ansiFor('stderr').red('✕') })
              : tx(T.previewErrNotFound, { glyph: this.ansiFor('stderr').red('✕'), id: this.id! }),
          );
          return ExitCode.NotFound;
        }
        const content = await adapter.jobs.getContent(job.contentHash);
        if (content === null) {
          this.printer!.error(
            tx(T.previewErrContentMissing, { glyph: this.ansiFor('stderr').red('✕'), id: job.id }),
          );
          return ExitCode.NotFound;
        }
        // Reverse the display-only close-tag neutralisation. This is done
        // ONLY for showing the content to a human, NEVER before hashing (the
        // stored blob keeps the escaped form so `contentHash` stays stable).
        this.printer!.data(unescapeUserContentClose(content));
        return ExitCode.Ok;
      },
    );
  }
}

// ---------------------------------------------------------------------------
// sm jobs claim
// ---------------------------------------------------------------------------

export class JobClaimCommand extends SmCommand {
  static override paths = [['jobs', 'claim']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Atomic claim: transition the next queued job to running and return its id (the external-agent handover primitive).',
    details: `
      Runs the single-statement atomic claim (spec/job-lifecycle.md §Atomic
      claim): the highest-priority, oldest queued job flips to running with
      claimedAt / runner=agent / expiresAt stamped, and its id is printed on
      stdout. --filter <extension> restricts the claim to one extension id.

      Before claiming, every running job whose TTL expired is silently
      reaped to failed / abandoned (spec/job-lifecycle.md §Reap procedure);
      reaped jobs surface via sm jobs list --status failed, never on this
      verb's stdout.

      Plain mode prints the claimed id. --json prints
      { id, nonce, content } (the rendered content plus the nonce a later
      sm record needs); agents that will call sm record MUST use --json to
      receive the nonce. --filter accepts a qualified <plugin>/<ext> id
      or a bare extension id (same matching as sm jobs list --extension).

      A claimed job whose content row is missing (DB corruption) is marked
      failed / job-file-missing and reported on stderr with exit 2; the
      claim is never handed out with a null content.

      Exit codes: 0 with the claim, 1 when the queue is empty (or nothing
      matches --filter; no output), 2 on a missing content row, 5 when the
      DB is missing.
    `,
  });

  filter = Option.String('--filter', { required: false });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;

    // Write verb: reap-first + the claim UPDATE both mutate rows;
    // refuse a drifted DB up front (spec/cli-contract.md §Schema-drift
    // rebuild) so the refusal (exit 2) is never confused with the
    // empty-queue exit 1.
    assertNoDriftForWrite(dbPath);

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      // Reap-then-claim (spec/job-lifecycle.md §Reap procedure): expired
      // running jobs flip to failed / abandoned before the claim. Silent
      // by contract, this verb's stdout is the handover envelope, so the
      // returned ids are ignored here.
      await adapter.jobs.reapExpired(Date.now());
      // The claim verb is the external-agent handover; the runner is
      // stamped `agent` (`job.schema.json` runner enum).
      const claim = await adapter.jobs.claim('agent', Date.now(), this.filter);
      if (!claim) return ExitCode.Issues; // exit 1: queue empty / no match, no output
      // Fetch the content in BOTH modes: a missing row is the
      // DB-corruption-only job-file-missing state and MUST NOT hand the
      // claim out (spec §Atomic claim · Missing content row at claim).
      const content = await adapter.jobs.getContent(claim.contentHash);
      if (content === null) return this.failClaimContentMissing(adapter, claim.id, ctx.cwd);
      // Live-transition push (spec/job-events.md §Transport / §job.claimed):
      // the event data is read back from the freshly claimed row, and the
      // push fires only when the claim is actually handed out. Runs after
      // the claim committed; cannot throw, never touches the handover
      // contract on stdout. The reap above stays event-silent by spec.
      const claimed = await adapter.jobs.get(claim.id);
      if (claimed) {
        await pushJobEvent(ctx.cwd, {
          type: 'job.claimed',
          timestamp: Date.now(),
          runId: generateRunId('ext'),
          jobId: claimed.id,
          data: {
            extensionId: claimed.extensionId,
            extensionVersion: claimed.extensionVersion,
            nodeId: claimed.nodeId,
            ttlSeconds: claimed.ttlSeconds,
            priority: claimed.priority,
          },
        });
      }
      if (this.json) {
        this.printer!.data(
          JSON.stringify({ id: claim.id, nonce: claim.nonce, content }) + '\n',
        );
        return ExitCode.Ok;
      }
      this.printer!.data(claim.id + '\n');
      return ExitCode.Ok;
    });
  }

  /**
   * Missing `state_job_contents` row under a just-claimed job: mark the
   * job failed / job-file-missing through the shared record primitive
   * (an execution row documents the corruption), report on stderr, exit
   * 2. The verb does NOT loop to the next queued job (corruption wants
   * operator attention; the next invocation claims the next job anyway).
   */
  private async failClaimContentMissing(
    adapter: StoragePort,
    jobId: string,
    cwd: string,
  ): Promise<TExitCode> {
    const job = await adapter.jobs.get(jobId);
    if (job) {
      await recordFailedOutcome({
        adapter,
        job,
        failureReason: 'job-file-missing',
        errorText: T.claimContentMissingDetail,
        metrics: {},
        now: Date.now(),
      });
      // Live-transition push (spec/job-events.md §job.failed): the
      // corruption path is a real failed transition this verb performed,
      // so it rides the same best-effort leg as the happy claim.
      await pushJobEvent(cwd, {
        type: 'job.failed',
        timestamp: Date.now(),
        runId: generateRunId('ext'),
        jobId: job.id,
        data: { reason: 'job-file-missing', message: T.claimContentMissingDetail },
      });
    }
    this.printer!.error(
      tx(T.claimErrContentMissing, { glyph: this.ansiFor('stderr').red('✕'), id: jobId }),
    );
    return ExitCode.Error;
  }
}

// ---------------------------------------------------------------------------
// sm jobs status
// ---------------------------------------------------------------------------

export class JobStatusCommand extends SmCommand {
  static override paths = [['jobs', 'status']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Counts per status (no id) or a single job\'s status.',
  });

  id = Option.String({ required: false });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;

    return withSqlite(
      {
        databasePath: dbPath,
        autoBackup: false,
        // Read verb: advise on drift, never refuse.
        versionCheck: buildReadVersionCheck(this.printer!, this.ansiFor('stderr')),
      },
      async (adapter) =>
        this.id !== undefined ? this.reportSingle(adapter) : this.reportCounts(adapter),
    );
  }

  private async reportSingle(adapter: StoragePort): Promise<TExitCode> {
    const job = await adapter.jobs.get(this.id!);
    if (!job) {
      this.printer!.error(
        tx(T.statusErrNotFound, { glyph: this.ansiFor('stderr').red('✕'), id: this.id! }),
      );
      return ExitCode.NotFound;
    }
    if (this.json) {
      this.printer!.data(
        JSON.stringify({ id: job.id, status: job.status, failureReason: job.failureReason ?? null }) + '\n',
      );
      return ExitCode.Ok;
    }
    this.printer!.data(tx(T.statusSingleLine, { id: job.id, status: job.status }));
    return ExitCode.Ok;
  }

  private async reportCounts(adapter: StoragePort): Promise<TExitCode> {
    const counts = await adapter.jobs.countByStatus();
    if (this.json) {
      this.printer!.data(JSON.stringify(counts) + '\n');
      return ExitCode.Ok;
    }
    this.printer!.data(
      tx(T.statusCounts, {
        queued: counts.queued,
        running: counts.running,
        completed: counts.completed,
        failed: counts.failed,
        cancelled: counts.cancelled,
      }),
    );
    return ExitCode.Ok;
  }
}

// ---------------------------------------------------------------------------
// sm jobs cancel
// ---------------------------------------------------------------------------

export class JobCancelCommand extends SmCommand {
  static override paths = [['jobs', 'cancel']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Move a queued / running job to the terminal cancelled state (or --all).',
    details: `
      With <job.id>: cancel one job. A queued or running job transitions to
      the terminal cancelled state (no failure reason; cancelled is a
      distinct state, not a failed sub-reason); a terminal job is refused
      (exit 2, "already terminal"); an unknown id exits 5. Cancelling does
      NOT interrupt the external agent working the job; it discovers the
      terminal state when its sm record callback is refused.

      With --all: cancel every queued and running job and report the count.
      Pass exactly one of <job.id> or --all (neither, or both, is a usage
      error -> exit 2).

      To instead mark a job as failed by operator decision, use sm jobs fail.
    `,
  });

  id = Option.String({ required: false });
  all = Option.Boolean('--all', false);

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;

    // Write verb: refuse a drifted DB before any table mutation.
    assertNoDriftForWrite(dbPath);

    if (this.all && this.id !== undefined) return this.fail(T.cancelErrTargetConflict, ExitCode.Error);
    if (!this.all && this.id === undefined) return this.fail(T.cancelErrNeedTarget, ExitCode.Error);

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const now = Date.now();
      return this.all ? this.cancelAll(adapter, now, ctx.cwd) : this.cancelOne(adapter, now, ctx.cwd);
    });
  }

  private async cancelAll(adapter: StoragePort, now: number, cwd: string): Promise<TExitCode> {
    const ids = await adapter.jobs.cancelAllActive(now);
    // Live-transition push per cancelled job (spec/job-events.md §Transport
    // / §job.cancelled): one queue-mode runId spans the bulk cancel. After
    // the transaction committed; cannot throw.
    const runId = generateRunId('queue');
    for (const id of ids) {
      await pushJobEvent(cwd, {
        type: 'job.cancelled',
        timestamp: Date.now(),
        runId,
        jobId: id,
        data: {},
      });
    }
    if (this.json) {
      this.printer!.data(JSON.stringify({ cancelled: ids.length }) + '\n');
      return ExitCode.Ok;
    }
    this.printer!.info(
      tx(T.cancelAllSummary, { glyph: this.ansiFor('stderr').green('✓'), count: ids.length }),
    );
    return ExitCode.Ok;
  }

  private async cancelOne(adapter: StoragePort, now: number, cwd: string): Promise<TExitCode> {
    const outcome = await adapter.jobs.cancel(this.id!, now);
    if (outcome === 'not-found') {
      return this.fail(tx(T.cancelErrNotFound, { id: this.id! }), ExitCode.NotFound);
    }
    if (outcome === 'already-terminal') {
      return this.fail(tx(T.cancelErrAlreadyTerminal, { id: this.id! }), ExitCode.Error);
    }
    // Live-transition push (spec/job-events.md §job.cancelled): data is
    // empty by catalog, the envelope's jobId identifies the job.
    await pushJobEvent(cwd, {
      type: 'job.cancelled',
      timestamp: Date.now(),
      runId: generateRunId('queue'),
      jobId: this.id!,
      data: {},
    });
    if (this.json) {
      this.printer!.data(JSON.stringify({ id: this.id, cancelled: true }) + '\n');
      return ExitCode.Ok;
    }
    this.printer!.info(tx(T.cancelOneLine, { glyph: this.ansiFor('stderr').green('✓'), id: this.id! }));
    return ExitCode.Ok;
  }

  private fail(message: string, code: TExitCode): TExitCode {
    this.printer!.error(tx(T.cancelErrPrefix, { glyph: this.ansiFor('stderr').red('✕'), message }));
    return code;
  }
}

// ---------------------------------------------------------------------------
// sm jobs fail
// ---------------------------------------------------------------------------

export class JobFailCommand extends SmCommand {
  static override paths = [['jobs', 'fail']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Force a queued / running job to failed with reason user-failed (or --all).',
    details: `
      Symmetric counterpart to sm jobs cancel. With <job.id>: fail one job. A
      queued or running job transitions to failed / user-failed; a terminal
      job is refused (exit 2, "already terminal"); an unknown id exits 5.
      Failing does NOT interrupt the external agent working the job; it
      discovers the terminal state when its sm record callback is refused.

      With --all: fail every queued and running job and report the count.
      Pass exactly one of <job.id> or --all (neither, or both, is a usage
      error -> exit 2).

      Unlike a cancellation (which records no failure), a user-failed job is
      preserved by the default retention policy (jobs.retention.failed).
    `,
  });

  id = Option.String({ required: false });
  all = Option.Boolean('--all', false);

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;

    // Write verb: refuse a drifted DB before any table mutation.
    assertNoDriftForWrite(dbPath);

    if (this.all && this.id !== undefined) return this.fail(T.failErrTargetConflict, ExitCode.Error);
    if (!this.all && this.id === undefined) return this.fail(T.failErrNeedTarget, ExitCode.Error);

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const now = Date.now();
      return this.all ? this.failAll(adapter, now, ctx.cwd) : this.failOne(adapter, now, ctx.cwd);
    });
  }

  private async failAll(adapter: StoragePort, now: number, cwd: string): Promise<TExitCode> {
    const ids = await adapter.jobs.failAllActive(now);
    // Live-transition push per failed job (spec/job-events.md §Transport /
    // §job.failed): one queue-mode runId spans the bulk fail. After the
    // transaction committed; cannot throw.
    const runId = generateRunId('queue');
    for (const id of ids) {
      await pushJobEvent(cwd, {
        type: 'job.failed',
        timestamp: Date.now(),
        runId,
        jobId: id,
        data: { reason: 'user-failed' },
      });
    }
    if (this.json) {
      this.printer!.data(JSON.stringify({ failed: ids.length }) + '\n');
      return ExitCode.Ok;
    }
    this.printer!.info(
      tx(T.failAllSummary, { glyph: this.ansiFor('stderr').green('✓'), count: ids.length }),
    );
    return ExitCode.Ok;
  }

  private async failOne(adapter: StoragePort, now: number, cwd: string): Promise<TExitCode> {
    const outcome = await adapter.jobs.fail(this.id!, now);
    if (outcome === 'not-found') {
      return this.fail(tx(T.failErrNotFound, { id: this.id! }), ExitCode.NotFound);
    }
    if (outcome === 'already-terminal') {
      return this.fail(tx(T.failErrAlreadyTerminal, { id: this.id! }), ExitCode.Error);
    }
    // Live-transition push (spec/job-events.md §job.failed): the operator
    // verb's reason is always user-failed (spec/job-lifecycle.md §Fail).
    await pushJobEvent(cwd, {
      type: 'job.failed',
      timestamp: Date.now(),
      runId: generateRunId('queue'),
      jobId: this.id!,
      data: { reason: 'user-failed' },
    });
    if (this.json) {
      this.printer!.data(JSON.stringify({ id: this.id, failed: true }) + '\n');
      return ExitCode.Ok;
    }
    this.printer!.info(tx(T.failOneLine, { glyph: this.ansiFor('stderr').green('✓'), id: this.id! }));
    return ExitCode.Ok;
  }

  private fail(message: string, code: TExitCode): TExitCode {
    this.printer!.error(tx(T.failErrPrefix, { glyph: this.ansiFor('stderr').red('✕'), message }));
    return code;
  }
}

/** Aggregate export so `entry.ts` registers the queue verbs in one line. */
export const JOB_QUEUE_COMMANDS = [
  JobSubmitCommand,
  JobListCommand,
  JobShowCommand,
  JobPreviewCommand,
  JobClaimCommand,
  JobStatusCommand,
  JobCancelCommand,
  JobFailCommand,
];
