/**
 * The shared job-submit engine, the SINGLE source of every submit rule
 * (`spec/job-lifecycle.md` §Submit): target resolution + the
 * probabilistic gate, prompt / report-contract resolution, TTL /
 * priority resolution from config, the duplicate pre-check, the on-disk
 * read + drift verification, fixer findings injection, the fixer
 * supersede rule, and the transactional row + content insert.
 *
 * Moved down from `cli/commands/job-queue.ts` so every operator surface
 * inherits the same machinery instead of re-implementing it:
 *
 *   - `sm jobs submit` (`cli/commands/job-queue.ts: JobSubmitCommand`)
 *     maps the structured outcomes to its exit codes + stderr advisories;
 *   - the record-path `core/auto-fix` hook (`cli/commands/record.ts`)
 *     chains finder -> fixer through `submitFixerJob`;
 *   - the BFF (`POST /api/nodes/:pathB64/jobs`, `spec/cli-contract.md`
 *     §Serve) maps the same outcomes to its envelope error codes.
 *
 * Everything here is printer-free and Clipanion-free by construction:
 * failures and refusals travel as structured values (`TPrepareError`,
 * `TSubmitOutcome`, `TFixerSubmitResult`), never as rendered text or
 * exit codes. The processing-agent gate deliberately stays OUT of this
 * engine: it applies only on operator surfaces (the CLI command and the
 * BFF route probe `processingSkillPresence` themselves), while the
 * auto-fix hook path must keep bypassing it (it fires inside
 * `sm record`, where an agent is demonstrably processing the queue).
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { IAction, IActionPrecondition, IAnalyzer, IProvider, IProviderWalkOptions, IRawNode } from '../../kernel/extensions/index.js';
import { resolveProviderWalk } from '../../kernel/extensions/index.js';
import type { JobExtensionKind, Node } from '../../kernel/types.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import type { IJobsConfig } from '../../kernel/config/loader.js';
import {
  buildFindingsSection,
  computeContentHash,
  computePromptTemplateHash,
  generateJobId,
  generateNonce,
  InvalidPriorityError,
  InvalidTtlError,
  loadCanonicalPreamble,
  buildReportContract,
  renderJobContent,
  resolvePriority,
  resolveSubmitTarget,
  resolveTtl,
  selectFixerFindings,
} from '../../kernel/jobs/index.js';
import { sha256 } from '../../kernel/orchestrator/node-build.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { walkContent } from '../../kernel/scan/walk-content.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';

import type { IActionRuntime } from './action-runtime.js';
import { SUBMIT_ENGINE_TEXTS as T } from './i18n/submit-engine.texts.js';

/**
 * Match a node against an extension precondition (the `sm jobs submit
 * --all` fan-out gate, also the BFF's launcher-classification predicate
 * on `GET /api/nodes/:pathB64/prob-extensions`). Mirrors the extractor
 * kind matcher (segment-after-slash) and adds a provider gate against
 * the node's own provider. `analyzerIds` is NOT a fan-out gate (it
 * drives fixer findings injection / "resolve this issue" affordances,
 * not node-kind eligibility), so it is intentionally ignored here.
 * `IExtensionPrecondition` (Analyzers) is structurally assignable to
 * `IActionPrecondition`, so both kinds match through this one predicate.
 */
export function nodeMatchesPrecondition(node: Node, precondition?: IActionPrecondition): boolean {
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

/**
 * A queue-eligible extension: the submit surface is kind-agnostic
 * (`spec/cli-contract.md` §Jobs), a probabilistic Action and a
 * probabilistic finder Analyzer render, enqueue, and record through the
 * same machinery. Both kinds carry the fields the submit path reads
 * (`id` / `pluginId` / `version` / `mode` / `precondition` /
 * `probExpectedDurationSeconds` / inlined `promptTemplate`).
 */
export type TQueueableExtension = IAction | IAnalyzer;

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
export function fixerAnalyzerIds(
  extensionKind: JobExtensionKind,
  extension: TQueueableExtension,
): readonly string[] | undefined {
  if (extensionKind !== 'action') return undefined;
  const ids = (extension as IAction).precondition?.analyzerIds;
  return ids !== undefined && ids.length > 0 ? ids : undefined;
}

/** Detect a SQLite UNIQUE-constraint failure (the partial-index backstop). */
export function isUniqueConstraintError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /unique constraint failed/i.test(message);
}

export type TSubmitOutcome =
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

export interface ISubmitContext {
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
export async function submitOneJob(
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
// Submit preparation (shared by `sm jobs submit`, the record-path
// `core/auto-fix` hook via `submitFixerJob`, and the BFF submit route).
// ---------------------------------------------------------------------------

/**
 * Structured failure of `prepareSubmitContext`, mapped by the CLI command
 * to its directed error output + exit code (`failPrepare`), by
 * `submitFixerJob` to a `not-submittable` result it swallows, and by the
 * BFF to its envelope error codes.
 */
export type TPrepareError =
  | { kind: 'not-found' }
  | { kind: 'deterministic'; mode: string }
  | { kind: 'ambiguous'; actionId: string; analyzerId: string }
  | { kind: 'prompt-unresolved'; detail: string }
  | { kind: 'report-schema-unresolved'; detail: string }
  | { kind: 'invalid-ttl'; message: string }
  | { kind: 'invalid-priority'; message: string };

export type TPrepareOutcome =
  | { ok: true; extension: TQueueableExtension; prepared: ISubmitContext }
  | { ok: false; error: TPrepareError };

/**
 * Resolve the submit target (probabilistic Action or finder Analyzer,
 * `spec/cli-contract.md` §Jobs) and prepare the constant-across-fan-out
 * submit context: prompt template, report contract, preamble, TTL /
 * priority, hashes, and the fixer `analyzerIds`. PURE (no printing, no DB):
 * every failure returns a structured `TPrepareError` so every caller, the
 * CLI command's `failPrepare`, the hook's `submitFixerJob`, and the BFF
 * submit route, decides how to surface it. This is the extraction that
 * keeps `sm jobs submit` byte-identical while letting the auto-fix hook
 * render a real, injected, superseding fixer job (not a bare row).
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
