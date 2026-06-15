/**
 * Analyzer runtime contract. Runs against the whole graph after every
 * Provider and extractor has completed; emits issues and MAY project
 * findings into the UI via view contributions. Deterministic analyzers
 * are pure (same graph in → same issues out) and run synchronously
 * inside `sm scan` / `sm check`. Probabilistic analyzers invoke an LLM
 * through the kernel's `RunnerPort` and dispatch only as queued jobs,
 * they never participate in scan-time pipelines. Mode is declared in
 * the manifest (default `deterministic`).
 */

import type { IExtensionBase } from './base.js';
import type { IExtensionPrecondition } from './extractor.js';
import type { Issue, Link, Node, Signal, TConfidenceOp, TExecutionMode } from '../types.js';
import type { IRegisteredAnnotationKey } from '../types/annotation-catalog.js';
import type { IRegisteredViewContribution, IViewContribution, SlotPayload } from '../types/view-catalog.js';

/**
 * Step 9.6.2, orphan sidecar entry surfaced to analyzers. A `.sm` file
 * whose sibling `.md` does not exist on disk; the `annotation-orphan`
 * built-in analyzer emits one warning per entry. Other analyzers that
 * care about orphan sidecars MAY consume the list too.
 */
export interface IAnalyzerOrphanSidecar {
  /** Relative path (POSIX-separated) of the orphan `.sm`. */
  relativePath: string;
  /** Absolute path of the missing `.md` the sidecar was anchored to. */
  expectedMdPath: string;
}

export interface IAnalyzerContext {
  nodes: Node[];
  links: Link[];
  /**
   * Resolved values of the analyzer's declared `settings`, populated
   * from project config + user overrides. Empty object when no settings
   * are declared.
   */
  settings: Record<string, unknown>;
  /**
   * Step 9.6.2, orphaned sidecars discovered during the scan walk.
   * Empty when sidecar discovery did not run (legacy callers) or
   * when no orphans exist.
   */
  orphanSidecars?: IAnalyzerOrphanSidecar[];
  /**
   * Step 9.6.6, raw parsed sidecar root keyed by `node.path`. Populated
   * by the orchestrator alongside the public `Node.sidecar` overlay so
   * analyzers that inspect plugin namespaces (e.g. the built-in
   * `core/annotation-field-unknown` Analyzer) can walk the full tree without
   * re-reading the file from disk. Absent (or `undefined` per node)
   * when no sidecar accompanies the node, or when the sidecar failed
   * to parse. Treat as read-only.
   */
  sidecarRoots?: ReadonlyMap<string, Record<string, unknown>>;
  /**
   * Step 9.6.6, runtime catalog of plugin-contributed annotation keys,
   * as exposed by `kernel.getRegisteredAnnotationKeys()`. Threaded
   * through so analyzers can reason about the registered-vs-unknown
   * split without reaching back into the kernel. Empty array when no
   * plugin declares contributions; absent for legacy callers (older
   * runScan sites that never wired the catalog through).
   */
  annotationContributions?: readonly IRegisteredAnnotationKey[];
  /**
   * Step 11.x, runtime catalog of plugin-contributed view contributions,
   * as exposed by `kernel.getRegisteredViewContributions()`. Threaded
   * through so analyzers can reason about emissions without reaching
   * back into the kernel (built-in `core/contribution-orphan` joins it
   * with the live node set to flag dangling emissions). Slot catalog
   * drift detection is NOT a scan concern, it lives at load time and
   * surfaces via `sm plugins doctor`. Empty array when no extension
   * declares view contributions; absent for legacy callers (older
   * runScan sites that never wired the catalog through).
   */
  viewContributions?: readonly IRegisteredViewContribution[];
  /**
   * Absolute paths of `*.md` files under the project's
   * `.skill-map/jobs/` that no `state_jobs.filePath` references, the
   * built-in `core/job-file-orphan` analyzer projects each as a `warn`
   * issue. Pre-computed by the driving adapter (CLI / BFF) inside its
   * already-open storage transaction (mirrors the `orphanSidecars`
   * pattern: detection lives outside the analyzer, the analyzer only
   * projects). Absent (or empty) when the caller does not maintain a
   * jobs directory, when the storage path is unavailable, or when no
   * orphan files exist. Treat as read-only.
   */
  orphanJobFiles?: readonly string[];
  /**
   * Issues emitted by analyzers that already ran in the current pass.
   * Lets a late-phase analyzer (`core/issue-counter`) compute
   * cross-analyzer aggregates (per-node severity totals) without
   * scanning the persisted DB. The orchestrator threads the live
   * accumulator on every call so any analyzer can opt-in; only the
   * aggregator reads it today, the rest treat it as inert.
   *
   * Treat as read-only, the accumulator is shared with downstream
   * analyzers and a mutation here would corrupt their view of the
   * scan. Absent (or empty) on legacy callers that never wired it.
   */
  accumulatedIssues?: readonly Issue[];
  /**
   * Set of absolute file paths the operator has opted into for
   * link-validation purposes via `scan.referencePaths`. The driving
   * adapter walks each configured path before the scan and collects
   * every existing file's absolute path here. Files in this set are
   * NOT indexed as graph nodes, the only consumer is
   * `core/reference-broken`, which suppresses its `warn` issue when a
   * path-style link target falls into the set. Absent / empty when
   * the operator left `scan.referencePaths` empty or when the
   * adapter does not maintain the side index. Treat as read-only.
   */
  referenceablePaths?: ReadonlySet<string>;
  /**
   * Paths of nodes whose normalised identifier(s) intersect a
   * `reservedNames[kind]` catalog under self scope (the node's own
   * Provider, e.g. `.claude/commands/help.md` shadowed by Claude's
   * built-in `/help`) or lens scope (the active lens lending its catalog
   * to the universal `agent-skills` skill nodes it consumes, e.g.
   * `.agents/skills/goal/SKILL.md` shadowed by Antigravity's `/goal`).
   * The set is computed once per scan by the orchestrator (mirroring the
   * same set threaded to the post-walk confidence-lift transform), so
   * analyzers consume it without re-deriving every node's
   * identifiers. The single consumer today is `core/name-reserved`,
   * which projects one warn issue per entry; future analyzers MAY
   * read the set for cross-rule cohesion (e.g. an action that
   * suggests rename targets). Absent for legacy callers (older
   * `runScan` sites that never wired the field through).
   */
  reservedNodePaths?: ReadonlySet<string>;
  /**
   * Links the post-walk lift judged genuinely broken: target matches no
   * node `path` AND the stripped trigger matches no entry in the cross-
   * kind name index (`spec/architecture.md` §Provider · resolution
   * rules). Computed once per scan by the orchestrator from the same
   * `deriveNodeIdentifiers`-backed index the confidence-lift transform
   * uses, so a link that resolves only via a filename / dirname
   * identifier is NOT in the set. Membership is by object identity (the
   * orchestrator threads the SAME link objects). The single consumer is
   * `core/reference-broken`, which projects one issue per member (after
   * its `referenceablePaths` escape hatch). Absent for legacy callers
   * that never wired the field through, the rule then emits nothing.
   */
  brokenLinks?: ReadonlySet<Link>;
  /**
   * Names claimed by two or more distinct nodes, keyed by the normalised
   * name. A node contributes only when its kind declares `frontmatter.name`
   * as a resolution identifier (so plain `core/markdown` nodes, addressed
   * by path, never collide) and it carries a non-empty `name`. Names that
   * normalise to the same value (e.g. `Deploy` / `deploy`) collide, mirroring
   * how the resolver keys on the normalised identifier. Computed once per
   * scan by the orchestrator from the same kind registry the resolver uses,
   * so analyzers project it without re-deriving (the `brokenLinks` /
   * `reservedNodePaths` precompute-and-project pattern). The single consumer
   * is `core/name-collision`, which emits one `error` per entry. Absent for
   * legacy callers that never wired the field through.
   */
  nameCollisions?: ReadonlyMap<string, readonly { readonly path: string; readonly kind: string }[]>;
  /**
   * Absolute path of the scan's project root (cwd of the invocation).
   * Threaded into the analyzer pass so an analyzer that needs to
   * resolve a relative `link.target` to an absolute filesystem path
   * (today only `core/reference-broken`, when consulting
   * `referenceablePaths`) does not have to derive it from
   * `nodes[0].path` heuristics. Absent for legacy callers (older
   * `runScan` sites that never wired the field through). Always an
   * absolute path when present.
   */
  cwd?: string;
  /**
   * Signals emitted by extractors during the scan, before the resolver
   * collapsed them into `links`. Populated when at least one extractor
   * opted into the Signal IR path (`ctx.emitSignal` in
   * `IExtractorCallbacks`). Empty / absent when every extractor used
   * `emitLink` directly (legacy and unambiguous paths). Treat as
   * read-only. Analyzers consume this for collision detection
   * (overlapping `range` from different extractors), fragmentation
   * detection, and conflict-visualisation; the resolved `links` remain
   * the source of truth for graph-level analyses.
   */
  signals?: readonly Signal[];
  /**
   * Emit a per-node view contribution declared in this analyzer's
   * manifest `viewContributions` map. Sync, void return; the
   * orchestrator validates the payload against the slot's schema at
   * call time and silently drops invalid emissions with a logged
   * `extension.error` event (parallel to
   * `IExtractorCallbacks.emitContribution`).
   *
   * Unlike Extractor's emit (which binds `nodePath` from `ctx.node.path`
   * implicitly because Extractors run per-node), Analyzer's `evaluate()`
   * sees the full graph at once. The analyzer walks `ctx.nodes` itself
   * and MUST supply the target node path explicitly per emission.
   *
   * Pass the contribution object declared in the manifest `ui` map BY
   * REFERENCE (same model as the Extractor emit). `payload` is typed from
   * `ref.slot`. An undeclared `ref` (a spread copy / inline literal) or an
   * off-shape payload drops with a loud `extension.error`. The kernel routes
   * accepted contributions to the same persistence pipeline as Extractor
   * emissions (`scan_contributions`).
   */
  emitContribution<C extends IViewContribution>(
    nodePath: string,
    ref: C,
    payload: SlotPayload<C['slot']>,
  ): void;
  /**
   * Contribute a confidence adjustment to a link. Usable ONLY from a
   * `score`-phase analyzer; the orchestrator records it attributed to
   * the calling extension (`pluginId` / `extensionId`, like
   * `emitContribution`) and folds every op on a link into the final
   * `link.confidence` before the `detect` phase. `link` must be one of
   * `ctx.links` (matched by object identity). Present ONLY in the
   * `score` phase (absent for `detect` / `aggregate` and legacy
   * callers), mirroring the other orchestrator-injected ctx fields.
   */
  adjustConfidence?(link: Link, op: TConfidenceOp): void;
}

export interface IAnalyzer extends IExtensionBase {
  /** Discriminant injected by the loader from the folder structure. */
  kind: 'analyzer';
  /**
   * Execution mode. Optional in the manifest with a default of
   * `deterministic`. `probabilistic` analyzers run only as queued jobs.
   */
  mode?: TExecutionMode;
  /**
   * Optional declarative precondition. Same shape used by Extractor and
   * Action. The analyzer is invoked only when the graph contains at
   * least one node matching every declared sub-filter.
   *
   * The reverse relationship (which Actions resolve this analyzer's
   * findings) is now declared on the Action side via
   * `precondition.analyzerIds` (Modelo B). The old
   * `recommendedActions` field was retired with the structure-as-truth
   * refactor; the UI matches against Action manifests when surfacing
   * "Resolve this issue" affordances.
   */
  precondition?: IExtensionPrecondition;
  /**
   * Execution phase. Drives the order the orchestrator schedules
   * analyzers in:
   *
   *   - `'score'`, runs strictly BEFORE every `detect`-phase analyzer.
   *     The ONLY phase permitted to write: it adjusts link confidence
   *     via `ctx.adjustConfidence(link, op)`. The orchestrator folds
   *     every score-phase op into `link.confidence` before the read-
   *     only `detect` phase runs, so the `detect` analyzers see the
   *     final value. The kernel seeds the 1.0 confidence baseline on
   *     every link, then dogfoods this phase via two built-in score-phase
   *     detectors (`core/name-reserved`, `core/reference-broken`), each
   *     co-locating its penalty `delta` with the finding it reports.
   *   - `'detect'` (default), the main pass. Walks nodes / links and
   *     emits its own findings. Most analyzers live here. Read-only.
   *   - `'aggregate'`, runs strictly AFTER every `detect`-phase
   *     analyzer has finished. The orchestrator passes the full
   *     issue accumulator on `ctx.accumulatedIssues`, so an
   *     aggregator can compute cross-analyzer summaries (per-node
   *     severity totals, etc.) without re-reading the persisted DB.
   *     Aggregators emit contributions; emitting issues is allowed
   *     but uncommon. Read-only.
   *
   * Phase scheduling is the clean alternative to ordering analyzers by
   * hand in the built-ins registry: filesystem-sorted generators can
   * keep their alphabetical output, the orchestrator applies the phase
   * sort (`score` < `detect` < `aggregate`) at run-time.
   */
  phase?: 'score' | 'detect' | 'aggregate';
  evaluate(ctx: IAnalyzerContext): Issue[] | Promise<Issue[]>;
}
