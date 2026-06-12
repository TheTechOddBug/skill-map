/**
 * Extractor runtime contract. Consumes a single node (frontmatter + body)
 * and emits its output through context-supplied callbacks rather than a
 * return value. Extractors run in isolation: they MUST NOT read other
 * nodes, the graph, or the DB. Cross-node reasoning lives in Analyzers.
 *
 * Extractors are deterministic-only. They run synchronously inside the
 * scan loop; LLM-driven enrichment of a node is an Action concern, not
 * an Extractor concern. The Extractor context therefore exposes no
 * `RunnerPort`, see spec `architecture.md` §Execution modes.
 *
 * **Structure-as-truth**: the extension's `id` and `kind` come from the
 * filesystem (`<plugin>/extractors/<id>/index.ts`); the manifest does NOT
 * declare them. The `emitsLinkKinds` allowlist was retired with the same
 * refactor: the global closed enum of link kinds is the contract, and an
 * extractor emitting an off-enum kind keeps surfacing `extension.error`.
 * Confidence is per-emit (no manifest-level default).
 */

import type { IExtensionBase } from './base.js';
import type { Link, Node, Signal } from '../types.js';
import type { IViewContribution, SlotPayload } from '../types/view-catalog.js';

/**
 * Payload accepted by `IExtractorCallbacks.emitNode`. A loose subset of
 * `Node` because the kernel fills the rest from the emission context:
 *
 *   - `bodyHash`, `frontmatterHash` are computed from `derivedFrom` (the
 *     hash of the sources concatenated in declared order, so the
 *     virtual node's hashes drift when any source changes).
 *   - `bytes`, `linksOutCount`, `linksInCount`, `externalRefsCount`
 *     default to zero counts on emission; the orchestrator's
 *     post-extraction recompute pass fills them in once links resolve.
 *
 * The emitter MUST supply `path` (canonical id), `kind` (registered in
 * a Provider's catalog), `derivedFrom` (one or more existing-node paths
 * the virtual node is derived from), and SHOULD supply `frontmatter`
 * with the metadata the UI / analyzers will surface.
 */
export interface IEmittedNode {
  /** Synthetic identifier. Use a non-filesystem scheme (`mcp://`, etc). */
  path: string;
  /** Kind declared in some Provider's `kinds` catalog. */
  kind: string;
  /** Required for virtual nodes: paths of the source(s). */
  derivedFrom: string[];
  /** Always true on this surface; the kernel mirrors it to `Node.virtual`. */
  virtual: true;
  /** Provider id the node is attributed to (e.g. `'claude'`). */
  provider: string;
  /** Optional structured metadata the UI / analyzers read. */
  frontmatter?: Record<string, unknown>;
}

/**
 * Output callbacks supplied by the kernel on the extractor context.
 */
export interface IExtractorCallbacks {
  /**
   * Emit a single Link. Validated against the global closed enum of
   * link kinds (`invokes`, `references`, `mentions`, `supersedes`,
   * `points`) before insertion; off-enum kinds drop silently with an
   * `extension.error` event.
   */
  emitLink(link: Link): void;

  /**
   * Emit a multi-candidate `Signal` for the kernel's resolver phase to
   * collapse into a single Link (or reject). Use this instead of
   * `emitLink` when the detection carries genuine ambiguity (multiple
   * plausible kinds / targets), needs byte-range awareness for
   * collision detection, or needs numeric confidence with
   * sub-tier granularity. Unambiguous detectors should keep using
   * `emitLink` directly. See
   * [`signal.schema.json`](../../../spec/schemas/signal.schema.json) for the
   * normative contract. Validated against the same closed kind enum;
   * off-spec Signals (no candidates, off-enum kind, confidence outside
   * `[0..1]`) drop silently with an `extension.error` event.
   */
  emitSignal(signal: Signal): void;

  /**
   * Phase 5, emit a synthetic / virtual `Node` derived from the
   * scanning context (frontmatter, sidecar, config). Used by the
   * `core/mcp-tools` extractor to materialise an `mcp://<name>` node
   * out of a `tools: [mcp__<name>__*]` frontmatter entry, and by the
   * future Cursor / Codex MCP-config extractors that walk
   * `.cursor/mcp.json` / `~/.codex/config.toml`. The kernel
   * deduplicates by `node.path` against the walker's nodes AND across
   * extractor emissions: the FIRST emission of a given path wins,
   * subsequent emissions are silently ignored (idempotent semantics so
   * N skills referencing the same MCP collapse into one node). Emitted
   * nodes carry `virtual: true` and `derivedFrom: [...]` per
   * [`node.schema.json`](../../../spec/schemas/node.schema.json).
   */
  emitNode(node: IEmittedNode): void;

  /**
   * Merge canonical, kernel-curated properties onto the current node's
   * enrichment layer. The author-supplied frontmatter stays untouched
   * (Decision #109 in `ROADMAP.md`).
   */
  enrichNode(partial: Partial<Node>): void;

  /**
   * Emit a per-node view contribution. Pass the contribution object you
   * declared in the manifest's `ui` map BY REFERENCE, e.g.
   * `const facts = { slot: '...' } satisfies IViewContribution; ui: { facts };`
   * then `ctx.emitContribution(facts, payload)`. The kernel recovers the
   * contribution id + slot by object identity, then validates `payload`
   * against the slot's payload schema in
   * `spec/schemas/view-slots.schema.json#/$defs/payloads/<slot>`. `payload`
   * is typed from `ref.slot` (`SlotPayload<C['slot']>`), so the wrong shape
   * is a compile error; an undeclared `ref` (a spread copy / inline literal)
   * or an off-shape payload drops at runtime with a loud `extension.error`.
   */
  emitContribution<C extends IViewContribution>(ref: C, payload: SlotPayload<C['slot']>): void;
}

export interface IExtractorContext extends IExtractorCallbacks {
  node: Node;
  body: string;
  frontmatter: Record<string, unknown>;
  /**
   * Resolved values of the extension's declared `settings`, populated
   * from project config + user overrides. Empty object when no settings
   * are declared.
   */
  settings: Record<string, unknown>;
  /**
   * Plugin-scoped persistence. Optional because not every plugin declares
   * a `storage.mode` in `plugin.json`. See `spec/plugin-kv-api.md`.
   */
  store?: unknown;
}

/**
 * Optional declarative filter shared with Analyzer and Action. The kernel
 * applies a single matcher: every declared sub-filter must hold for the
 * extension to be invoked on the candidate node.
 */
export interface IExtensionPrecondition {
  /**
   * Qualified node kinds the extension accepts, written as
   * `<provider-plugin>/<kindName>` (e.g. `claude/agent`). Unknown
   * qualified kinds load OK but surface a `precondition-kind-unknown`
   * warning in `sm plugins doctor`.
   */
  kind?: string[];
  /** Provider ids whose nodes the extension accepts. */
  provider?: string[];
}

export interface IExtractor extends IExtensionBase {
  /** Discriminant injected by the loader from the folder structure. */
  kind: 'extractor';
  /** Which slice of the node the orchestrator feeds. Defaults to `both`. */
  scope?: 'frontmatter' | 'body' | 'both';
  /**
   * Optional precondition that gates `extract()` invocation. Replaces
   * the old `applicableKinds` field; same shape used by Analyzer and
   * Action so the kernel ships a single matcher.
   */
  precondition?: IExtensionPrecondition;

  /**
   * Extractor entry point. Returns nothing; output flows through
   * `ctx.emitLink`, `ctx.enrichNode`, `ctx.emitContribution`, `ctx.store`.
   */
  extract(ctx: IExtractorContext): void | Promise<void>;
}
