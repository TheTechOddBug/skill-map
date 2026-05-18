/**
 * Per-`(node, extractor)` cache decision logic. Walks the Spec § A.9
 * `scan_extractor_runs` breadcrumbs alongside the node-level
 * body/frontmatter/sidecar-annotations hashes and decides:
 *   - which extractors fully cache-hit (their prior contribution
 *     survives unchanged);
 *   - which extractors need to run for this scan;
 *   - how each prior outbound internal link should be reshaped given
 *     the cached / missing / obsolete state of its `sources`.
 *
 * Also indexes the prior `ScanResult` so the walker can look up prior
 * nodes / links / frontmatter issues by path in O(1).
 */

import type { Issue, Link, Node, ScanResult } from '../types.js';
import type { IExtractor } from '../extensions/index.js';
import type { IPriorExtractorRun } from '../adapters/sqlite/scan-load.js';
import { qualifiedExtensionId } from '../registry.js';
import type { IExtractorRunRecord } from './extractors.js';

export interface IPriorIndex {
  /** Prior nodes keyed by path so per-file lookup is O(1). */
  priorNodesByPath: Map<string, Node>;
  /** Set of every prior node path, used to disambiguate inverted
   *  `supersedes` links (see `originatingNodeOf`). */
  priorNodePaths: Set<string>;
  /**
   * Prior internal links bucketed by **originating node**, the node
   * whose body / frontmatter the extractor was processing when it emitted
   * the link. For most kinds that equals `link.source`, but the
   * frontmatter extractor emits inverted `supersedes` links where the
   * originating node is `link.target`.
   */
  priorLinksByOriginating: Map<string, Link[]>;
  /**
   * Per-node frontmatter-invalid / -malformed issues from the prior, we
   * reuse them when the cache is hit, otherwise the incremental scan
   * would silently drop the warning that landed on the prior pass.
   */
  priorFrontmatterIssuesByNode: Map<string, Issue[]>;
}

export function indexPriorSnapshot(prior: ScanResult | null): IPriorIndex {
  const priorNodesByPath = new Map<string, Node>();
  const priorNodePaths = new Set<string>();
  const priorLinksByOriginating = new Map<string, Link[]>();
  const priorFrontmatterIssuesByNode = new Map<string, Issue[]>();
  if (!prior) {
    return { priorNodesByPath, priorNodePaths, priorLinksByOriginating, priorFrontmatterIssuesByNode };
  }
  indexPriorNodes(prior.nodes, priorNodesByPath, priorNodePaths);
  indexPriorLinks(prior.links, priorNodePaths, priorLinksByOriginating);
  indexPriorFrontmatterIssues(prior.issues, priorFrontmatterIssuesByNode);
  return { priorNodesByPath, priorNodePaths, priorLinksByOriginating, priorFrontmatterIssuesByNode };
}

function indexPriorNodes(
  nodes: readonly Node[],
  byPath: Map<string, Node>,
  paths: Set<string>,
): void {
  for (const node of nodes) {
    byPath.set(node.path, node);
    paths.add(node.path);
  }
}

function indexPriorLinks(
  links: readonly Link[],
  priorNodePaths: Set<string>,
  byOriginating: Map<string, Link[]>,
): void {
  for (const link of links) {
    const key = originatingNodeOf(link, priorNodePaths);
    const list = byOriginating.get(key);
    if (list) list.push(link);
    else byOriginating.set(key, [link]);
  }
}

const FRONTMATTER_ISSUE_ANALYZERS: ReadonlySet<string> = new Set([
  'frontmatter-invalid',
  'frontmatter-malformed',
  // Audit L1: parser parse-error is emitted by
  // `buildFreshNodeAndValidateFrontmatter` from `raw.parseIssues`. The
  // raw.parseIssues only flows through the non-cache path; a cached
  // node skips the rebuild, so the prior issue MUST survive the
  // incremental scan or the warning silently disappears on a clean
  // re-scan of an unchanged file.
  'frontmatter-parse-error',
]);

function indexPriorFrontmatterIssues(
  issues: readonly Issue[],
  byNode: Map<string, Issue[]>,
): void {
  for (const issue of issues) {
    if (!FRONTMATTER_ISSUE_ANALYZERS.has(issue.analyzerId)) continue;
    if (issue.nodeIds.length !== 1) continue;
    const path = issue.nodeIds[0]!;
    const list = byNode.get(path);
    if (list) list.push(issue);
    else byNode.set(path, [issue]);
  }
}

/**
 * The "originating node" of a link, the node whose body / frontmatter
 * the extractor was processing when it emitted the link. For most kinds
 * this equals `link.source`, but the frontmatter extractor emits inverted
 * `supersedes` links (from a node's `metadata.supersededBy`) where
 * `target` is the originating node and `source` is the (forward-pointing)
 * supersedor. The forward case (`metadata.supersedes`) keeps
 * `originating === source` like every other extractor.
 *
 * Discriminator: the supersedor path in an inverted edge is rarely a
 * real node (it points "forward" to a file that may or may not exist on
 * disk under that exact path); the originating node always exists in
 * the prior snapshot (it's the node whose extraction produced the link).
 * So for `kind === 'supersedes'`: prefer `source` when source is a known
 * prior node, otherwise fall back to `target`. This handles BOTH the
 * forward case (originating === source, which IS a known node) and the
 * inverted case (source not a node → fall through to target, the
 * originating older node).
 *
 * Frontmatter is the only extractor that emits cross-source links today;
 * if a future extractor adds another inversion case, escalate to a
 * persisted `Link.extractedFromPath` field with a schema bump rather
 * than extending this heuristic.
 */
export function originatingNodeOf(link: Link, priorNodePaths: Set<string>): string {
  if (link.kind === 'supersedes' && !priorNodePaths.has(link.source)) {
    return link.target;
  }
  return link.source;
}

/**
 * Compute the per-(node, extractor) cache decision for a single node.
 * Returns:
 *   - `applicableExtractors`, extractors whose `applicableKinds`
 *     accepts this node's kind (or unrestricted).
 *   - `applicableQualifiedIds`, set of qualified ids of the above.
 *   - `cachedQualifiedIds`, applicable extractors whose prior run for
 *     this node's body hash is still valid.
 *   - `missingExtractors`, applicable extractors that need to run.
 *   - `fullCacheHit`, true iff the node-level hash matched AND every
 *     applicable extractor is cached (nothing to re-extract).
 *
 * Legacy fallback: when `priorExtractorRuns === undefined` the caller
 * did not load fine-grained breadcrumbs (out-of-band tests, alternate
 * driving adapters); we treat every applicable extractor as cached
 * when the node-level hashes match, preserves the pre-A.9 contract.
 */
export function computeCacheDecision(opts: {
  extractors: IExtractor[];
  kind: string;
  provider: string;
  nodePath: string;
  bodyHash: string;
  /**
   * sha256 of the canonical-form sidecar annotations for THIS node on
   * THIS scan. Consulted unconditionally, every Extractor's cached run
   * must have matched both this AND `bodyHash` to be reused. Always
   * populated by the caller; an absent sidecar canonicalises to `{}`.
   */
  sidecarAnnotationsHash: string;
  nodeHashCacheEligible: boolean;
  priorExtractorRuns: Map<string, Map<string, IPriorExtractorRun>> | undefined;
}): {
  applicableExtractors: IExtractor[];
  applicableQualifiedIds: Set<string>;
  cachedQualifiedIds: Set<string>;
  missingExtractors: IExtractor[];
  fullCacheHit: boolean;
} {
  // Structure-as-truth: `applicableKinds` (simple list) was replaced by
  // `precondition.kind` (qualified `<pluginPlugin>/<kindName>`). The
  // orchestrator does not have the provider plugin here, so we match
  // against the kind segment after the slash.
  //
  // Phase 4b of the active-lens migration adds `precondition.provider`
  // gating: an extractor that declares `precondition.provider: ['claude']`
  // only runs on nodes whose provider is `'claude'`. Together with the
  // kind filter, the orchestrator skips extractors that semantically do
  // not apply (e.g. `claude/at-directive` is silent on nodes provided by
  // `gemini` because Gemini's at-directive flavour differs).
  const applicableExtractors = opts.extractors.filter((ex) => {
    if (!matchesKindPrecondition(ex, opts.kind)) return false;
    if (!matchesProviderPrecondition(ex, opts.provider)) return false;
    return true;
  });
  const applicableQualifiedIds = new Set(
    applicableExtractors.map((ex) => qualifiedExtensionId(ex.pluginId, ex.id)),
  );

  // Two code paths, picked by whether the caller threaded fine-grained
  // breadcrumbs through. Legacy callers (no priorExtractorRuns) lose
  // sidecar-edit invalidation; modern callers get per-(node, extractor)
  // cache-hit precision. Split out so each branch is trivially small
  // and easy to reason about in isolation.
  const split = opts.priorExtractorRuns === undefined
    ? splitLegacy(applicableExtractors, applicableQualifiedIds, opts.nodeHashCacheEligible)
    : splitFineGrained(applicableExtractors, opts);

  return {
    applicableExtractors,
    applicableQualifiedIds,
    cachedQualifiedIds: split.cachedQualifiedIds,
    missingExtractors: split.missingExtractors,
    fullCacheHit: opts.nodeHashCacheEligible && split.missingExtractors.length === 0,
  };
}

/**
 * Match the extractor's `precondition.kind` allowlist against this
 * node's kind. The orchestrator does not have the provider plugin in
 * scope here, so we match against the kind segment after the slash
 * (the qualifier form is `<pluginId>/<kindName>`). Unrestricted (no
 * `precondition.kind` declared) accepts every kind.
 */
function matchesKindPrecondition(ex: IExtractor, kind: string): boolean {
  const kinds = ex.precondition?.kind;
  if (!kinds || kinds.length === 0) return true;
  return kinds.some((qualified) => {
    const slashIdx = qualified.indexOf('/');
    const kindOnly = slashIdx === -1 ? qualified : qualified.slice(slashIdx + 1);
    return kindOnly === kind;
  });
}

/**
 * Phase 4b, match the extractor's `precondition.provider` allowlist
 * against the provider that classified this node. Universal extractors
 * (no `precondition.provider` declared) accept every provider.
 * Provider-specific extractors (e.g. `claude/at-directive` declares
 * `['claude']`) skip nodes from other providers.
 */
function matchesProviderPrecondition(ex: IExtractor, provider: string): boolean {
  const providers = ex.precondition?.provider;
  if (!providers || providers.length === 0) return true;
  return providers.includes(provider);
}

/**
 * Pre-A.9 cache decision: caller did not load fine-grained
 * breadcrumbs, so we treat every applicable extractor as cached when
 * the node-level hashes match. Sidecar-edit invalidation is
 * unavailable on this path, callers that need it must opt into the
 * fine-grained Map.
 */
function splitLegacy(
  applicableExtractors: IExtractor[],
  applicableQualifiedIds: Set<string>,
  nodeHashCacheEligible: boolean,
): { cachedQualifiedIds: Set<string>; missingExtractors: IExtractor[] } {
  const cachedQualifiedIds = new Set<string>();
  const missingExtractors: IExtractor[] = [];
  if (nodeHashCacheEligible) {
    for (const id of applicableQualifiedIds) cachedQualifiedIds.add(id);
  } else {
    for (const ex of applicableExtractors) missingExtractors.push(ex);
  }
  return { cachedQualifiedIds, missingExtractors };
}

/**
 * Spec § A.9 cache decision: walk the fine-grained
 * `scan_extractor_runs` breadcrumbs and decide per-extractor whether
 * its prior run still applies to THIS body + THIS sidecar.
 *
 * Sidecar-hash gate applies unconditionally. The author-facing
 * alternative (an opt-in `readsSidecar` flag) was rejected because
 * forgetting it produces a silent stale-data bug, sidecar edits
 * don't refresh until something in the `.md` changes. Universal
 * invalidation costs an extractor re-run per node on `.sm` edits
 * (negligible: sidecars change rarely and extractors are pure-CPU);
 * the gain is zero cognitive load for plugin authors and zero
 * correctness traps.
 */
function splitFineGrained(
  applicableExtractors: IExtractor[],
  opts: {
    nodePath: string;
    bodyHash: string;
    sidecarAnnotationsHash: string;
    nodeHashCacheEligible: boolean;
    priorExtractorRuns: Map<string, Map<string, IPriorExtractorRun>> | undefined;
  },
): { cachedQualifiedIds: Set<string>; missingExtractors: IExtractor[] } {
  const cachedQualifiedIds = new Set<string>();
  const missingExtractors: IExtractor[] = [];
  const priorRunsForNode =
    opts.priorExtractorRuns!.get(opts.nodePath) ?? new Map<string, IPriorExtractorRun>();
  for (const ex of applicableExtractors) {
    const qualified = qualifiedExtensionId(ex.pluginId, ex.id);
    const prior = priorRunsForNode.get(qualified);
    if (
      opts.nodeHashCacheEligible &&
      prior !== undefined &&
      prior.bodyHash === opts.bodyHash &&
      prior.sidecarAnnotationsHash === opts.sidecarAnnotationsHash
    ) {
      cachedQualifiedIds.add(qualified);
    } else {
      missingExtractors.push(ex);
    }
  }
  return { cachedQualifiedIds, missingExtractors };
}

/**
 * Shallow-clone a prior node, reshape its outbound internal links per
 * A.9 source rules, and re-emit its prior frontmatter issues. Shared
 * by the full-cache-hit and partial-cache-hit branches of
 * `walkAndExtract`.
 *
 * Reshape rules (A.9 sources):
 *   - missing source (extractor will re-emit) → drop link
 *   - all-obsolete sources → drop link
 *   - cached + obsolete → trim obsolete from `sources`
 *   - cached only → keep verbatim
 */
export function cloneNodeAndReshapeLinks(opts: {
  priorNode: Node;
  strict: boolean;
  cachedQualifiedIds: Set<string>;
  applicableQualifiedIds: Set<string>;
  shortIdToQualified: Map<string, string[]>;
  priorLinksByOriginating: Map<string, Link[]>;
  priorFrontmatterIssuesByNode: Map<string, Issue[]>;
}): { node: Node; internalLinks: Link[]; frontmatterIssues: Issue[] } {
  // Shallow-clone to avoid mutating the caller's prior snapshot when
  // `recomputeLinkCounts` resets per-node counts later.
  const node: Node = { ...opts.priorNode, bytes: { ...opts.priorNode.bytes } };
  if (opts.priorNode.tokens) node.tokens = { ...opts.priorNode.tokens };

  const internalLinks: Link[] = [];
  const reusedLinks = opts.priorLinksByOriginating.get(opts.priorNode.path) ?? [];
  for (const link of reusedLinks) {
    const reshaped = reuseCachedLink(
      link,
      opts.shortIdToQualified,
      opts.cachedQualifiedIds,
      opts.applicableQualifiedIds,
    );
    if (reshaped) internalLinks.push(reshaped);
  }

  // Re-emit prior frontmatter issues unchanged (frontmatter hash is
  // unchanged in both cache branches). `strict` can promote
  // `warn → error` retroactively.
  const frontmatterIssues: Issue[] = [];
  const reusedFm = opts.priorFrontmatterIssuesByNode.get(opts.priorNode.path) ?? [];
  for (const issue of reusedFm) {
    frontmatterIssues.push({ ...issue, severity: opts.strict ? 'error' : 'warn' });
  }

  return { node, internalLinks, frontmatterIssues };
}

/**
 * Build the reused-node bundle for a node that fully cache-hit (body
 * + frontmatter unchanged AND every applicable extractor still has a
 * matching `scan_extractor_runs` row). Caller pushes the returned
 * arrays into its scan-wide buffers and emits the progress event.
 *
 * Adds `extractorRuns` rows for every still-cached extractor so the
 * cache survives the next replace-all persist.
 */
export function reusePriorNode(opts: {
  priorNode: Node;
  bodyHash: string;
  sidecarAnnotationsHash: string;
  strict: boolean;
  cachedQualifiedIds: Set<string>;
  applicableQualifiedIds: Set<string>;
  shortIdToQualified: Map<string, string[]>;
  priorLinksByOriginating: Map<string, Link[]>;
  priorFrontmatterIssuesByNode: Map<string, Issue[]>;
}): {
  node: Node;
  internalLinks: Link[];
  frontmatterIssues: Issue[];
  extractorRuns: IExtractorRunRecord[];
} {
  const base = cloneNodeAndReshapeLinks(opts);

  // Persist one `scan_extractor_runs` row per still-cached pair so the
  // cache survives the next replace-all persist (without this, cached
  // pairs silently disappear). Carry the live sidecar-annotations hash
  // on every record, non-sidecar-readers ignore it on the next cache
  // decision, sidecar-readers consult it.
  const ranAt = Date.now();
  const extractorRuns: IExtractorRunRecord[] = [];
  for (const qualified of opts.cachedQualifiedIds) {
    extractorRuns.push({
      nodePath: opts.priorNode.path,
      extractorId: qualified,
      bodyHashAtRun: opts.bodyHash,
      ranAt,
      sidecarAnnotationsHashAtRun: opts.sidecarAnnotationsHash,
    });
  }

  return { ...base, extractorRuns };
}

/**
 * Spec § A.9, decide whether a prior link can be reused on a cached
 * node, and how its `sources` array should be reshaped.
 *
 * Three buckets per source short id:
 *   - **Cached**: short id maps to a currently-registered qualified id
 *     that has a matching `scan_extractor_runs` row for this body hash.
 *     The contribution is fresh and survives.
 *   - **Missing**: short id maps to a currently-registered qualified id
 *     that does NOT have a matching row for this body hash (newly
 *     registered, or its prior run targeted a different body). The
 *     missing extractor is about to run and will re-emit its own link
 *     row, so we drop the prior link entirely to avoid duplicates.
 *   - **Obsolete**: short id maps to no currently-registered qualified
 *     id at all (the extractor was uninstalled). The contribution is
 *     stranded but harmless, we strip the obsolete short id from
 *     `sources` and keep the link if at least one cached source remains.
 *
 * Decision rules:
 *   - Any missing source → return `null` (drop the link).
 *   - All cached, no obsolete → return the link as-is.
 *   - Cached + obsolete (no missing) → return a clone with obsolete
 *     sources filtered out.
 *   - All obsolete (no cached, no missing) → return `null` (no live
 *     extractor still claims this link).
 *
 * Source-id mapping caveat: `link.sources` carries the short id the
 * extractor author wrote (e.g. `'slash'`); the cache table keys on the
 * qualified id (`'core/slash'`). Multiple plugins COULD declare an
 * extractor with the same short id; the map keeps every qualified id per
 * short id so this filter recognises any of them as "still cached".
 */
export function reuseCachedLink(
  link: Link,
  shortIdToQualified: Map<string, string[]>,
  cachedQualifiedIds: Set<string>,
  applicableQualifiedIds: Set<string>,
): Link | null {
  if (!Array.isArray(link.sources) || link.sources.length === 0) return null;
  const partition = partitionLinkSources(
    link.sources,
    shortIdToQualified,
    cachedQualifiedIds,
    applicableQualifiedIds,
  );
  if (partition.hasMissing) return null;
  if (partition.cached.length === 0) return null;
  if (partition.obsolete.length === 0) return link;
  // Trim the obsolete short ids from `sources` so the persisted row no
  // longer claims attribution from an extractor the user removed.
  return { ...link, sources: partition.cached };
}

/**
 * Bucket every entry in `link.sources` into cached / missing /
 * obsolete per the contract documented on `reuseCachedLink`. `missing`
 * collapses into a single boolean (one missing source kills the link;
 * there's no point listing every missing one).
 */
function partitionLinkSources(
  sources: readonly string[],
  shortIdToQualified: Map<string, string[]>,
  cachedQualifiedIds: Set<string>,
  applicableQualifiedIds: Set<string>,
): { cached: string[]; obsolete: string[]; hasMissing: boolean } {
  const cached: string[] = [];
  const obsolete: string[] = [];
  let hasMissing = false;
  for (const source of sources) {
    const category = classifyLinkSource(
      source,
      shortIdToQualified,
      cachedQualifiedIds,
      applicableQualifiedIds,
    );
    if (category === 'cached') cached.push(source);
    else if (category === 'missing') hasMissing = true;
    else obsolete.push(source);
  }
  return { cached, obsolete, hasMissing };
}

/**
 * Decide how one entry in `link.sources` should be treated when its
 * owning node is a cache reuse candidate. Three buckets per the
 * `reuseCachedLink` contract:
 *
 *   - `cached`  , short id maps to a currently-registered qualified id
 *                  that has a matching `scan_extractor_runs` row for
 *                  this body hash. Contribution is fresh; survives.
 *   - `missing` , registered for this kind but not cached for this
 *                  body. The missing extractor will re-emit, so the
 *                  prior link gets dropped to avoid duplicates.
 *   - `obsolete`, no live extractor claims the short id, or the live
 *                  one is not applicable to this kind. Strip from
 *                  `sources`; keep the link if a cached source remains.
 */
function classifyLinkSource(
  source: string,
  shortIdToQualified: Map<string, string[]>,
  cachedQualifiedIds: Set<string>,
  applicableQualifiedIds: Set<string>,
): 'cached' | 'missing' | 'obsolete' {
  const candidates = shortIdToQualified.get(source);
  if (!candidates || candidates.length === 0) return 'obsolete';
  if (candidates.some((q) => cachedQualifiedIds.has(q))) return 'cached';
  if (candidates.some((q) => applicableQualifiedIds.has(q))) return 'missing';
  return 'obsolete';
}
