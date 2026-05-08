/**
 * Extractor runtime contract. Consumes a single node (frontmatter + body)
 * and emits its output through three context-supplied callbacks rather than
 * a return value. Extractors run in isolation: they MUST NOT read other
 * nodes, the graph, or the DB. Cross-node reasoning lives in rules.
 *
 * Extractors are deterministic-only. They run synchronously inside the
 * scan loop; LLM-driven enrichment of a node is an Action concern, not
 * an Extractor concern. The Extractor context therefore exposes no
 * `RunnerPort` — see spec `architecture.md` §Execution modes.
 *
 * Output channels (all on the context):
 *
 *   - `ctx.emitLink(link)` — persist a link in the kernel's `links` table.
 *     Validated against `emitsLinkKinds` before insertion; an off-contract
 *     kind drops the link and surfaces an `extension.error` event.
 *   - `ctx.enrichNode(partial)` — merge canonical, kernel-curated properties
 *     onto the node. Strictly separate from the author-supplied frontmatter
 *     (the latter remains immutable and survives verbatim). Persistence
 *     is spec'd in § A.8.
 *   - `ctx.store` — plugin-scoped persistence. Present only when the
 *     plugin declares `storage.mode` in `plugin.json`; shape depends on the
 *     mode (`KvStore` for mode A, scoped `Database` for mode B). See
 *     `plugin-kv-api.md` for the contract.
 *
 * The manifest's `scope` field tells the orchestrator which parts to feed:
 * `frontmatter` extractors receive an empty string for body and vice versa.
 *
 * Renamed from `Detector` in spec 0.8.x. The previous `detect(ctx) → Link[]`
 * signature is gone; everything now flows through `extract(ctx) → void`
 * and the callbacks above.
 */

import type { IExtensionBase } from './base.js';
import type { Confidence, Link, LinkKind, Node } from '../types.js';

/**
 * Output callbacks supplied by the kernel on the extractor context.
 * Split out so plugin authors can name the callback shape if they
 * want to mock it in unit tests without depending on the wider
 * `IExtractorContext`.
 */
export interface IExtractorCallbacks {
  /**
   * Emit a single Link. The orchestrator validates the link against the
   * extractor's declared `emitsLinkKinds` before inserting it; off-contract
   * links are silently dropped with an `extension.error` event.
   */
  emitLink(link: Link): void;

  /**
   * Merge canonical, kernel-curated properties onto the current node's
   * enrichment layer. The author-supplied frontmatter stays untouched
   * (Decision #109 in `ROADMAP.md`). Persistence and stale-tracking
   * semantics live in spec § A.8; the orchestrator already buffers the
   * partials and `persistScanResult` upserts them.
   */
  enrichNode(partial: Partial<Node>): void;

  /**
   * Emit a per-node view contribution. The first argument is the
   * extension-local Record key declared under
   * `extension.viewContributions[<contributionId>]`; the second is a
   * payload that conforms to the contract's payload schema in
   * `spec/schemas/view-contracts.schema.json#/$defs/payloads/<contract>`.
   * The orchestrator validates the payload against the contract schema
   * before persisting to `scan_contributions`; off-contract payloads
   * are silently dropped with an `extension.error` event (mirror of
   * `emitLink` rejecting off-`emitsLinkKinds` links). Calling
   * `emitContribution` with a `contributionId` that is not declared in
   * the manifest is also dropped with an `extension.error`. See
   * `architecture.md` §View contribution system → Emit path.
   */
  emitContribution(contributionId: string, payload: unknown): void;
}

export interface IExtractorContext extends IExtractorCallbacks {
  node: Node;
  body: string;
  frontmatter: Record<string, unknown>;
  /**
   * Plugin-scoped persistence. Optional because not every plugin declares
   * a `storage.mode` in `plugin.json`. Shape: `KvStoreWrapper` for mode A
   * (`set(key, value)`), `DedicatedStoreWrapper` for mode B
   * (`write(table, row)`). See `spec/plugin-kv-api.md`.
   *
   * Typed as `unknown` so this contract module stays free of any
   * adapter-side imports — the concrete `IPluginStore` lives in
   * `kernel/adapters/plugin-store.js`. Plugin authors narrow at the
   * call site based on the storage mode declared in their manifest.
   * The orchestrator looks up the wrapper per-extractor in
   * `RunScanOptions.pluginStores` (keyed by `pluginId`) and attaches
   * it here.
   */
  store?: unknown;
}

export interface IExtractor extends IExtensionBase {
  kind: 'extractor';
  emitsLinkKinds: LinkKind[];
  defaultConfidence: Confidence;
  scope: 'frontmatter' | 'body' | 'both';
  /**
   * Optional opt-in filter on `node.kind`. When declared, the orchestrator
   * skips invocation of `extract()` for any node whose `kind` is NOT in
   * this list — fail-fast, before context construction, so the extractor
   * wastes zero CPU on inapplicable nodes.
   *
   * Absent (`undefined`) is the default: the extractor applies to every
   * kind. There are no wildcards — the absence of the field already
   * encodes "every kind". An empty array (`[]`) is rejected at load
   * time by AJV (`minItems: 1` in the schema).
   *
   * Unknown kinds (no installed Provider declares them) do NOT block
   * the load: the extractor keeps `loaded` status and `sm plugins doctor`
   * surfaces a warning. The Provider that declares the kind may arrive
   * later (e.g. a user installs the corresponding plugin).
   *
   * Spec: `spec/schemas/extensions/extractor.schema.json#/properties/applicableKinds`.
   */
  applicableKinds?: string[];

  /**
   * Extractor entry point. Returns nothing; output flows through
   * `ctx.emitLink`, `ctx.enrichNode`, and `ctx.store`.
   */
  extract(ctx: IExtractorContext): void | Promise<void>;
}
