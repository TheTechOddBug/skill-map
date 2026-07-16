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
  buildFindingsSection,
  computeContentHash,
  computePromptTemplateHash,
  generateJobId,
  generateNonce,
  InvalidPriorityError,
  InvalidTtlError,
  type ISuppressionMatch,
  JobRenderError,
  loadCanonicalPreamble,
  buildReportContract,
  renderJobContent,
  resolvePriority,
  resolveSubmitTarget,
  resolveTtl,
  selectFixerFindings,
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
import { readActiveSuppressions } from '../util/sidecar-suppressions.js';
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

/**
 * The fixer's `precondition.analyzerIds` when the submit target is a
 * probabilistic Action declaring a NON-EMPTY list (a FIXER,
 * `spec/job-lifecycle.md` §Findings injection for fixers); `undefined`
 * otherwise (a finder Analyzer, or an Action without `analyzerIds`, renders
 * as today). `analyzerIds` lives only on `IActionPrecondition`, so a finder
 * never reaches the cast.
 */
function fixerAnalyzerIds(
  extensionKind: JobExtensionKind,
  extension: TQueueableExtension,
): readonly string[] | undefined {
  if (extensionKind !== 'action') return undefined;
  const ids = (extension as IAction).precondition?.analyzerIds;
  return ids !== undefined && ids.length > 0 ? ids : undefined;
}

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

type TSubmitOutcome =
  | {
      kind: 'created';
      nodeId: string;
      id: string;
      /**
       * Stale queued sibling ids a FIXER submit cancelled in the same
       * transaction (`spec/job-lifecycle.md` §Findings injection for fixers ·
       * Supersede). Empty for non-fixer submits and for fixers with nothing
       * to supersede; a non-empty list rides a human-mode stderr advisory.
       */
      supersededIds: string[];
    }
  | { kind: 'duplicate'; nodeId: string; existingId: string }
  /** On-disk body no longer matches the scanned hash (exit 2 single-target). */
  | { kind: 'drift'; nodeId: string }
  /** Node file missing / unreadable at submit (exit 2 single-target). */
  | { kind: 'unreadable'; nodeId: string; detail: string }
  /**
   * Fixer submitted over a node with NO matching findings at all, fresh or
   * stale (exit 2 single-target, per-node non-fatal in `--all`);
   * `spec/job-lifecycle.md` §Findings injection for fixers.
   */
  | { kind: 'no-findings'; nodeId: string };

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
  /**
   * The fixer's declared `precondition.analyzerIds` when the submit target
   * is a probabilistic Action that declares a non-empty list (a FIXER,
   * `spec/job-lifecycle.md` §Findings injection for fixers); `undefined`
   * for non-fixer submits (a finder Analyzer or an Action without
   * `analyzerIds`). When set, `submitOneJob` selects the node's current
   * non-stale findings for these ids and injects them, re-keying the
   * content per node; `undefined` leaves the render exactly as before.
   */
  analyzerIds: readonly string[] | undefined;
  /** Optional operator-armed TTL; `null` = never expires (the default). */
  ttlSeconds: number | null;
  priority: number;
  cwd: string;
  force: boolean;
  /** Composed Providers; the drift verification re-reads bodies through them. */
  providers: readonly IProvider[];
}

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

    return withSqlite({ databasePath: dbPath, autoBackup: false }, (adapter) =>
      this.dispatch(adapter, prep.extension, prep.prepared),
    );
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

  private reportAll(
    outcomes: readonly TSubmitOutcome[],
    total: number,
    prepared: ISubmitContext,
  ): TExitCode {
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
      // Per-node fixer supersede advisory (each fan-out submit applies the
      // Supersede rule independently, spec §Findings injection for fixers).
      this.emitSupersededAdvisory((o as { supersededIds?: string[] }).supersededIds ?? []);
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

/**
 * Per-node render inputs, resolved AFTER the fixer selection: the (optional)
 * findings-to-resolve section and the `promptTemplateHash` that keys the
 * content. `'no-findings'` is a refusal (a fixer over a node no finder of
 * its lane ever judged, fresh or stale).
 */
type TJobRenderInputs =
  | 'no-findings'
  | { findingsSection: string | undefined; promptTemplateHash: string };

/**
 * Resolve the per-node render inputs. Non-fixer submits (`analyzerIds`
 * undefined) reuse the precomputed base `promptTemplateHash` and inject no
 * section, byte-identical to before the fixer feature. A FIXER
 * (`spec/job-lifecycle.md` §Findings injection for fixers) selects THIS
 * node's extension-lane findings for its analyzers, stale ones INCLUDED
 * (hence `includeStale: true`, the adapter hides them by default): they
 * ride flagged and the agent verifies each against the current body. Only
 * an empty selection (no matching findings at all) refuses
 * (`'no-findings'`); a non-empty one renders the `## Findings to resolve`
 * section and folds it into a per-node `promptTemplateHash` so a changed
 * finding set is a distinct job.
 */
async function resolveJobRenderInputs(
  adapter: StoragePort,
  node: Node,
  prepared: ISubmitContext,
): Promise<TJobRenderInputs> {
  if (prepared.analyzerIds === undefined) {
    return { findingsSection: undefined, promptTemplateHash: prepared.promptTemplateHash };
  }
  const nodeFindings = await adapter.findings.list({ nodeId: node.path, includeStale: true });
  const selected = selectFixerFindings(nodeFindings, prepared.analyzerIds);
  if (selected.length === 0) return 'no-findings';
  const findingsSection = buildFindingsSection(selected);
  return {
    findingsSection,
    promptTemplateHash: computePromptTemplateHash({
      preamble: prepared.preamble,
      template: prepared.promptTemplate,
      findingsSection,
      reportContract: prepared.reportContract,
    }),
  };
}

/**
 * Insert the queued row + its content in one transaction. A UNIQUE index
 * violation (the hard backstop `--force` cannot defeat) is surfaced as a
 * duplicate too.
 */
async function insertJobRow(
  adapter: StoragePort,
  node: Node,
  prepared: ISubmitContext,
  contentHash: string,
  content: string,
): Promise<TSubmitOutcome> {
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
    return { kind: 'created', nodeId: node.path, id, supersededIds: [] };
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

/**
 * Fixer variant of `insertJobRow` (`spec/job-lifecycle.md` §Findings injection
 * for fixers · Supersede). The atomic `submitFixer` finds any ACTIVE job for
 * the `(extensionId, nodeId)` pair and, in ONE transaction, CANCELS the stale
 * queued siblings (a different `contentHash`: the finding set or the body
 * changed since they were queued) before enqueuing the new job. An IDENTICAL
 * queued request keeps the plain duplicate refusal (exit 3); a RUNNING job is
 * never superseded and refuses (exit 3, naming it, reusing the duplicate
 * reporting, a running job IS an active job already covering the node). The
 * `catch` mirrors `insertJobRow`: a partial-index violation from a concurrent
 * insert surfaces as a duplicate too, though `submitFixer` detects the
 * same-hash case explicitly so the insert normally never trips it.
 */
async function insertFixerJobRow(
  adapter: StoragePort,
  node: Node,
  prepared: ISubmitContext,
  contentHash: string,
  content: string,
): Promise<TSubmitOutcome> {
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
    const result = await adapter.jobs.submitFixer(row, { contentHash, content, createdAt: now });
    if (result.outcome === 'running-conflict') {
      return { kind: 'duplicate', nodeId: node.path, existingId: result.runningId };
    }
    if (result.outcome === 'duplicate') {
      return { kind: 'duplicate', nodeId: node.path, existingId: result.existingId };
    }
    return { kind: 'created', nodeId: node.path, id, supersededIds: result.supersededIds };
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

/**
 * Submit exactly one job for `node`. Fixer findings selection + refusal
 * first (`spec/job-lifecycle.md` §Findings injection for fixers), then the
 * duplicate pre-check (skipped by `--force`), then the on-disk read + drift
 * verification (§Submit step 8, NEVER skipped), then render + insert.
 */
async function submitOneJob(
  adapter: StoragePort,
  node: Node,
  prepared: ISubmitContext,
): Promise<TSubmitOutcome> {
  const inputs = await resolveJobRenderInputs(adapter, node, prepared);
  if (inputs === 'no-findings') return { kind: 'no-findings', nodeId: node.path };

  const contentHash = computeContentHash({
    extensionId: prepared.extensionId,
    extensionVersion: prepared.extensionVersion,
    nodePath: node.path,
    bodyHash: node.bodyHash,
    frontmatterHash: node.frontmatterHash,
    promptTemplateHash: inputs.promptTemplateHash,
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
    ...(inputs.findingsSection !== undefined ? { findingsSection: inputs.findingsSection } : {}),
    reportContract: prepared.reportContract,
  });
  // A FIXER submit (`analyzerIds` set) supersedes stale queued siblings in one
  // transaction; a non-fixer submit inserts with the plain duplicate backstop.
  return prepared.analyzerIds !== undefined
    ? insertFixerJobRow(adapter, node, prepared, contentHash, content)
    : insertJobRow(adapter, node, prepared, contentHash, content);
}

// ---------------------------------------------------------------------------
// Shared submit preparation (used by `sm jobs submit` AND the record-path
// `core/auto-fix` hook via `submitFixerJob`).
// ---------------------------------------------------------------------------

/**
 * Structured failure of `prepareSubmitContext`, mapped by the CLI command
 * to its directed error output + exit code (`failPrepare`) and by
 * `submitFixerJob` to a `not-submittable` result it swallows.
 */
export type TPrepareError =
  | { kind: 'not-found' }
  | { kind: 'deterministic'; mode: string }
  | { kind: 'ambiguous'; actionId: string; analyzerId: string }
  | { kind: 'prompt-unresolved'; detail: string }
  | { kind: 'report-schema-unresolved'; detail: string }
  | { kind: 'invalid-ttl'; message: string }
  | { kind: 'invalid-priority'; message: string };

type TPrepareOutcome =
  | { ok: true; extension: TQueueableExtension; prepared: ISubmitContext }
  | { ok: false; error: TPrepareError };

/**
 * Resolve the submit target (probabilistic Action or finder Analyzer,
 * `spec/cli-contract.md` §Jobs) and prepare the constant-across-fan-out
 * submit context: prompt template, report contract, preamble, TTL /
 * priority, hashes, and the fixer `analyzerIds`. PURE (no printing, no DB):
 * every failure returns a structured `TPrepareError` so BOTH callers, the
 * CLI command's `failPrepare` and the hook's `submitFixerJob`, decide how
 * to surface it. This is the extraction that keeps `sm jobs submit`
 * byte-identical while letting the auto-fix hook render a real, injected,
 * superseding fixer job (not a bare row).
 */
export function prepareSubmitContext(opts: {
  runtime: IActionRuntime;
  jobs: IJobsConfig;
  extensionId: string;
  cwd: string;
  force: boolean;
  flagTtl: number | undefined;
  flagPriority: number | undefined;
}): TPrepareOutcome {
  const target = resolveQueueTarget(opts.runtime, opts.extensionId);
  if (!target.ok) return target;
  const { extension, qualified, extensionKind, dir } = target;

  const promptTemplate = resolvePromptTemplateText(extension, dir);
  if (!promptTemplate.ok) return { ok: false, error: { kind: 'prompt-unresolved', detail: promptTemplate.detail } };
  const reportContract = resolveReportContractText(extension, dir);
  if (!reportContract.ok) {
    return { ok: false, error: { kind: 'report-schema-unresolved', detail: reportContract.detail } };
  }
  const preamble = loadCanonicalPreamble();
  let ttlSeconds: number | null;
  let priority: number;
  try {
    ttlSeconds = resolveTtl(extension, opts.jobs, opts.flagTtl);
    priority = resolvePriority(extension, opts.jobs, opts.flagPriority);
  } catch (err) {
    if (err instanceof InvalidTtlError) return { ok: false, error: { kind: 'invalid-ttl', message: err.message } };
    if (err instanceof InvalidPriorityError) {
      return { ok: false, error: { kind: 'invalid-priority', message: err.message } };
    }
    throw err;
  }
  const prepared: ISubmitContext = {
    extensionId: qualified,
    extensionVersion: extension.version,
    extensionKind,
    promptTemplate: promptTemplate.text,
    preamble,
    reportContract: reportContract.text,
    analyzerIds: fixerAnalyzerIds(extensionKind, extension),
    promptTemplateHash: computePromptTemplateHash({
      preamble,
      template: promptTemplate.text,
      reportContract: reportContract.text,
    }),
    ttlSeconds,
    priority,
    cwd: opts.cwd,
    force: opts.force,
    providers: opts.runtime.providers,
  };
  return { ok: true, extension, prepared };
}

/**
 * Resolve the submit target across probabilistic Actions + Analyzers and
 * enforce the probabilistic gate, returning the extension, its qualified id,
 * the FROZEN kind (the registry the match came from), and its on-disk dir,
 * or a structured `TPrepareOutcome` failure.
 */
function resolveQueueTarget(
  runtime: IActionRuntime,
  extensionId: string,
):
  | { ok: true; extension: TQueueableExtension; qualified: string; extensionKind: JobExtensionKind; dir: string | undefined }
  | { ok: false; error: TPrepareError } {
  const resolution = resolveSubmitTarget(runtime.actions, runtime.analyzers, extensionId);
  if (resolution.outcome === 'not-found') return { ok: false, error: { kind: 'not-found' } };
  if (resolution.outcome === 'deterministic') {
    return { ok: false, error: { kind: 'deterministic', mode: resolution.mode } };
  }
  if (resolution.outcome === 'ambiguous') {
    return {
      ok: false,
      error: { kind: 'ambiguous', actionId: resolution.actionId, analyzerId: resolution.analyzerId },
    };
  }
  const extension = resolution.extension;
  const qualified = qualifiedExtensionId(extension.pluginId, extension.id);
  const dir =
    resolution.outcome === 'action'
      ? runtime.dirByAction.get(qualified)
      : runtime.dirByAnalyzer.get(qualified);
  return { ok: true, extension, qualified, extensionKind: resolution.outcome, dir };
}

type TResolvedText = { ok: true; text: string } | { ok: false; detail: string };

/**
 * The extension's prompt template: from the on-disk `prompt.md` (plugin) or
 * the codegen-inlined `promptTemplate` (built-in). `spec/job-lifecycle.md`
 * §Submit step 9.
 */
function resolvePromptTemplateText(
  extension: TQueueableExtension,
  dir: string | undefined,
): TResolvedText {
  if (dir !== undefined) {
    try {
      return { ok: true, text: readFileSync(join(dir, 'prompt.md'), 'utf8') };
    } catch (err) {
      return { ok: false, detail: formatErrorMessage(err) };
    }
  }
  if (typeof extension.promptTemplate === 'string') return { ok: true, text: extension.promptTemplate };
  return { ok: false, detail: 'no source directory' };
}

/**
 * The rendered report-contract section (`spec/job-lifecycle.md` §Submit
 * step 9): the extension's report schema bytes VERBATIM (on-disk
 * `report.schema.json` for a plugin, the codegen-inlined `reportSchema`
 * serialized deterministically for a built-in) plus the canonical envelope
 * blocks resolved inside `buildReportContract`.
 */
function resolveReportContractText(
  extension: TQueueableExtension,
  dir: string | undefined,
): TResolvedText {
  let schemaText: string;
  let schema: Record<string, unknown>;
  if (dir !== undefined) {
    try {
      schemaText = readFileSync(join(dir, 'report.schema.json'), 'utf8');
      schema = JSON.parse(schemaText) as Record<string, unknown>;
    } catch (err) {
      return { ok: false, detail: formatErrorMessage(err) };
    }
  } else if (extension.reportSchema && typeof extension.reportSchema === 'object') {
    schema = extension.reportSchema;
    schemaText = JSON.stringify(extension.reportSchema, null, 2);
  } else {
    return { ok: false, detail: 'no source directory' };
  }
  return { ok: true, text: buildReportContract({ schemaText, schema }) };
}

/**
 * Result of `submitFixerJob`, the record-path hook's queue sink. Every
 * non-`created` outcome is a benign "nothing queued" case the caller
 * swallows: a fixer over a node with NO matching findings refuses
 * (`no-findings`), a same-request duplicate is already covered, drift /
 * unreadable are transient, `not-submittable` means the id did not resolve
 * to a queueable fixer.
 */
export type TFixerSubmitResult =
  | { kind: 'created'; id: string; supersededIds: readonly string[] }
  | { kind: 'duplicate'; existingId: string }
  | { kind: 'no-findings' }
  | { kind: 'drift' }
  | { kind: 'unreadable'; detail: string }
  | { kind: 'node-not-found' }
  | { kind: 'node-virtual' }
  | { kind: 'not-submittable'; detail: string };

/**
 * Submit ONE fixer job for `(extensionId, nodeId)`, equivalent to
 * `sm jobs submit <fixer> -n <node>`: the full render (preamble +
 * findings-injection + report contract), the supersede rule, the drift
 * verification, and the `state_job_contents` insert, all through the SAME
 * `submitOneJob` path the CLI uses (`spec/job-lifecycle.md` §Findings
 * injection for fixers). Returns a structured result; it never prints and
 * never throws for the ordinary refusals (the caller, the `core/auto-fix`
 * hook drain, swallows them). Reused so the hook produces a real injected
 * job, not a bare row.
 */
export async function submitFixerJob(
  adapter: StoragePort,
  runtime: IActionRuntime,
  jobs: IJobsConfig,
  target: { extensionId: string; nodeId: string; cwd: string },
): Promise<TFixerSubmitResult> {
  const prep = prepareSubmitContext({
    runtime,
    jobs,
    extensionId: target.extensionId,
    cwd: target.cwd,
    force: false,
    flagTtl: undefined,
    flagPriority: undefined,
  });
  if (!prep.ok) return { kind: 'not-submittable', detail: describePrepareError(prep.error) };
  const bundle = await adapter.scans.findNode(target.nodeId);
  if (!bundle) return { kind: 'node-not-found' };
  if (bundle.node.virtual === true) return { kind: 'node-virtual' };
  return toFixerSubmitResult(await submitOneJob(adapter, bundle.node, prep.prepared));
}

/** Narrow a raw `submitOneJob` outcome to the fixer-submit result shape. */
function toFixerSubmitResult(outcome: TSubmitOutcome): TFixerSubmitResult {
  switch (outcome.kind) {
    case 'created':
      return { kind: 'created', id: outcome.id, supersededIds: outcome.supersededIds };
    case 'duplicate':
      return { kind: 'duplicate', existingId: outcome.existingId };
    case 'no-findings':
      return { kind: 'no-findings' };
    case 'drift':
      return { kind: 'drift' };
    case 'unreadable':
      return { kind: 'unreadable', detail: outcome.detail };
  }
}

/** A short, log-only description of a prepare failure (never user-facing). */
function describePrepareError(error: TPrepareError): string {
  switch (error.kind) {
    case 'not-found':
      return 'extension not found';
    case 'deterministic':
      return `not probabilistic (mode ${error.mode})`;
    case 'ambiguous':
      return 'ambiguous extension id';
    case 'prompt-unresolved':
      return `prompt unresolved: ${error.detail}`;
    case 'report-schema-unresolved':
      return `report schema unresolved: ${error.detail}`;
    case 'invalid-ttl':
    case 'invalid-priority':
      return error.message;
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
