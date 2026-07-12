/**
 * `sm job submit / list / show`, the DB-only queue front end (Step 10
 * Phase A, queue infrastructure). Enqueue side only: this module renders +
 * stores queued jobs and reads them back. The runner (`sm job run` /
 * `claim` / `record`) ships in later sub-steps.
 *
 * `sm job submit <action> [-n <node.path> | --all] [--force] [--ttl <s>]
 * [--priority <n>] [--json]`:
 *   1. Resolve the action against the composed runtime registry (built-ins
 *      + enabled plugins). Missing -> exit 5.
 *   2. Reject non-probabilistic actions (exit 2): deterministic actions run
 *      in-process, not via the queue (`spec/cli-contract.md` §Jobs).
 *   3. Resolve the prompt template (the action's `prompt.md`, by
 *      convention) + the canonical preamble; derive `promptTemplateHash`.
 *   4. Resolve target node(s): `-n` (one node, missing -> exit 5) or
 *      `--all` (every non-virtual node matching the action precondition).
 *   5. Per node: compute `contentHash`, run the duplicate pre-check (unless
 *      `--force`), render the content, and submit content + job row in one
 *      transaction. A single-target duplicate refuses with exit 3; in a
 *      `--all` fan-out duplicates are refused individually, not fatally.
 *      `--force` skips the pre-check but never defeats the unique partial
 *      index, so it only succeeds once the prior job is terminal.
 *
 * `sm job list [--status] [--action] [--node] [--json]` and
 * `sm job show <id> [--json]` are straight reads over `state_jobs`.
 *
 * Every path goes through the `StoragePort`; no CLI file reaches the SQLite
 * adapter internals. DB paths resolve through `cli/util/db-path.ts`.
 */

import { readFileSync } from 'node:fs';
import { readFile as readFileAsync } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import type { IAction, IActionPrecondition } from '../../kernel/extensions/index.js';
import type { IDiscoveredPlugin } from '../../kernel/types/plugin.js';
import type { Job, Node } from '../../kernel/types.js';
import type { IJobListFilter } from '../../kernel/types/storage.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import { loadConfig } from '../../kernel/config/loader.js';
import type { IJobsConfig } from '../../kernel/config/loader.js';
import {
  computeContentHash,
  computePromptTemplateHash,
  generateJobId,
  generateNonce,
  InvalidPriorityError,
  InvalidTtlError,
  JobRenderError,
  loadCanonicalPreamble,
  renderJobContent,
  resolvePriority,
  resolveTtl,
  unescapeUserContentClose,
} from '../../kernel/jobs/index.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { readConformanceKillSwitches } from '../util/conformance-env.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { ExitCode, type TExitCode } from '../util/exit-codes.js';
import { JOBS_QUEUE_TEXTS as T } from '../i18n/jobs-queue.texts.js';
import { composeScanExtensions, loadPluginRuntime } from '../util/plugin-runtime.js';
import type { IPrinter } from '../util/printer.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { withSqlite } from '../util/with-sqlite.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface IActionRuntime {
  actions: IAction[];
  /** qualified action id -> directory holding `prompt.md` / `report.schema.json`. */
  dirByAction: Map<string, string>;
}

/**
 * Load the composed action catalog (built-ins + enabled plugins) plus a map
 * from each plugin-action's qualified id to its on-disk directory (derived
 * from the loaded extension's `entryPath`, so no path convention is
 * reconstructed). Built-in actions carry no directory; they are all
 * deterministic today and never reach the prompt-template resolution.
 */
async function loadActionRuntime(printer: IPrinter): Promise<IActionRuntime> {
  const runtime = await loadPluginRuntime();
  runtime.emitWarnings(printer);
  const composed = composeScanExtensions({
    noBuiltIns: false,
    pluginRuntime: runtime,
    killSwitches: readConformanceKillSwitches(),
  });
  const dirByAction = buildActionDirMap(runtime.discovered);
  return { actions: composed?.actions ?? [], dirByAction };
}

function buildActionDirMap(discovered: IDiscoveredPlugin[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const plugin of discovered) {
    for (const ext of plugin.extensions ?? []) {
      if (ext.kind !== 'action') continue;
      map.set(qualifiedExtensionId(ext.pluginId, ext.id), dirname(ext.entryPath));
    }
  }
  return map;
}

/** Resolve an action by qualified id (`<plugin>/<id>`) or bare id. */
function resolveAction(actions: readonly IAction[], id: string): IAction | null {
  for (const action of actions) {
    if (qualifiedExtensionId(action.pluginId, action.id) === id) return action;
  }
  for (const action of actions) {
    if (action.id === id) return action;
  }
  return null;
}

/**
 * Match a node against an action precondition for `--all` fan-out. Mirrors
 * the extractor kind matcher (segment-after-slash) and adds a provider
 * gate against the node's own provider. `analyzerIds` is NOT a fan-out gate
 * (it drives UI "resolve this issue" affordances, not node-kind
 * eligibility), so it is intentionally ignored here.
 */
function nodeMatchesPrecondition(node: Node, precondition?: IActionPrecondition): boolean {
  if (!precondition) return true;
  if (precondition.provider && precondition.provider.length > 0) {
    if (!precondition.provider.includes(node.provider)) return false;
  }
  if (precondition.kind && precondition.kind.length > 0) {
    const qualified = `${node.provider}/${node.kind}`;
    const ok = precondition.kind.some((entry) => {
      if (entry === qualified) return true;
      const slash = entry.indexOf('/');
      const kindOnly = slash === -1 ? entry : entry.slice(slash + 1);
      return kindOnly === node.kind;
    });
    if (!ok) return false;
  }
  return true;
}

/** Strip a leading YAML frontmatter fence (mirrors the Provider regex). */
function stripFrontmatterFence(text: string): string {
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? text.slice(match[0].length) : text;
}

async function readNodeBody(cwd: string, nodePath: string): Promise<string> {
  const raw = await readFileAsync(resolve(cwd, nodePath), 'utf8');
  return stripFrontmatterFence(raw);
}

/** Detect a SQLite UNIQUE-constraint failure (the partial-index backstop). */
function isUniqueConstraintError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /unique constraint failed/i.test(message);
}

/** Parse an integer flag; returns `undefined` when absent, throws on garbage. */
function parseIntFlag(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new Error(raw);
  }
  return Number.parseInt(raw.trim(), 10);
}

// ---------------------------------------------------------------------------
// sm job submit
// ---------------------------------------------------------------------------

type TSubmitOutcome =
  | { kind: 'created'; nodeId: string; id: string }
  | { kind: 'duplicate'; nodeId: string; existingId: string };

interface ISubmitContext {
  actionId: string;
  actionVersion: string;
  promptTemplate: string;
  preamble: string;
  promptTemplateHash: string;
  ttlSeconds: number;
  priority: number;
  cwd: string;
  force: boolean;
}

export class JobSubmitCommand extends SmCommand {
  static override paths = [['job', 'submit']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Enqueue a probabilistic action against one node (-n) or every matching node (--all).',
    details: `
      Renders the action's prompt template + the canonical safety preamble,
      stores the content in state_job_contents (deduped by content hash),
      and inserts a queued state_jobs row. Only probabilistic actions are
      queued; deterministic actions run in-process.

      With -n <node.path>: enqueue one job (missing node -> exit 5). With
      --all: fan out to every non-virtual node matching the action's
      precondition. --force skips the duplicate pre-check but never defeats
      the unique index, so it only lands once the prior job is terminal.

      Exit codes: 0 on success, 2 on bad flags / non-probabilistic action /
      unresolved prompt, 3 on a single-target duplicate refusal, 5 when the
      action or node is not found (or the DB is missing).
    `,
    examples: [
      ['Enqueue against one node', '$0 job submit core/skill-summarizer -n .claude/skills/foo/SKILL.md'],
      ['Fan out to every matching node', '$0 job submit core/skill-summarizer --all'],
    ],
  });

  action = Option.String({ required: true });
  node = Option.String('-n', { required: false });
  all = Option.Boolean('--all', false);
  // CLI flag stays `--run`; field is `runFlag` per the shadow-avoidance
  // convention on `SmCommand`. Declared for surface stability; the runner
  // is deferred, so `--run` is rejected in this build.
  runFlag = Option.Boolean('--run', false);
  force = Option.Boolean('--force', false);
  ttl = Option.String('--ttl', { required: false });
  priority = Option.String('--priority', { required: false });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;

    const flagExit = this.validateFlags();
    if (flagExit !== null) return flagExit;

    const flags = this.parseNumericFlags();
    if (typeof flags === 'number') return flags;

    const jobs = this.loadJobsConfig(ctx);
    if (typeof jobs === 'number') return jobs;

    const runtime = await loadActionRuntime(this.printer!);
    const action = this.resolveActionOrExit(runtime.actions);
    if (typeof action === 'number') return action;

    const prepared = this.prepareSubmit(action, runtime, jobs, flags.ttl, flags.priority, ctx.cwd);
    if (typeof prepared === 'number') return prepared;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, (adapter) =>
      this.dispatch(adapter, action, prepared),
    );
  }

  /** Flag-shape validation (mutual exclusion, --run, target presence). */
  private validateFlags(): TExitCode | null {
    if (this.runFlag) return this.fail(T.submitErrRunUnsupported);
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

  /**
   * Resolve the action + enforce the probabilistic gate. Exit 5 when the
   * action is unknown, exit 2 when it is deterministic (runs in-process).
   */
  private resolveActionOrExit(actions: readonly IAction[]): IAction | TExitCode {
    const action = resolveAction(actions, this.action);
    if (!action) {
      this.printer!.error(
        tx(T.submitErrPrefix, {
          glyph: this.errGlyph(),
          message: tx(T.submitErrActionNotFound, { action: this.action }),
        }),
      );
      return ExitCode.NotFound;
    }
    if ((action.mode ?? 'deterministic') !== 'probabilistic') {
      return this.fail(
        tx(T.submitErrActionNotProbabilistic, {
          action: this.action,
          mode: action.mode ?? 'deterministic',
        }),
      );
    }
    return action;
  }

  /**
   * Resolve prompt template + preamble + hashes + TTL / priority (constant
   * across the fan-out). Returns the shared submit context or an exit code
   * on failure.
   */
  private prepareSubmit(
    action: IAction,
    runtime: IActionRuntime,
    jobs: IJobsConfig,
    flagTtl: number | undefined,
    flagPriority: number | undefined,
    cwd: string,
  ): ISubmitContext | TExitCode {
    const actionId = qualifiedExtensionId(action.pluginId, action.id);
    const dir = runtime.dirByAction.get(actionId);
    if (dir === undefined) {
      return this.fail(
        tx(T.submitErrPromptUnresolved, { action: this.action, detail: 'no source directory' }),
      );
    }
    let promptTemplate: string;
    try {
      promptTemplate = readFileSync(join(dir, 'prompt.md'), 'utf8');
    } catch (err) {
      return this.fail(
        tx(T.submitErrPromptUnresolved, { action: this.action, detail: formatErrorMessage(err) }),
      );
    }
    const preamble = loadCanonicalPreamble();
    let ttlSeconds: number;
    let priority: number;
    try {
      ttlSeconds = resolveTtl(action, jobs, flagTtl);
      priority = resolvePriority(action, jobs, flagPriority);
    } catch (err) {
      if (err instanceof InvalidTtlError || err instanceof InvalidPriorityError) {
        return this.fail(err.message);
      }
      throw err;
    }
    return {
      actionId,
      actionVersion: action.version,
      promptTemplate,
      preamble,
      promptTemplateHash: computePromptTemplateHash({ preamble, template: promptTemplate }),
      ttlSeconds,
      priority,
      cwd,
      force: this.force,
    };
  }

  /** Route to the single-node or fan-out submit path. */
  private async dispatch(
    adapter: StoragePort,
    action: IAction,
    prepared: ISubmitContext,
  ): Promise<TExitCode> {
    if (this.all) return this.submitAll(adapter, action, prepared);
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
    return this.reportSingle(adapter, outcome);
  }

  /** `--all` path: fan out over precondition-matching non-virtual nodes. */
  private async submitAll(
    adapter: StoragePort,
    action: IAction,
    prepared: ISubmitContext,
  ): Promise<TExitCode> {
    const nodes = await adapter.scans.findNodes({});
    const targets = nodes.filter(
      (n) => n.virtual !== true && nodeMatchesPrecondition(n, action.precondition),
    );
    const outcomes: TSubmitOutcome[] = [];
    for (const node of targets) {
      outcomes.push(await submitOneJob(adapter, node, prepared));
    }
    return this.reportAll(outcomes, targets.length);
  }

  // --- output --------------------------------------------------------------

  private async reportSingle(adapter: StoragePort, outcome: TSubmitOutcome): Promise<TExitCode> {
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
    if (this.json) {
      const job = await adapter.jobs.get(outcome.id);
      this.printer!.data(JSON.stringify(job) + '\n');
    } else {
      this.printer!.data(outcome.id + '\n');
    }
    return ExitCode.Ok;
  }

  private reportAll(outcomes: readonly TSubmitOutcome[], total: number): TExitCode {
    const submitted = outcomes.filter((o) => o.kind === 'created');
    const refused = outcomes.filter((o) => o.kind === 'duplicate');
    if (this.json) {
      this.printer!.data(
        JSON.stringify({
          submitted: submitted.map((o) => ({ id: (o as { id: string }).id, nodeId: o.nodeId })),
          refused: refused.map((o) => ({
            nodeId: o.nodeId,
            existingId: (o as { existingId: string }).existingId,
            reason: 'duplicate',
          })),
          counts: { submitted: submitted.length, refused: refused.length, total },
        }) + '\n',
      );
      return ExitCode.Ok;
    }
    if (total === 0) {
      this.printer!.info(tx(T.submitAllNoMatch, { glyph: this.warnGlyph(), action: this.action }));
      return ExitCode.Ok;
    }
    for (const o of submitted) {
      this.printer!.info(
        tx(T.submitQueuedLine, { glyph: this.okGlyph(), id: (o as { id: string }).id, node: o.nodeId }),
      );
    }
    for (const o of refused) {
      this.printer!.info(
        tx(T.submitDuplicateLine, { glyph: this.warnGlyph(), id: (o as { existingId: string }).existingId, node: o.nodeId }),
      );
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

/**
 * Submit exactly one job for `node`. Duplicate pre-check first (skipped by
 * `--force`); render + submit in one transaction otherwise. A UNIQUE index
 * violation (the hard backstop `--force` cannot defeat) is surfaced as a
 * duplicate too.
 */
async function submitOneJob(
  adapter: StoragePort,
  node: Node,
  prepared: ISubmitContext,
): Promise<TSubmitOutcome> {
  const contentHash = computeContentHash({
    actionId: prepared.actionId,
    actionVersion: prepared.actionVersion,
    nodePath: node.path,
    bodyHash: node.bodyHash,
    frontmatterHash: node.frontmatterHash,
    promptTemplateHash: prepared.promptTemplateHash,
  });

  if (!prepared.force) {
    const existing = await adapter.jobs.findActiveDuplicate(
      prepared.actionId,
      prepared.actionVersion,
      node.path,
      contentHash,
    );
    if (existing) return { kind: 'duplicate', nodeId: node.path, existingId: existing };
  }

  const body = await readNodeBody(prepared.cwd, node.path);
  const content = renderJobContent({
    node,
    nodeBody: body,
    promptTemplate: prepared.promptTemplate,
    preamble: prepared.preamble,
  });
  const now = Date.now();
  const id = generateJobId();
  const row = {
    id,
    actionId: prepared.actionId,
    actionVersion: prepared.actionVersion,
    nodeId: node.path,
    contentHash,
    nonce: generateNonce(),
    priority: prepared.priority,
    status: 'queued' as const,
    ttlSeconds: prepared.ttlSeconds,
    createdAt: now,
  };
  try {
    await adapter.jobs.submit(row, { contentHash, content, createdAt: now });
    return { kind: 'created', nodeId: node.path, id };
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    const existing = await adapter.jobs.findActiveDuplicate(
      prepared.actionId,
      prepared.actionVersion,
      node.path,
      contentHash,
    );
    return { kind: 'duplicate', nodeId: node.path, existingId: existing ?? id };
  }
}

// ---------------------------------------------------------------------------
// sm job list
// ---------------------------------------------------------------------------

export class JobListCommand extends SmCommand {
  static override paths = [['job', 'list']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'List jobs, optionally filtered by status / action / node.',
  });

  status = Option.String('--status', { required: false });
  action = Option.String('--action', { required: false });
  node = Option.String('--node', { required: false });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;

    const filter: IJobListFilter = {};
    if (this.status !== undefined) filter.status = this.status as never;
    if (this.action !== undefined) filter.actionId = this.action;
    if (this.node !== undefined) filter.nodeId = this.node;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const jobs = await adapter.jobs.list(filter);
      if (this.json) {
        this.printer!.data(JSON.stringify(jobs) + '\n');
        return ExitCode.Ok;
      }
      this.printPretty(jobs, Object.keys(filter).length > 0);
      return ExitCode.Ok;
    });
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
        action: job.actionId,
        node: job.nodeId,
      });
    }
    this.printer!.data(out);
  }
}

// ---------------------------------------------------------------------------
// sm job show
// ---------------------------------------------------------------------------

export class JobShowCommand extends SmCommand {
  static override paths = [['job', 'show']];
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

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const job = await adapter.jobs.get(this.id);
      if (!job) {
        this.printer!.error(
          tx(T.showErrNotFound, { glyph: this.ansiFor('stderr').red('✕'), id: this.id }),
        );
        return ExitCode.NotFound;
      }
      if (this.json) {
        this.printer!.data(JSON.stringify(job) + '\n');
        return ExitCode.Ok;
      }
      this.printPretty(job);
      return ExitCode.Ok;
    });
  }

  private printPretty(job: Job): void {
    const iso = (ms: number | null | undefined): string =>
      ms === null || ms === undefined ? T.showValueNone : new Date(ms).toISOString();
    this.printer!.data(
      tx(T.showDetail, {
        id: job.id,
        status: job.status,
        action: job.actionId,
        node: job.nodeId,
        priority: job.priority,
        ttl: job.ttlSeconds,
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
  static override paths = [['job', 'preview']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Print the rendered content of a queued job without executing it (reads from state_job_contents; no on-disk artifact).',
  });

  id = Option.String({ required: true });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr);
    if (dbExit !== null) return dbExit;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      const job = await adapter.jobs.get(this.id);
      if (!job) {
        this.printer!.error(
          tx(T.previewErrNotFound, { glyph: this.ansiFor('stderr').red('✕'), id: this.id }),
        );
        return ExitCode.NotFound;
      }
      const content = await adapter.jobs.getContent(job.contentHash);
      if (content === null) {
        this.printer!.error(
          tx(T.previewErrContentMissing, { glyph: this.ansiFor('stderr').red('✕'), id: this.id }),
        );
        return ExitCode.NotFound;
      }
      // Reverse the display-only close-tag neutralisation. This is done ONLY
      // for showing the content to a human, NEVER before hashing (the stored
      // blob keeps the escaped form so `contentHash` stays stable).
      this.printer!.data(unescapeUserContentClose(content));
      return ExitCode.Ok;
    });
  }
}

/** Aggregate export so `entry.ts` registers the queue verbs in one line. */
export const JOB_QUEUE_COMMANDS = [
  JobSubmitCommand,
  JobListCommand,
  JobShowCommand,
  JobPreviewCommand,
];
