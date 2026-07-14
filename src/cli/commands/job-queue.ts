/**
 * `sm job submit / list / show / preview / claim / status / cancel /
 * fail`, the DB-only queue front end. This module renders + stores
 * queued jobs, reads them back, and hands them over. skill-map never
 * executes a job itself: an external agent drains the queue via
 * `sm job claim` + `sm record` (`spec/architecture.md` §Execution
 * handover).
 *
 * `sm job submit <extension> [-n <node.path> | --all] [--force] [--ttl <s>]
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
 * `sm job list [--status] [--extension] [--node] [--json]` and
 * `sm job show <id> [--json]` are straight reads over `state_jobs`; their
 * `--json` projections OMIT the `nonce` (the record credential travels
 * only on `submit --json` / `claim --json`, spec §Atomic claim).
 *
 * Every path goes through the `StoragePort`; no CLI file reaches the SQLite
 * adapter internals. DB paths resolve through `cli/util/db-path.ts`.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import type { IAction, IActionPrecondition, IAnalyzer, IProvider, IProviderWalkOptions, IRawNode } from '../../kernel/extensions/index.js';
import { resolveProviderWalk } from '../../kernel/extensions/index.js';
import type { Job, JobExtensionKind, Node } from '../../kernel/types.js';
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
  buildReportContract,
  renderJobContent,
  resolvePriority,
  resolveSubmitTarget,
  resolveTtl,
  unescapeUserContentClose,
} from '../../kernel/jobs/index.js';
import { sha256 } from '../../kernel/orchestrator/node-build.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { walkContent } from '../../kernel/scan/walk-content.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { buildReadVersionCheck } from '../util/db-version-check.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { assertNoDriftForWrite } from '../../core/sqlite/db-version-runner.js';
import { ExitCode, type TExitCode } from '../util/exit-codes.js';
import { JOBS_QUEUE_TEXTS as T } from '../i18n/jobs-queue.texts.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { withSqlite } from '../util/with-sqlite.js';
import { loadActionRuntime, type IActionRuntime } from './action-runtime.js';
import { recordFailedOutcome } from './record-outcome.js';

/**
 * A queue-eligible extension: the submit surface is kind-agnostic
 * (`spec/cli-contract.md` §Jobs), a probabilistic Action and a
 * probabilistic finder Analyzer render, enqueue, and record through the
 * same machinery. Both kinds carry the fields the submit path reads
 * (`id` / `pluginId` / `version` / `mode` / `precondition` /
 * `probExpectedDurationSeconds` / inlined `promptTemplate`).
 */
type TQueueableExtension = IAction | IAnalyzer;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

/** Outcome of the submit-time on-disk read + drift verification. */
type TNodeBodyRead =
  | { kind: 'ok'; body: string }
  /** File missing / unreadable / not yielded by the provider walk. */
  | { kind: 'unreadable'; detail: string }
  /** The on-disk body no longer hashes to the scanned `bodyHash`. */
  | { kind: 'drift' };

/**
 * Default walk for a node whose Provider is not in the composed set (an
 * individually disabled provider extension whose nodes survive in a stale
 * scan): the kernel walker's default read config (`.md` +
 * `frontmatter-yaml`), the same fallback `resolveProviderWalk` applies
 * when a Provider declares no `read`. If the real provider parsed the
 * file differently, the drift verification below refuses (safe failure:
 * never renders bytes that don't match the scanned hash).
 */
function defaultProviderWalk(
  roots: string[],
  options?: IProviderWalkOptions,
): AsyncIterable<IRawNode> {
  return walkContent(roots, {
    extensions: ['.md'],
    parser: 'frontmatter-yaml',
    ...(options?.scopedPaths !== undefined ? { scopedPaths: options.scopedPaths } : {}),
  });
}

/**
 * Read the node's CURRENT on-disk body through the same Provider walk
 * pipeline the scan uses (scoped to this one file, so the declared parser
 * + `bodyField` rules apply, e.g. a codex TOML sub-agent's
 * `developer_instructions`), and verify it still hashes to the scanned
 * `bodyHash` (`spec/job-lifecycle.md` §Submit step 8). The DB stores only
 * hashes, never body text, so the render can only source disk bytes;
 * without this check an edit-after-scan would silently render content the
 * stored `contentHash` does not describe.
 */
async function readNodeBodyVerified(
  cwd: string,
  node: Node,
  providers: readonly IProvider[],
): Promise<TNodeBodyRead> {
  const provider = providers.find((p) => p.id === node.provider);
  const walk = provider !== undefined ? resolveProviderWalk(provider) : defaultProviderWalk;
  const abs = resolve(cwd, node.path);
  let raw: IRawNode | null = null;
  try {
    for await (const rec of walk([cwd], { scopedPaths: [abs] })) {
      // The scoped walk yields at most one record for the kernel walker;
      // a custom Provider `walk()` may ignore the hint and traverse, so
      // match on the node path.
      if (rec.path === node.path) {
        raw = rec;
        break;
      }
    }
  } catch (err) {
    return { kind: 'unreadable', detail: formatErrorMessage(err) };
  }
  if (raw === null) {
    return { kind: 'unreadable', detail: T.submitReadNotOnDisk };
  }
  if (sha256(raw.body) !== node.bodyHash) return { kind: 'drift' };
  return { kind: 'ok', body: raw.body };
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

/**
 * Public projection of a `Job` for the read surfaces (`sm job list --json`
 * / `sm job show --json`): every field EXCEPT `nonce`. The nonce is the
 * sole record credential and travels only on the contracted carriers,
 * `sm job submit --json` (creator envelope) and `sm job claim --json`
 * (handover). See `spec/job-lifecycle.md` §Atomic claim · Nonce exposure.
 */
function toPublicJob(job: Job): Omit<Job, 'nonce'> {
  const { nonce: _nonce, ...pub } = job;
  return pub;
}

// ---------------------------------------------------------------------------
// sm job submit
// ---------------------------------------------------------------------------

type TSubmitOutcome =
  | { kind: 'created'; nodeId: string; id: string }
  | { kind: 'duplicate'; nodeId: string; existingId: string }
  /** On-disk body no longer matches the scanned hash (exit 2 single-target). */
  | { kind: 'drift'; nodeId: string }
  /** Node file missing / unreadable at submit (exit 2 single-target). */
  | { kind: 'unreadable'; nodeId: string; detail: string };

interface ISubmitContext {
  extensionId: string;
  extensionVersion: string;
  /**
   * Extension kind the submit target resolution picked (it knows which
   * registry the match came from), frozen onto `state_jobs.extension_kind`
   * like the version so `sm record` routes without re-resolving.
   */
  extensionKind: JobExtensionKind;
  promptTemplate: string;
  preamble: string;
  /**
   * Rendered report-contract section (`spec/job-lifecycle.md` §Submit
   * step 9): the extension's report schema chain, inlined verbatim so
   * the job is self-contained. Renders before the `<user-content>`
   * block and folds into `promptTemplateHash`.
   */
  reportContract: string;
  promptTemplateHash: string;
  /** Optional operator-armed TTL; `null` = never expires (the default). */
  ttlSeconds: number | null;
  priority: number;
  cwd: string;
  force: boolean;
  /** Composed Providers; the drift verification re-reads bodies through them. */
  providers: readonly IProvider[];
}

export class JobSubmitCommand extends SmCommand {
  static override paths = [['job', 'submit']];
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
    const resolved = this.resolveTargetOrExit(runtime);
    if (typeof resolved === 'number') return resolved;

    const prepared = this.prepareSubmit(
      resolved,
      runtime,
      jobs,
      flags.ttl,
      flags.priority,
      ctx.cwd,
    );
    if (typeof prepared === 'number') return prepared;

    return withSqlite({ databasePath: dbPath, autoBackup: false }, (adapter) =>
      this.dispatch(adapter, resolved.extension, prepared),
    );
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

  /**
   * Resolve the submit target across probabilistic Actions AND
   * probabilistic Analyzers (`spec/cli-contract.md` §Jobs) + enforce the
   * probabilistic gate. Exit 5 when nothing matches at all, exit 2 when
   * only a deterministic extension matches (runs in-process) or when
   * the unprefixed form is ambiguous across kinds (the `<kind>:`
   * disambiguators are always accepted). Returns the matched extension
   * plus its on-disk directory (undefined for built-ins).
   */
  private resolveTargetOrExit(
    runtime: IActionRuntime,
  ):
    | { extension: TQueueableExtension; dir: string | undefined; extensionKind: JobExtensionKind }
    | TExitCode {
    const resolution = resolveSubmitTarget(runtime.actions, runtime.analyzers, this.extension);
    if (resolution.outcome === 'not-found') {
      this.printer!.error(
        tx(T.submitErrPrefix, {
          glyph: this.errGlyph(),
          message: tx(T.submitErrExtensionNotFound, { extension: this.extension }),
        }),
      );
      return ExitCode.NotFound;
    }
    if (resolution.outcome === 'deterministic') {
      return this.fail(
        tx(T.submitErrExtensionNotProbabilistic, {
          extension: this.extension,
          mode: resolution.mode,
        }),
      );
    }
    if (resolution.outcome === 'ambiguous') {
      return this.fail(
        tx(T.submitErrAmbiguousExtension, {
          extension: this.extension,
          actionId: resolution.actionId,
          analyzerId: resolution.analyzerId,
        }),
      );
    }
    const extension = resolution.extension;
    const qualified = qualifiedExtensionId(extension.pluginId, extension.id);
    const dir =
      resolution.outcome === 'action'
        ? runtime.dirByAction.get(qualified)
        : runtime.dirByAnalyzer.get(qualified);
    // The resolution outcome IS the frozen kind: it names the registry
    // the match came from (spec/job-lifecycle.md §Submit step 1).
    return { extension, dir, extensionKind: resolution.outcome };
  }

  /**
   * Resolve prompt template + preamble + hashes + TTL / priority (constant
   * across the fan-out). Kind-agnostic: `extension` is the resolved
   * probabilistic Action or Analyzer and `dir` its on-disk directory
   * (undefined for built-ins, which resolve through the codegen-inlined
   * `promptTemplate`). TTL uses the extension's
   * `probExpectedDurationSeconds` identically for both kinds. Returns the
   * shared submit context or an exit code on failure.
   */
  private prepareSubmit(
    resolved: {
      extension: TQueueableExtension;
      dir: string | undefined;
      extensionKind: JobExtensionKind;
    },
    runtime: IActionRuntime,
    jobs: IJobsConfig,
    flagTtl: number | undefined,
    flagPriority: number | undefined,
    cwd: string,
  ): ISubmitContext | TExitCode {
    const { extension, dir } = resolved;
    const extensionId = qualifiedExtensionId(extension.pluginId, extension.id);
    let promptTemplate: string;
    if (dir !== undefined) {
      // On-disk plugin: resolve prompt.md from the extension's source dir.
      try {
        promptTemplate = readFileSync(join(dir, 'prompt.md'), 'utf8');
      } catch (err) {
        return this.fail(
          tx(T.submitErrPromptUnresolved, { extension: this.extension, detail: formatErrorMessage(err) }),
        );
      }
    } else if (typeof extension.promptTemplate === 'string') {
      // Built-in probabilistic extension: no source dir at runtime, the
      // built-ins codegen inlined prompt.md onto the manifest.
      promptTemplate = extension.promptTemplate;
    } else {
      return this.fail(
        tx(T.submitErrPromptUnresolved, { extension: this.extension, detail: 'no source directory' }),
      );
    }
    const reportContract = this.resolveReportContract(extension, dir);
    if (typeof reportContract === 'number') return reportContract;
    const preamble = loadCanonicalPreamble();
    let ttlSeconds: number | null;
    let priority: number;
    try {
      ttlSeconds = resolveTtl(extension, jobs, flagTtl);
      priority = resolvePriority(extension, jobs, flagPriority);
    } catch (err) {
      if (err instanceof InvalidTtlError || err instanceof InvalidPriorityError) {
        return this.fail(err.message);
      }
      throw err;
    }
    return {
      extensionId,
      extensionVersion: extension.version,
      extensionKind: resolved.extensionKind,
      promptTemplate,
      preamble,
      reportContract,
      // The whole kernel-authored prelude hashes (spec/prompt-preamble.md):
      // preamble + template + report-contract blocks, so a schema edit
      // re-keys the content exactly like a template edit does.
      promptTemplateHash: computePromptTemplateHash({
        preamble,
        template: promptTemplate,
        reportContract,
      }),
      ttlSeconds,
      priority,
      cwd,
      force: this.force,
      providers: runtime.providers,
    };
  }

  /**
   * Compose the report-contract section for the resolved extension
   * (`spec/job-lifecycle.md` §Submit step 9). The extension's own schema
   * bytes come VERBATIM from its on-disk `report.schema.json` (plugin) or
   * from the codegen-inlined `reportSchema` object serialized
   * deterministically (built-in, stable key order as authored); the
   * canonical envelope + report-base blocks are resolved inside
   * `buildReportContract` from the installed spec package. Exit 2 when
   * the schema cannot be resolved (mirrors the prompt-template failure).
   */
  private resolveReportContract(
    extension: TQueueableExtension,
    dir: string | undefined,
  ): string | TExitCode {
    let schemaText: string;
    let schema: Record<string, unknown>;
    if (dir !== undefined) {
      try {
        schemaText = readFileSync(join(dir, 'report.schema.json'), 'utf8');
        schema = JSON.parse(schemaText) as Record<string, unknown>;
      } catch (err) {
        return this.fail(
          tx(T.submitErrReportSchemaUnresolved, {
            extension: this.extension,
            detail: formatErrorMessage(err),
          }),
        );
      }
    } else if (extension.reportSchema && typeof extension.reportSchema === 'object') {
      schema = extension.reportSchema;
      schemaText = JSON.stringify(extension.reportSchema, null, 2);
    } else {
      return this.fail(
        tx(T.submitErrReportSchemaUnresolved, {
          extension: this.extension,
          detail: 'no source directory',
        }),
      );
    }
    return buildReportContract({ schemaText, schema });
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
    return this.reportSingle(adapter, outcome);
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
    const refused = outcomes.filter(
      (o): o is Exclude<TSubmitOutcome, { kind: 'created' }> => o.kind !== 'created',
    );
    if (this.json) {
      this.printer!.data(
        JSON.stringify({
          submitted: submitted.map((o) => ({ id: (o as { id: string }).id, nodeId: o.nodeId })),
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
        tx(T.submitQueuedLine, { glyph: this.okGlyph(), id: (o as { id: string }).id, node: o.nodeId }),
      );
    }
    for (const o of refused) {
      this.printer!.info(this.toRefusedLine(o));
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
    return { nodeId: o.nodeId, reason: 'drift' };
  }

  /** Per-node refusal line for the `--all` human summary. */
  private toRefusedLine(o: Exclude<TSubmitOutcome, { kind: 'created' }>): string {
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

/**
 * Submit exactly one job for `node`. Duplicate pre-check first (skipped by
 * `--force`), then the on-disk read + drift verification
 * (`spec/job-lifecycle.md` §Submit step 8, NEVER skipped), then render +
 * submit in one transaction. A UNIQUE index violation (the hard backstop
 * `--force` cannot defeat) is surfaced as a duplicate too.
 */
async function submitOneJob(
  adapter: StoragePort,
  node: Node,
  prepared: ISubmitContext,
): Promise<TSubmitOutcome> {
  const contentHash = computeContentHash({
    extensionId: prepared.extensionId,
    extensionVersion: prepared.extensionVersion,
    nodePath: node.path,
    bodyHash: node.bodyHash,
    frontmatterHash: node.frontmatterHash,
    promptTemplateHash: prepared.promptTemplateHash,
  });

  if (!prepared.force) {
    const existing = await adapter.jobs.findActiveDuplicate(
      prepared.extensionId,
      prepared.extensionVersion,
      node.path,
      contentHash,
    );
    if (existing) return { kind: 'duplicate', nodeId: node.path, existingId: existing };
  }

  const read = await readNodeBodyVerified(prepared.cwd, node, prepared.providers);
  if (read.kind === 'drift') return { kind: 'drift', nodeId: node.path };
  if (read.kind === 'unreadable') {
    return { kind: 'unreadable', nodeId: node.path, detail: read.detail };
  }
  const content = renderJobContent({
    node,
    nodeBody: read.body,
    promptTemplate: prepared.promptTemplate,
    preamble: prepared.preamble,
    reportContract: prepared.reportContract,
  });
  const now = Date.now();
  const id = generateJobId();
  const row = {
    id,
    extensionId: prepared.extensionId,
    extensionVersion: prepared.extensionVersion,
    extensionKind: prepared.extensionKind,
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
      prepared.extensionId,
      prepared.extensionVersion,
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
  static override paths = [['job', 'preview']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Print the rendered content of a job without executing it (reads from state_job_contents; no on-disk artifact).',
    details: `
      With <job.id>: preview that job. With --last: preview the most
      recently submitted job (newest createdAt, any status), the natural
      follow-up to sm job submit without copying the id. Pass exactly one
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
// sm job claim
// ---------------------------------------------------------------------------

export class JobClaimCommand extends SmCommand {
  static override paths = [['job', 'claim']];
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
      reaped jobs surface via sm job list --status failed, never on this
      verb's stdout.

      Plain mode prints the claimed id. --json prints
      { id, nonce, content } (the rendered content plus the nonce a later
      sm record needs); agents that will call sm record MUST use --json to
      receive the nonce. --filter accepts a qualified <plugin>/<ext> id
      or a bare extension id (same matching as sm job list --extension).

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
      if (content === null) return this.failClaimContentMissing(adapter, claim.id);
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
    }
    this.printer!.error(
      tx(T.claimErrContentMissing, { glyph: this.ansiFor('stderr').red('✕'), id: jobId }),
    );
    return ExitCode.Error;
  }
}

// ---------------------------------------------------------------------------
// sm job status
// ---------------------------------------------------------------------------

export class JobStatusCommand extends SmCommand {
  static override paths = [['job', 'status']];
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
// sm job cancel
// ---------------------------------------------------------------------------

export class JobCancelCommand extends SmCommand {
  static override paths = [['job', 'cancel']];
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

      To instead mark a job as failed by operator decision, use sm job fail.
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
      return this.all ? this.cancelAll(adapter, now) : this.cancelOne(adapter, now);
    });
  }

  private async cancelAll(adapter: StoragePort, now: number): Promise<TExitCode> {
    const count = await adapter.jobs.cancelAllActive(now);
    if (this.json) {
      this.printer!.data(JSON.stringify({ cancelled: count }) + '\n');
      return ExitCode.Ok;
    }
    this.printer!.info(tx(T.cancelAllSummary, { glyph: this.ansiFor('stderr').green('✓'), count }));
    return ExitCode.Ok;
  }

  private async cancelOne(adapter: StoragePort, now: number): Promise<TExitCode> {
    const outcome = await adapter.jobs.cancel(this.id!, now);
    if (outcome === 'not-found') {
      return this.fail(tx(T.cancelErrNotFound, { id: this.id! }), ExitCode.NotFound);
    }
    if (outcome === 'already-terminal') {
      return this.fail(tx(T.cancelErrAlreadyTerminal, { id: this.id! }), ExitCode.Error);
    }
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
// sm job fail
// ---------------------------------------------------------------------------

export class JobFailCommand extends SmCommand {
  static override paths = [['job', 'fail']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Force a queued / running job to failed with reason user-failed (or --all).',
    details: `
      Symmetric counterpart to sm job cancel. With <job.id>: fail one job. A
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
      return this.all ? this.failAll(adapter, now) : this.failOne(adapter, now);
    });
  }

  private async failAll(adapter: StoragePort, now: number): Promise<TExitCode> {
    const count = await adapter.jobs.failAllActive(now);
    if (this.json) {
      this.printer!.data(JSON.stringify({ failed: count }) + '\n');
      return ExitCode.Ok;
    }
    this.printer!.info(tx(T.failAllSummary, { glyph: this.ansiFor('stderr').green('✓'), count }));
    return ExitCode.Ok;
  }

  private async failOne(adapter: StoragePort, now: number): Promise<TExitCode> {
    const outcome = await adapter.jobs.fail(this.id!, now);
    if (outcome === 'not-found') {
      return this.fail(tx(T.failErrNotFound, { id: this.id! }), ExitCode.NotFound);
    }
    if (outcome === 'already-terminal') {
      return this.fail(tx(T.failErrAlreadyTerminal, { id: this.id! }), ExitCode.Error);
    }
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
