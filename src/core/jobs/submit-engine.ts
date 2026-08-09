/**
 * The shared job-submit engine, the SINGLE source of every submit rule
 * (`spec/job-lifecycle.md` §Submit): target resolution + the
 * probabilistic gate, prompt / report-contract resolution, TTL /
 * priority resolution from config, the duplicate pre-check, the on-disk
 * read + drift verification, fixer findings injection, tagger current-tags
 * injection, the fixer supersede rule, and the transactional row + content
 * insert.
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
  buildCurrentTagsSection,
  buildFindingsSection,
  buildIssuesSection,
  buildSkillSection,
  computeContentHash,
  computePromptTemplateHash,
  generateJobId,
  generateNonce,
  InvalidPriorityError,
  InvalidTtlError,
  isTagsReportSchema,
  loadCanonicalPreamble,
  loadCanonicalSkillTemplate,
  loadSkillActionReportSchema,
  loadSkillActionReportSchemaText,
  nodelessTarget,
  buildReportContract,
  renderJobContent,
  resolvePriority,
  resolveSubmitTarget,
  resolveTtl,
  selectCurrentTags,
  selectFixerFindings,
  selectFixerIssues,
  type TResolvableAction,
} from '../../kernel/jobs/index.js';
import { sha256 } from '../../kernel/orchestrator/node-build.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { walkContent } from '../../kernel/scan/walk-content.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';

import type { IActionRuntime } from './action-runtime.js';
import { referencedAnalyzerMode, type TAnalyzerMode } from './analyzer-mode.js';
import { SUBMIT_ENGINE_TEXTS as T } from './i18n/submit-engine.texts.js';
import { isSkillActionId, type ISkillActionCatalog } from '../skill-actions/catalog.js';

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
  return (
    matchesProviderLeg(node, precondition.provider) &&
    matchesKindLeg(node, precondition.kind) &&
    matchesFrontmatterLeg(node, precondition.frontmatterMissing)
  );
}

/** The `provider` leg of the matcher; absent = pass. */
function matchesProviderLeg(node: Node, providers?: readonly string[]): boolean {
  if (!providers || providers.length === 0) return true;
  return providers.includes(node.provider);
}

/** The `frontmatterMissing` leg of the matcher; absent = pass. */
function matchesFrontmatterLeg(node: Node, fields?: readonly string[]): boolean {
  if (!fields || fields.length === 0) return true;
  return nodeIsMissingFrontmatterField(node, fields);
}

/** The `kind` leg of the matcher (segment-after-slash semantics); absent = pass. */
function matchesKindLeg(node: Node, kinds?: readonly string[]): boolean {
  if (!kinds || kinds.length === 0) return true;
  const qualified = `${node.provider}/${node.kind}`;
  return kinds.some((entry) => {
    if (entry === qualified) return true;
    const slash = entry.indexOf('/');
    const kindOnly = slash === -1 ? entry : entry.slice(slash + 1);
    return kindOnly === node.kind;
  });
}

/**
 * The `frontmatterMissing` gap gate (spec
 * `action.schema.json#/properties/precondition`): true when at least
 * one listed field is absent from the node's frontmatter or carries an
 * empty string. A valueless YAML key (`name:` parses to null) counts as
 * absent; any other non-string value counts as present (the action only
 * writes strings, so it has nothing to add there). A node with no
 * frontmatter block at all is missing every field.
 */
function nodeIsMissingFrontmatterField(node: Node, fields: readonly string[]): boolean {
  return fields.some((field) => {
    const value = node.frontmatter?.[field];
    return value === undefined || value === null || value === '';
  });
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

/**
 * Resolve the frozen `auto_fix` value: the operator's opt-in, CLAMPED to a
 * finder (`analyzer`) target. An Action job never chains, so it must not
 * persist a meaningless flag (`--auto-fix` / body `autoFix` is ignored on a
 * non-finder target, `spec/job-lifecycle.md` §Auto-fix chain (per-job)).
 */
export function resolveAutoFixFlag(
  extensionKind: JobExtensionKind,
  requested: boolean | undefined,
): boolean {
  return extensionKind === 'analyzer' && requested === true;
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
  | { kind: 'no-findings'; nodeId: string }
  /**
   * The submit path and the target disagree about nodes: a nodeless Action
   * submitted through `submitOneJob`, or a node-taking extension through
   * `submitNodelessJob`. A caller bug, never an operator condition.
   */
  | { kind: 'nodeless-mismatch'; nodeId: string };

export interface ISubmitContext {
  extensionId: string;
  extensionVersion: string;
  /**
   * Extension kind the submit target resolution picked (it knows which
   * registry the match came from), frozen onto `state_jobs.extension_kind`
   * like the version so `sm record` routes without re-resolving.
   */
  extensionKind: JobExtensionKind;
  /**
   * Per-job auto-fix opt-in, frozen onto `state_jobs.auto_fix`. Set from the
   * submit surface (`sm jobs submit <finder> --auto-fix`, the BFF body
   * `autoFix`); CLAMPED to `false` for a non-finder target (an Action job
   * never chains), so the persisted flag is honest. When `true`, `sm record`
   * chains the finder's fixers on completion (`spec/job-lifecycle.md`
   * §Auto-fix chain (per-job)).
   */
  autoFix: boolean;
  promptTemplate: string;
  preamble: string;
  /**
   * Rendered skill-instructions section (`buildSkillSection`,
   * `spec/skill-actions.md`). Present ONLY for a SKILL-ACTION submit
   * (`skill:<name>` target): the installed skill's body under the
   * kernel-authored framing, injected FIRST at the `{{userContent}}`
   * seam and folded into `promptTemplateHash` at prepare time (so
   * editing a `SKILL.md` byte re-keys `contentHash`). Absent for every
   * extension target.
   */
  skillSection?: string;
  /**
   * Rendered report-contract section (`spec/job-lifecycle.md` §Submit
   * step 9): the extension's report schema chain, inlined verbatim so
   * the job is self-contained. Renders before the `<user-content>`
   * block and folds into `promptTemplateHash`.
   */
  reportContract: string;
  /**
   * True when the target is a TAGGER: an Action whose report schema `$ref`s
   * a canonical `tags/*.schema.json` (`isTagsReportSchema`, the SAME
   * detector the record path uses to turn a completed report into a tags
   * proposal). Resolved once at prepare time from the report schema the
   * contract resolution already parsed, so the fan-out costs nothing extra.
   * When true, each node's CURRENT tags are injected into its render
   * (`spec/job-lifecycle.md` §Current-tags injection for taggers).
   */
  isTagger: boolean;
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
  /**
   * The resolved execution mode of the analyzer(s) `analyzerIds` name (Modelo
   * B, `spec/architecture.md`), resolved ONCE at prepare time via
   * `referencedAnalyzerMode`. `'deterministic'` routes the fixer through the
   * `## Issues to resolve` injection (the referenced analyzer's `scan_issues`
   * rows); `'probabilistic'` (or `undefined`, an unresolved / disabled finder)
   * keeps the `## Findings to resolve` path (`state_findings`). `undefined`
   * for non-fixer submits (`analyzerIds` undefined).
   */
  analyzerMode: TAnalyzerMode | undefined;
  /**
   * Finding-subset targeting (`spec/job-lifecycle.md` §Findings injection
   * for fixers · Finding-subset targeting), frozen onto
   * `state_jobs.finding_ids_json`: the selection narrows to these ids and
   * the fixer supersede/duplicate/running gates apply per set overlap.
   * `undefined` = whole-node (the historical behaviour). Only valid on a
   * FINDINGS-branch fixer; `prepareSubmitContext` refuses it elsewhere.
   */
  findingIds: readonly number[] | undefined;
  /** Optional operator-armed TTL; `null` = never expires (the default). */
  ttlSeconds: number | null;
  priority: number;
  cwd: string;
  force: boolean;
  /** Composed Providers; the drift verification re-reads bodies through them. */
  providers: readonly IProvider[];
  /**
   * The target Action declares `probNodeless` (`spec/job-lifecycle.md`
   * §Submit · Nodeless submit): it has no node, so the submit runs through
   * `submitNodelessJob` against a synthetic target instead of taking one.
   * `submitOneJob` refuses such an extension, and vice versa, so a surface
   * cannot silently pick the wrong path.
   */
  nodeless: boolean;
}

/**
 * Per-node render inputs, resolved AFTER the fixer selection: the (optional)
 * findings-to-resolve and current-tags sections plus the
 * `promptTemplateHash` that keys the content. `'no-findings'` is a refusal
 * (a fixer over a node no finder of its lane ever judged, fresh or stale).
 */
type TJobRenderInputs =
  | 'no-findings'
  | {
      findingsSection: string | undefined;
      currentTagsSection: string | undefined;
      promptTemplateHash: string;
    };

/**
 * The fixer trigger section for this node, or `'no-findings'` when the
 * selection is empty (the exit-2 refusal). `undefined` for a non-fixer
 * submit (`analyzerIds` undefined), which injects nothing.
 */
type TFixerSection = string | undefined | 'no-findings';

/**
 * Resolve the per-node render inputs. A submit that injects NEITHER section
 * (the common case: not a fixer, not a tagger, or a tagger over an untagged
 * node) reuses the precomputed base `promptTemplateHash`, byte-identical to
 * before either injection feature existed.
 *
 * Both injections are orthogonal and compose in RENDER order
 * (findings, then current tags, then the report contract), and both fold
 * into a per-node `promptTemplateHash`, so a changed trigger set or a
 * changed tag set is a distinct job rather than a stale reuse.
 */
async function resolveJobRenderInputs(
  adapter: StoragePort,
  node: Node,
  prepared: ISubmitContext,
): Promise<TJobRenderInputs> {
  const findingsSection = await resolveFixerSection(adapter, node, prepared);
  if (findingsSection === 'no-findings') return 'no-findings';
  const currentTagsSection = resolveCurrentTagsSection(node, prepared);
  if (findingsSection === undefined && currentTagsSection === undefined) {
    return {
      findingsSection: undefined,
      currentTagsSection: undefined,
      promptTemplateHash: prepared.promptTemplateHash,
    };
  }
  return {
    findingsSection,
    currentTagsSection,
    promptTemplateHash: computePromptTemplateHash({
      preamble: prepared.preamble,
      template: prepared.promptTemplate,
      // Unreachable for a skill submit today (never a fixer, never a
      // tagger, so the fast path above always reuses the prepared hash),
      // but the formula stays consistent whichever branch runs.
      ...(prepared.skillSection !== undefined ? { skillSection: prepared.skillSection } : {}),
      ...(findingsSection !== undefined ? { findingsSection } : {}),
      ...(currentTagsSection !== undefined ? { currentTagsSection } : {}),
      reportContract: prepared.reportContract,
    }),
  };
}

/**
 * The `## Current tags` section for a TAGGER submit
 * (`spec/job-lifecycle.md` §Current-tags injection for taggers). WHY: without
 * it the model infers tags blind to what the node already carries and
 * proposes near-duplicates of them (`deploy` next to an existing
 * `deploy-pipeline`) that a human then reconciles by hand.
 *
 * The tags come off the node the submit path ALREADY resolved: the scan
 * mirror rehydrates `sidecar.annotations` on every `Node`, and
 * `annotations.tags` is the product's only tag source, so this costs no
 * extra read. `undefined` (no section at all) for a non-tagger target and
 * for a tagger over a node carrying no tags, per the spec's omission rule.
 */
function resolveCurrentTagsSection(node: Node, prepared: ISubmitContext): string | undefined {
  if (!prepared.isTagger) return undefined;
  const tags = selectCurrentTags(node);
  return tags.length > 0 ? buildCurrentTagsSection(tags) : undefined;
}

/**
 * Resolve the FIXER trigger section (`spec/job-lifecycle.md` §Findings
 * injection for fixers), branching on the mode of the analyzer it serves
 * (Modelo B, resolved once at prepare time):
 *   - DETERMINISTIC analyzer: select THIS node's `scan_issues` rows for its
 *     analyzers and render a `## Issues to resolve` section (no staleness /
 *     resolution axis, Issues are re-derived each scan);
 *   - PROBABILISTIC finder (the default when the mode is unresolved): select
 *     the node's extension-lane findings, stale ones INCLUDED (hence
 *     `includeStale: true`, the adapter hides them by default) so they ride
 *     flagged for the agent to verify, and render `## Findings to resolve`.
 *
 * Both refuse an EMPTY selection with the content-agnostic `'no-findings'`
 * exit-2 gate (a fixer over a node nothing flagged is a user error).
 */
async function resolveFixerSection(
  adapter: StoragePort,
  node: Node,
  prepared: ISubmitContext,
): Promise<TFixerSection> {
  if (prepared.analyzerIds === undefined) return undefined;
  if (prepared.analyzerMode === 'deterministic') {
    return resolveIssuesSection(adapter, node, prepared);
  }
  const nodeFindings = await adapter.findings.list({ nodeId: node.path, includeStale: true });
  const all = selectFixerFindings(nodeFindings, prepared.analyzerIds);
  // Finding-subset targeting: narrow to the frozen ids when present
  // (unmatched ids simply do not select; an all-unmatched set hits the
  // shared empty-selection refusal below).
  const selected =
    prepared.findingIds === undefined
      ? all
      : all.filter((f) => prepared.findingIds!.includes(f.id));
  if (selected.length === 0) return 'no-findings';
  return buildFindingsSection(selected);
}

/**
 * The deterministic-analyzer branch of `resolveFixerSection`: read the node's
 * Issue bundle (`scan_issues`, via the node bundle), select the rows whose
 * short `analyzerId` matches the fixer's `analyzerIds`, and render the
 * `## Issues to resolve` section. Rides the SAME `findingsSection` seam as the
 * findings branch, so the render, hash, and supersede all stay
 * content-agnostic. An empty selection refuses with the shared
 * `'no-findings'` gate.
 */
async function resolveIssuesSection(
  adapter: StoragePort,
  node: Node,
  prepared: ISubmitContext,
): Promise<TFixerSection> {
  const analyzerIds = prepared.analyzerIds ?? [];
  const bundle = await adapter.scans.findNode(node.path);
  const selected = selectFixerIssues(bundle?.issues ?? [], analyzerIds);
  if (selected.length === 0) return 'no-findings';
  return buildIssuesSection(selected);
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
    autoFix: prepared.autoFix,
    ...(prepared.findingIds !== undefined ? { findingIds: prepared.findingIds } : {}),
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
    autoFix: prepared.autoFix,
    ...(prepared.findingIds !== undefined ? { findingIds: prepared.findingIds } : {}),
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
 * Render the stored content blob from the verified body + the resolved
 * per-node sections. Each kernel-authored section is passed only when it
 * exists (`exactOptionalPropertyTypes`), and `renderJobContent` owns their
 * order at the `{{userContent}}` seam: skill instructions, findings,
 * current tags, report contract, then the `<user-content>` block.
 */
function renderContent(
  node: Node,
  body: string,
  prepared: ISubmitContext,
  inputs: Exclude<TJobRenderInputs, 'no-findings'>,
): string {
  return renderJobContent({
    node,
    nodeBody: body,
    promptTemplate: prepared.promptTemplate,
    preamble: prepared.preamble,
    ...(prepared.skillSection !== undefined ? { skillSection: prepared.skillSection } : {}),
    ...(inputs.findingsSection !== undefined ? { findingsSection: inputs.findingsSection } : {}),
    ...(inputs.currentTagsSection !== undefined
      ? { currentTagsSection: inputs.currentTagsSection }
      : {}),
    reportContract: prepared.reportContract,
  });
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
  // A nodeless Action has no target by contract; taking one here would
  // resurrect exactly the coupling `probNodeless` exists to remove.
  if (prepared.nodeless) return { kind: 'nodeless-mismatch', nodeId: node.path };
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
  const content = renderContent(node, read.body, prepared, inputs);
  // A FIXER submit (`analyzerIds` set) supersedes stale queued siblings in one
  // transaction; a non-fixer submit inserts with the plain duplicate backstop.
  return prepared.analyzerIds !== undefined
    ? insertFixerJobRow(adapter, node, prepared, contentHash, content)
    : insertJobRow(adapter, node, prepared, contentHash, content);
}

/**
 * Submit the ONE job a nodeless Action produces (`spec/job-lifecycle.md`
 * §Submit · Nodeless submit). Same machinery as `submitOneJob` minus the two
 * steps that presuppose a file: target resolution (the caller has no node to
 * give, by design) and the on-disk read + drift verification (nothing on disk
 * to read, nothing to drift). Fixer / tagger injection cannot apply either:
 * both are per-node concerns.
 *
 * The synthetic target's constant hashes make `contentHash` a function of the
 * extension, its version and its prompt template alone, so the duplicate check
 * keeps exactly one active job per nodeless extension. For a probe that is the
 * intended behaviour: a second request adopts the first (`kind: 'duplicate'`
 * carries its id) instead of queueing a pile nobody drains.
 */
export async function submitNodelessJob(
  adapter: StoragePort,
  prepared: ISubmitContext,
): Promise<TSubmitOutcome> {
  const node = nodelessTarget(prepared.extensionId);
  if (!prepared.nodeless) return { kind: 'nodeless-mismatch', nodeId: node.path };

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

  const content = renderJobContent({
    node,
    nodeBody: null,
    promptTemplate: prepared.promptTemplate,
    preamble: prepared.preamble,
    reportContract: prepared.reportContract,
  });
  return insertJobRow(adapter, node, prepared, contentHash, content);
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
  | { kind: 'invalid-priority'; message: string }
  /**
   * `findingIds` on a target that cannot honour it: a non-fixer, a
   * deterministic-analyzer fixer whose triggers are `scan_issues` rows
   * (no stable ids), or a skill action (no fixer injection at all,
   * `spec/skill-actions.md` §HTTP surface). Usage error (exit 2 / 400),
   * `spec/job-lifecycle.md` §Finding-subset targeting.
   */
  | { kind: 'finding-ids-unsupported' };

export type TPrepareOutcome =
  | { ok: true; extension: TQueueableExtension; prepared: ISubmitContext }
  | { ok: false; error: TPrepareError };

/**
 * Success / failure shape when the caller supplies a skill catalog
 * (`spec/skill-actions.md`): a `skill:` hit resolves against the catalog,
 * not the extension registries, so there is no manifest object to return
 * and `extension` widens to `null`. Callers that never pass a catalog
 * (the CLI verb, the MCP tool, the auto-fix hook, the boot ping) keep
 * the narrow `TPrepareOutcome` through the overloads below.
 */
export type TSkillAwarePrepareOutcome =
  | { ok: true; extension: TQueueableExtension | null; prepared: ISubmitContext }
  | { ok: false; error: TPrepareError };

export interface IPrepareSubmitOpts {
  runtime: IActionRuntime;
  jobs: IJobsConfig;
  extensionId: string;
  cwd: string;
  force: boolean;
  flagTtl: number | undefined;
  flagPriority: number | undefined;
  /**
   * Per-job auto-fix opt-in (`sm jobs submit <finder> --auto-fix`, the BFF
   * body `autoFix`). Default off; CLAMPED to `false` below for a non-finder
   * (Action) target so an Action job never freezes a meaningless flag
   * (`spec/job-lifecycle.md` §Auto-fix chain (per-job)).
   */
  autoFix?: boolean;
  /**
   * Finding-subset targeting for a FINDINGS-branch fixer target (`--finding`
   * / BFF body `findingIds`). Refused (`finding-ids-unsupported`) on any
   * other target. Deduped + sorted here so the frozen column and the
   * rendered section are deterministic regardless of input order.
   */
  findingIds?: readonly number[];
  /**
   * Boot-frozen skill-action catalog (`spec/skill-actions.md`). Supplied
   * by the BFF submit route ONLY: a `skill:<name>` target resolves
   * against it before the extension registries are ever consulted. Absent
   * on every other surface, which makes the `skill:` prefix RESERVED
   * there (the CLI's exit-5 refusal, `spec/cli-contract.md` §Jobs): the
   * prefix routes into the skill branch and the missing catalog misses.
   */
  skillCatalog?: ISkillActionCatalog;
}

/**
 * Resolve the submit target (probabilistic Action or finder Analyzer,
 * `spec/cli-contract.md` §Jobs; or a `skill:<name>` skill action when a
 * catalog is supplied, `spec/skill-actions.md`) and prepare the
 * constant-across-fan-out submit context: prompt template, report
 * contract, preamble, TTL / priority, hashes, and the fixer
 * `analyzerIds`. PURE (no printing, no DB): every failure returns a
 * structured `TPrepareError` so every caller, the CLI command's
 * `failPrepare`, the hook's `submitFixerJob`, and the BFF submit route,
 * decides how to surface it. This is the extraction that keeps
 * `sm jobs submit` byte-identical while letting the auto-fix hook render
 * a real, injected, superseding fixer job (not a bare row).
 */
export function prepareSubmitContext(
  opts: IPrepareSubmitOpts & { skillCatalog: ISkillActionCatalog },
): TSkillAwarePrepareOutcome;
export function prepareSubmitContext(opts: IPrepareSubmitOpts): TPrepareOutcome;
export function prepareSubmitContext(opts: IPrepareSubmitOpts): TSkillAwarePrepareOutcome {
  // The `skill:` prefix NEVER reaches extension target resolution (and an
  // unprefixed id never matches a skill), so no ambiguity can arise
  // between the two namespaces (`spec/skill-actions.md` §Identity).
  return isSkillActionId(opts.extensionId)
    ? prepareSkillContext(opts)
    : prepareExtensionContext(opts);
}

/**
 * The extension branch of `prepareSubmitContext` (the historical body,
 * verbatim): resolve across the probabilistic Action / Analyzer
 * catalogs, then assemble the constant-across-fan-out context.
 */
function prepareExtensionContext(opts: IPrepareSubmitOpts): TPrepareOutcome {
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
  const scheduling = resolveSchedulingKnobs(extension, opts.jobs, opts.flagTtl, opts.flagPriority);
  if ('error' in scheduling) return { ok: false, error: scheduling.error };
  const { ttlSeconds, priority } = scheduling;
  const analyzerIds = fixerAnalyzerIds(extensionKind, extension);
  const analyzerMode =
    analyzerIds !== undefined
      ? referencedAnalyzerMode(opts.runtime.analyzers, analyzerIds)
      : undefined;
  const findingIds = normalizeFindingIds(opts.findingIds, analyzerIds, analyzerMode);
  if (findingIds === 'unsupported') {
    return { ok: false, error: { kind: 'finding-ids-unsupported' } };
  }
  const prepared: ISubmitContext = {
    extensionId: qualified,
    extensionVersion: extension.version,
    extensionKind,
    autoFix: resolveAutoFixFlag(extensionKind, opts.autoFix),
    promptTemplate: promptTemplate.text,
    preamble,
    reportContract: reportContract.text,
    // TAGGER detection reuses the report schema the contract resolution
    // already parsed, the SAME `isTagsReportSchema` signal the record path
    // reads (there is no manifest flag). Actions only: a finder Analyzer
    // never proposes tags.
    isTagger: extensionKind === 'action' && isTagsReportSchema(reportContract.schema),
    analyzerIds,
    // Modelo B: resolve the referenced analyzer's mode ONCE, so the per-node
    // render branches (Issues vs findings) without re-resolving per fan-out.
    analyzerMode,
    findingIds,
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
    nodeless: isNodelessTarget(extensionKind, extension),
  };
  return { ok: true, extension, prepared };
}

/**
 * The `skill:` branch of `prepareSubmitContext` (`spec/skill-actions.md`).
 * Resolves the target against the boot-frozen catalog instead of the
 * extension registries: a miss (unknown name, or a surface without a
 * catalog at all) is the same `not-found` outcome an unknown extension
 * gets. A hit builds the context from the canonical substitutes: the
 * wrapper template and the report schema are spec constants (skills
 * carry no `prompt.md` / `report.schema.json`), the discovery-cached
 * body rides as the skill-instructions section, and the section folds
 * into `promptTemplateHash` at prepare time so a `SKILL.md` edit
 * re-keys `contentHash` (§Hashing). The canonical schema `$ref`s only
 * `report-base.schema.json` (no summaries / findings / tags namespace),
 * so `isTagger` is false by construction and a completed record writes
 * the execution row only. `autoFix` clamps false (kind `action` never
 * chains); `findingIds` refuses with the same invalid-request outcome a
 * non-fixer extension target gets (no fixer injection to narrow), per
 * §HTTP surface.
 */
function prepareSkillContext(opts: IPrepareSubmitOpts): TSkillAwarePrepareOutcome {
  const entry = opts.skillCatalog?.byId.get(opts.extensionId);
  if (entry === undefined) return { ok: false, error: { kind: 'not-found' } };
  if (opts.findingIds !== undefined) {
    return { ok: false, error: { kind: 'finding-ids-unsupported' } };
  }
  const scheduling = resolveSchedulingKnobs(
    skillSchedulingRef(entry.id),
    opts.jobs,
    opts.flagTtl,
    opts.flagPriority,
  );
  if ('error' in scheduling) return { ok: false, error: scheduling.error };
  const preamble = loadCanonicalPreamble();
  const promptTemplate = loadCanonicalSkillTemplate();
  const skillSection = buildSkillSection(entry);
  const reportContract = buildReportContract({
    schemaText: loadSkillActionReportSchemaText(),
    schema: loadSkillActionReportSchema(),
  });
  const prepared: ISubmitContext = {
    // The `skill:` id verbatim: it freezes onto `state_jobs.extension_id`
    // and routes record-time report resolution (`resolveExtensionRecord`).
    extensionId: entry.id,
    extensionVersion: entry.version,
    // Frozen `action`: a skill action behaves exactly like a probabilistic
    // Action end to end; the prefix carries the real provenance
    // (`spec/skill-actions.md` §Identity and version).
    extensionKind: 'action',
    autoFix: resolveAutoFixFlag('action', opts.autoFix),
    promptTemplate,
    preamble,
    skillSection,
    reportContract,
    isTagger: false,
    analyzerIds: undefined,
    analyzerMode: undefined,
    findingIds: undefined,
    promptTemplateHash: computePromptTemplateHash({
      preamble,
      template: promptTemplate,
      skillSection,
      reportContract,
    }),
    ttlSeconds: scheduling.ttlSeconds,
    priority: scheduling.priority,
    cwd: opts.cwd,
    force: opts.force,
    providers: opts.runtime.providers,
    nodeless: false,
  };
  return { ok: true, extension: null, prepared };
}

/**
 * The minimal `{ id, pluginId }` ref the TTL / priority resolvers take
 * for a skill target. `pluginId` is empty by construction (a skill has
 * no plugin): the qualified-id leg of the config lookup composes
 * `/skill:<name>`, which matches nothing, and the bare-id leg resolves
 * `jobs.perExtensionTtl` / `jobs.perExtensionPriority` keys written as
 * the full `skill:<name>` id, so operator config keyed by the submit
 * target resolves through the existing lookup.
 */
function skillSchedulingRef(id: string): TResolvableAction {
  return { id, pluginId: '' };
}

/**
 * True when the resolved target is a NODELESS Action (`probNodeless`,
 * `spec/job-lifecycle.md` §Submit · Nodeless submit). Analyzers are always
 * per-node (a finder judges a node), so only Actions can declare it.
 */
function isNodelessTarget(
  extensionKind: JobExtensionKind,
  extension: TQueueableExtension,
): boolean {
  return extensionKind === 'action' && (extension as IAction).probNodeless === true;
}

/**
 * Resolve the TTL + priority knobs, mapping their typed failures to the
 * structured prepare errors (extracted so `prepareSubmitContext` stays
 * inside the complexity cap). Takes the minimal `TResolvableAction` ref
 * (satisfied by both queueable kinds AND the synthetic skill ref) so the
 * skill branch resolves through the exact same config lookup.
 */
function resolveSchedulingKnobs(
  extension: TResolvableAction,
  jobs: IJobsConfig,
  flagTtl: number | undefined,
  flagPriority: number | undefined,
): { ttlSeconds: number | null; priority: number } | { error: TPrepareError } {
  try {
    return {
      ttlSeconds: resolveTtl(extension, jobs, flagTtl),
      priority: resolvePriority(extension, jobs, flagPriority),
    };
  } catch (err) {
    if (err instanceof InvalidTtlError) return { error: { kind: 'invalid-ttl', message: err.message } };
    if (err instanceof InvalidPriorityError) {
      return { error: { kind: 'invalid-priority', message: err.message } };
    }
    throw err;
  }
}

/**
 * Normalize + validate the finding-subset request
 * (`spec/job-lifecycle.md` §Finding-subset targeting): dedup + sort so
 * the frozen column and the rendered section are deterministic
 * regardless of input order. Only meaningful where the injected triggers
 * ARE `state_findings` rows (a findings-branch fixer): a non-fixer has
 * no injection, and a deterministic-analyzer fixer's triggers are
 * `scan_issues` rows with no stable ids, so those return `'unsupported'`.
 */
function normalizeFindingIds(
  requested: readonly number[] | undefined,
  analyzerIds: readonly string[] | undefined,
  analyzerMode: TAnalyzerMode | undefined,
): readonly number[] | undefined | 'unsupported' {
  if (requested === undefined) return undefined;
  if (analyzerIds === undefined || analyzerMode === 'deterministic') return 'unsupported';
  return [...new Set(requested)].sort((a, b) => a - b);
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
 * `resolveReportContractText`'s success shape: the rendered contract text
 * PLUS the parsed report schema it was built from, so the caller derives the
 * TAGGER signal (`isTagsReportSchema`) from bytes already in hand instead of
 * re-reading / re-parsing `report.schema.json`.
 */
type TResolvedReportContract =
  | { ok: true; text: string; schema: Record<string, unknown> }
  | { ok: false; detail: string };

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
 * blocks resolved inside `buildReportContract`. Returns the parsed schema
 * alongside the text: `prepareSubmitContext` derives the TAGGER signal from
 * it (§Current-tags injection for taggers) without a second read.
 */
function resolveReportContractText(
  extension: TQueueableExtension,
  dir: string | undefined,
): TResolvedReportContract {
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
  return { ok: true, text: buildReportContract({ schemaText, schema }), schema };
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
    case 'nodeless-mismatch':
      // A fixer is per-node by definition, so a nodeless target here can
      // only mean a caller wired the wrong extension in: report it as
      // not-submittable rather than inventing a fixer outcome for it.
      return { kind: 'not-submittable', detail: T.submitErrNodelessMismatch };
  }
}

/**
 * A short, log-only description of a prepare failure (never
 * user-facing). Lookup-shaped (one formatter per kind) so the catalog
 * grows without pushing the function over the complexity cap.
 */
const PREPARE_ERROR_DESCRIPTIONS: {
  [K in TPrepareError['kind']]: (error: Extract<TPrepareError, { kind: K }>) => string;
} = {
  'not-found': () => 'extension not found',
  deterministic: (e) => `not probabilistic (mode ${e.mode})`,
  ambiguous: () => 'ambiguous extension id',
  'prompt-unresolved': (e) => `prompt unresolved: ${e.detail}`,
  'report-schema-unresolved': (e) => `report schema unresolved: ${e.detail}`,
  'finding-ids-unsupported': () => 'findingIds on a target without stable finding ids',
  'invalid-ttl': (e) => e.message,
  'invalid-priority': (e) => e.message,
};

function describePrepareError(error: TPrepareError): string {
  return (PREPARE_ERROR_DESCRIPTIONS[error.kind] as (e: TPrepareError) => string)(error);
}
