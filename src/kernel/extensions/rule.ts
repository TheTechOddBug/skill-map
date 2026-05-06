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
