/**
 * Rule runtime contract. Runs against the whole graph after every Provider
 * and extractor has completed; emits issues. Deterministic rules are pure
 * (same graph in → same issues out) and run synchronously inside `sm scan`
 * / `sm check`. Probabilistic rules invoke an LLM through the kernel's
 * `RunnerPort` and dispatch only as queued jobs — they never participate
 * in scan-time pipelines. Mode is declared in the manifest (default
 * `deterministic`).
 */

import type { IExtensionBase } from './base.js';
import type { Issue, Link, Node, TExecutionMode } from '../types.js';
import type { IRegisteredAnnotationKey } from '../types/annotation-catalog.js';
import type { IRegisteredViewContribution } from '../types/view-catalog.js';

/**
 * Step 9.6.2 — orphan sidecar entry surfaced to rules. A `.sm` file
 * whose sibling `.md` does not exist on disk; the `annotation-orphan`
 * built-in rule emits one warning per entry. Other rules that care
 * about orphan sidecars MAY consume the list too.
 */
export interface IRuleOrphanSidecar {
  /** Relative path (POSIX-separated) of the orphan `.sm`. */
  relativePath: string;
  /** Absolute path of the missing `.md` the sidecar was anchored to. */
  expectedMdPath: string;
}

export interface IRuleContext {
  nodes: Node[];
  links: Link[];
  /**
   * Step 9.6.2 — orphaned sidecars discovered during the scan walk.
   * Empty when sidecar discovery did not run (legacy callers) or
   * when no orphans exist.
   */
  orphanSidecars?: IRuleOrphanSidecar[];
  /**
   * Step 9.6.6 — raw parsed sidecar root keyed by `node.path`. Populated
   * by the orchestrator alongside the public `Node.sidecar` overlay so
   * rules that inspect plugin namespaces (e.g. the built-in
   * `core/unknown-field` Rule) can walk the full tree without re-reading
   * the file from disk. Absent (or `undefined` per node) when no
   * sidecar accompanies the node, or when the sidecar failed to parse.
   * Treat as read-only.
   */
  sidecarRoots?: ReadonlyMap<string, Record<string, unknown>>;
  /**
   * Step 9.6.6 — runtime catalog of plugin-contributed annotation keys,
   * as exposed by `kernel.getRegisteredAnnotationKeys()`. Threaded
   * through so rules can reason about the registered-vs-unknown split
   * without reaching back into the kernel. Empty array when no plugin
   * declares contributions; absent for legacy callers (older runScan
   * sites that never wired the catalog through).
   */
  annotationContributions?: readonly IRegisteredAnnotationKey[];
  /**
   * Step 11.x — runtime catalog of plugin-contributed view contributions,
   * as exposed by `kernel.getRegisteredViewContributions()`. Threaded
   * through so rules can reason about emissions without reaching back
   * into the kernel: built-in `core/unknown-slot` walks this list to
   * detect deprecated slots in use, and `core/contribution-orphan`
   * joins it with the live node set to flag dangling emissions. Empty
   * array when no extension declares view contributions; absent for
   * legacy callers (older runScan sites that never wired the catalog
   * through).
   */
  viewContributions?: readonly IRegisteredViewContribution[];
  /**
   * Absolute paths of `*.md` files under the project's
   * `.skill-map/jobs/` that no `state_jobs.filePath` references — the
   * built-in `core/job-orphan-file` rule projects each as a `warn`
   * issue. Pre-computed by the driving adapter (CLI / BFF) inside its
   * already-open storage transaction (mirrors the `orphanSidecars`
   * pattern: detection lives outside the rule, the rule only projects).
   * Absent (or empty) when the caller does not maintain a jobs
   * directory, when the storage path is unavailable, or when no
   * orphan files exist. Treat as read-only.
   */
  orphanJobFiles?: readonly string[];
  /**
   * Set of absolute file paths the operator has opted into for
   * link-validation purposes via `scan.referencePaths`. The driving
   * adapter walks each configured path before the scan and collects
   * every existing file's absolute path here. Files in this set are
   * NOT indexed as graph nodes — the only consumer is
   * `core/broken-ref`, which suppresses its `warn` issue when a
   * path-style link target falls into the set. Absent / empty when
   * the operator left `scan.referencePaths` empty or when the
   * adapter does not maintain the side index. Treat as read-only.
   */
  referenceablePaths?: ReadonlySet<string>;
  /**
   * Absolute path of the scan's project root (cwd of the invocation).
   * Threaded into the rule pass so a rule that needs to resolve a
   * relative `link.target` to an absolute filesystem path (today
   * only `core/broken-ref`, when consulting `referenceablePaths`)
   * does not have to derive it from `nodes[0].path` heuristics.
   * Absent for legacy callers (older `runScan` sites that never
   * wired the field through). Always an absolute path when present.
   */
  cwd?: string;
  /**
   * Emit a per-node view contribution declared in this rule's manifest
   * `viewContributions` map. Sync, void return; the orchestrator
   * validates the payload against the slot's schema at call time and
   * silently drops invalid emissions with a logged `extension.error`
   * event (parallel to `IExtractorCallbacks.emitContribution`).
   *
   * Unlike Extractor's emit (which binds `nodePath` from `ctx.node.path`
   * implicitly because Extractors run per-node), Rule's `evaluate()`
   * sees the full graph at once. The rule walks `ctx.nodes` itself and
   * MUST supply the target node path explicitly per emission.
   *
   * Calling `emitContribution` with a `contributionId` that is not
   * declared in the manifest is dropped with an `extension.error`. The
   * kernel routes emitted contributions to the same persistence
   * pipeline as Extractor emissions (`scan_contributions`).
   */
  emitContribution(nodePath: string, contributionId: string, payload: unknown): void;
}

export interface IRule extends IExtensionBase {
  kind: 'rule';
  /**
   * Execution mode. Optional in the manifest with a default of
   * `deterministic` per `spec/schemas/extensions/rule.schema.json`.
   */
  mode?: TExecutionMode;
  evaluate(ctx: IRuleContext): Issue[] | Promise<Issue[]>;
}
