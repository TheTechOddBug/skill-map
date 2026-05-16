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
import type { Link, Node } from '../types.js';

/**
 * Output callbacks supplied by the kernel on the extractor context.
 */
export interface IExtractorCallbacks {
  /**
   * Emit a single Link. Validated against the global closed enum of
   * link kinds (`invokes`, `references`, `mentions`, `supersedes`)
   * before insertion; off-enum kinds drop silently with an
   * `extension.error` event.
   */
  emitLink(link: Link): void;

  /**
   * Merge canonical, kernel-curated properties onto the current node's
   * enrichment layer. The author-supplied frontmatter stays untouched
   * (Decision #109 in `ROADMAP.md`).
   */
  enrichNode(partial: Partial<Node>): void;

  /**
   * Emit a per-node view contribution. `contributionId` MUST be a key
   * declared under the manifest's `ui` map; the payload MUST conform to
   * the slot's payload schema in
   * `spec/schemas/view-slots.schema.json#/$defs/payloads/<slot>`. Off-shape
   * payloads (or unknown contribution ids) drop silently with an
   * `extension.error`. Renamed from `viewContributions` with the
   * structure-as-truth refactor.
   */
  emitContribution(contributionId: string, payload: unknown): void;
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
