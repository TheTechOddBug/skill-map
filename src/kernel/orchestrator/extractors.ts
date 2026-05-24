/**
 * Per-node extractor invocation: build a fresh `IExtractorContext` for
 * each extractor, validate every emitted link / contribution against
 * the declared catalog, fold enrichment partials into per-`(node,
 * extractor)` records, and surface emit-time drops as
 * `extension.error` events.
 *
 * Also hosts the post-walk recompute helpers that re-derive
 * `linksOutCount` / `linksInCount` / `externalRefsCount` on every node
 * from the final merged link buffer, plus the `IExtractorRunRecord`
 * and `IEnrichmentRecord` types those records eventually persist as.
 */

import { makeEvent } from '../extensions/hook-dispatcher.js';
import type {
  IEmittedNode,
  IExtractor,
  IExtractorContext,
} from '../extensions/index.js';
import type { TPluginStore } from '../adapters/plugin-store.js';
import { loadSchemaValidators } from '../adapters/schema-validators.js';
import type { IContributionRecord } from '../adapters/sqlite/contributions.js';
import { ORCHESTRATOR_TEXTS } from '../i18n/orchestrator.texts.js';
import type {
  ProgressEmitterPort,
} from '../ports/progress-emitter.js';
import { qualifiedExtensionId } from '../registry.js';
import type {
  Confidence,
  Link,
  LinkKind,
  Node,
  Signal,
} from '../types.js';
import { ConfidenceTier } from '../types.js';
import { tx } from '../util/tx.js';

/**
 * Spec § A.9, runs to persist into `scan_extractor_runs`. One entry
 * per `(nodePath, qualifiedExtractorId)` pair the orchestrator decided
 * "this extractor is current for this body". Includes both freshly-run
 * pairs (extractor invoked this scan) and reused pairs (cached node, the
 * extractor's prior run still applies to the same body hash). Excludes
 * obsolete pairs, extractors that ran in the prior but are no longer
 * registered, so a replace-all persist drops them automatically.
 */
export interface IExtractorRunRecord {
  nodePath: string;
  extractorId: string;
  bodyHashAtRun: string;
  ranAt: number;
  /**
   * sha256 of the canonical-form sidecar annotations the Extractor saw
   * at run time. Always populated (an absent sidecar canonicalises to
   * `{}` so the hash is stable). Used unconditionally by the cache
   * decision alongside `bodyHashAtRun`: a sidecar-only edit invalidates
   * the cached run for every applicable Extractor on that node.
   */
  sidecarAnnotationsHashAtRun: string;
}

/**
 * Spec § A.8, universal enrichment layer.
 *
 * One entry per `(nodePath, qualifiedExtractorId)` pair an Extractor
 * produced via `ctx.enrichNode(...)` during the walk. Attribution is
 * preserved per-Extractor (rather than merged client-side as B.1 did)
 * so the persistence layer can:
 *
 *   - upsert a single row per pair (stable PRIMARY KEY conflict on
 *     re-extract);
 *   - feed `mergeNodeWithEnrichments` with `enrichedAt`-sorted partials
 *     for last-write-wins per field at read time.
 *
 * `value` is the cumulative merge across every `enrichNode` call that
 * Extractor made for this node within this scan, multiple
 * `ctx.enrichNode({...})` calls inside one `extract(ctx)` invocation
 * fold into a single row, but two different Extractors hitting the
 * same node yield two distinct rows.
 *
 * `isProbabilistic` is reserved: Extractors are deterministic-only, so
 * every record produced by the orchestrator sets it to `false`. The
 * field is kept on the record (and the row in `node_enrichments`) so a
 * future Action-issued enrichment can populate it without reshaping
 * the persistence contract, see spec `architecture.md`
 * §Extractor · enrichment layer.
 */
export interface IEnrichmentRecord {
  nodePath: string;
  extractorId: string;
  bodyHashAtEnrichment: string;
  value: Partial<Node>;
  enrichedAt: number;
  isProbabilistic: boolean;
}

/**
 * Run a set of extractors against a single node, collecting their link
 * emissions and node-enrichment partials. Each extractor is invoked
 * exactly once with a fresh `IExtractorContext`. Caller decides what
 * to do with the returned arrays (push into per-scan buffers, write to
 * a focused refresh result, etc.).
 *
 * Exported so `cli/commands/refresh.ts` can reuse the same wiring it
 * needs for re-running a single extractor against a single node, the
 * pre-extraction code in `refresh.ts` was hand-duplicating this loop
 * (audit item V4).
 *
 * Within this call, multiple `enrichNode(partial)` calls from the same
 * extractor against the same node fold into one record (last-write-wins
 * per field), same contract as the in-scan path.
 */
export async function runExtractorsForNode(opts: {
  extractors: IExtractor[];
  node: Node;
  body: string;
  frontmatter: Record<string, unknown>;
  bodyHash: string;
  emitter: ProgressEmitterPort;
  /**
   * Spec § A.12, per-plugin `ctx.store` wrappers keyed by `pluginId`.
   * The map's lookup is per-extractor inside the loop, so callers that
   * don't track plugin storage can omit it; the resulting `ctx.store`
   * stays `undefined` (the existing contract).
   */
  pluginStores?: ReadonlyMap<string, TPluginStore>;
}): Promise<{
  internalLinks: Link[];
  externalLinks: Link[];
  enrichments: IEnrichmentRecord[];
  contributions: IContributionRecord[];
  signals: Signal[];
  virtualNodes: Node[];
}> {
  const internalLinks: Link[] = [];
  const externalLinks: Link[] = [];
  const enrichmentBuffer = new Map<string, IEnrichmentRecord>();
  const contributions: IContributionRecord[] = [];
  // Signal IR scaffold (Phase 2 of the active-lens migration). Extractors
  // that opt into `ctx.emitSignal()` push into this buffer; the resolver
  // phase (not yet wired) will consume it and emit Links. Until then the
  // buffer simply travels through so analyzers can read it from
  // `IAnalyzerContext.signals` for collision detection prototypes.
  const signals: Signal[] = [];
  // Phase 5, virtual / synthetic nodes emitted by extractors (e.g. the
  // `core/mcp-tools` extractor materialises `mcp://<name>` nodes from
  // `tools: [mcp__name__*]` frontmatter entries). The walker merges
  // these into its node accumulator with first-wins dedup by `path`.
  const virtualNodes: Node[] = [];
  const virtualNodePaths = new Set<string>();
  // Schema validators are cached at module level (`loadSchemaValidators`),
  // so the cost of this lookup is module-scoped, pulling once per
  // node-extract pass keeps the closure capture clean without paying
  // per emission.
  const validators = loadSchemaValidators();

  for (const extractor of opts.extractors) {
    const qualifiedId = qualifiedExtensionId(extractor.pluginId, extractor.id);
    const emitLink = (link: Link): void => {
      const validated = validateLink(extractor, link, opts.emitter);
      if (!validated) return;
      if (isExternalUrlLink(validated)) externalLinks.push(validated);
      else internalLinks.push(validated);
    };
    const enrichNode = (partial: Partial<Node>): void => {
      const key = `${opts.node.path}\x00${qualifiedId}`;
      const existing = enrichmentBuffer.get(key);
      if (existing) {
        existing.value = { ...existing.value, ...partial };
        existing.enrichedAt = Date.now();
      } else {
        enrichmentBuffer.set(key, {
          nodePath: opts.node.path,
          extractorId: qualifiedId,
          bodyHashAtEnrichment: opts.bodyHash,
          value: { ...partial },
          enrichedAt: Date.now(),
          // Extractors are deterministic-only; `is_probabilistic` is
          // reserved on the row for future Action-issued enrichments.
          isProbabilistic: false,
        });
      }
    };
    // Phase 3, view contributions emit-time wiring. Three drop reasons,
    // all silent + `extension.error` event (mirror of `emitLink`):
    //   1. Extractor never declared `viewContributions[<id>]`,
    //      reason: `unknown-contribution-id`.
    //   2. Declared `slot` is not in the closed catalog (also
    //      caught at AJV manifest load, but defence-in-depth; the
    //      load-time catalog drift check lives in `sm plugins doctor`),
    //      reason: `unknown-slot`.
    //   3. Payload fails the slot's payload schema,
    //      reason: AJV error string.
    // Accepted emissions append a record to the buffer; persistence
    // happens later via `replaceAllScanContributions`.
    const declaredContributions = readDeclaredContributions(extractor);
    const emitContribution = (contributionId: string, payload: unknown): void => {
      const declared = declaredContributions.get(contributionId);
      if (!declared) {
        emitExtensionError(opts.emitter, qualifiedId, opts.node.path, {
          phase: 'emitContribution',
          contributionId,
          reason: 'unknown-contribution-id',
          message: tx(ORCHESTRATOR_TEXTS.extensionErrorContributionUnknownId, {
            extractorId: qualifiedId,
            contributionId,
            nodePath: opts.node.path,
          }),
        });
        return;
      }
      const result = validators.validateContributionPayload(declared.slot, payload);
      if (!result.ok) {
        emitExtensionError(opts.emitter, qualifiedId, opts.node.path, {
          phase: 'emitContribution',
          contributionId,
          slot: declared.slot,
          reason: result.errors,
          message: tx(ORCHESTRATOR_TEXTS.extensionErrorContributionPayloadInvalid, {
            extractorId: qualifiedId,
            contributionId,
            nodePath: opts.node.path,
            slot: declared.slot,
            errors: result.errors,
          }),
        });
        return;
      }
      contributions.push({
        pluginId: extractor.pluginId,
        extensionId: extractor.id,
        nodePath: opts.node.path,
        contributionId,
        slot: declared.slot,
        payload,
        emittedAt: Date.now(),
      });
    };
    const emitSignal = (signal: Signal): void => {
      const validated = validateSignal(extractor, signal, opts.emitter);
      if (!validated) return;
      signals.push(validated);
    };
    const emitNode = (emitted: IEmittedNode): void => {
      // First-wins dedup so N extractors / N source nodes emitting the
      // same virtual identifier (e.g. multiple skills referencing
      // `mcp://github`) collapse into one node.
      if (virtualNodePaths.has(emitted.path)) return;
      const node = buildVirtualNode(extractor, emitted, opts.emitter);
      if (!node) return;
      virtualNodePaths.add(node.path);
      virtualNodes.push(node);
    };
    const store = opts.pluginStores?.get(extractor.pluginId);
    const ctx = buildExtractorContext(
      extractor,
      opts.node,
      opts.body,
      opts.frontmatter,
      emitLink,
      enrichNode,
      emitContribution,
      emitSignal,
      emitNode,
      store,
    );
    await extractor.extract(ctx);
  }

  return {
    internalLinks,
    externalLinks,
    enrichments: Array.from(enrichmentBuffer.values()),
    contributions,
    signals,
    virtualNodes,
  };
}

/**
 * Pull the manifest's `ui` map (renamed from `viewContributions` with
 * the structure-as-truth refactor) into a `Map<contributionId, { slot }>`.
 * Called once per extractor per node; the result lives for the duration
 * of `runExtractorsForNode` and disappears with the function frame.
 */
export function readDeclaredContributions(
  extension: { ui?: unknown },
): Map<string, { slot: string }> {
  const out = new Map<string, { slot: string }>();
  const raw = extension.ui;
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const slot = (value as { slot?: unknown }).slot;
    if (typeof slot !== 'string') continue;
    out.set(id, { slot });
  }
  return out;
}

/**
 * Emit an `extension.error` event from the orchestrator's emit-time
 * drop paths (off-contract link, off-slot / unknown contribution
 * payload). Uses the same `makeEvent` shape as the rest of the file
 * so listeners (BFF SSE, CLI logger) see a uniform timestamp +
 * type + data envelope.
 */
export function emitExtensionError(
  emitter: ProgressEmitterPort,
  qualifiedId: string,
  nodePath: string,
  data: Record<string, unknown>,
): void {
  emitter.emit(
    makeEvent('extension.error', {
      kind: 'contribution-rejected',
      extensionId: qualifiedId,
      nodePath,
      ...data,
    }),
  );
}

function buildExtractorContext(
  extractor: IExtractor,
  node: Node,
  body: string,
  frontmatter: Record<string, unknown>,
  emitLink: (link: Link) => void,
  enrichNode: (partial: Partial<Node>) => void,
  emitContribution: (contributionId: string, payload: unknown) => void,
  emitSignal: (signal: Signal) => void,
  emitNode: (node: IEmittedNode) => void,
  store: TPluginStore | undefined,
): IExtractorContext {
  const scope = extractor.scope ?? 'both';
  // `settings` is always populated (possibly empty) so consumers can read
  // `ctx.settings.<id>` without a presence check.
  const settings = extractor.resolvedSettings ?? {};
  return {
    node,
    body: scope === 'frontmatter' ? '' : body,
    frontmatter: scope === 'body' ? {} : frontmatter,
    settings,
    emitLink,
    enrichNode,
    emitContribution,
    emitSignal,
    emitNode,
    ...(store !== undefined ? { store } : {}),
  };
}

/**
 * Materialise an `IEmittedNode` payload into the canonical `Node` shape
 * the orchestrator persists. Off-spec emissions (missing path / kind /
 * derivedFrom, empty path, etc.) drop silently with an
 * `extension.error` event, mirroring the link / signal validators.
 * Hashes are deterministic placeholders: virtual nodes do not
 * participate in the rename heuristic (no filesystem identity), so
 * `bodyHash` / `frontmatterHash` only need to be SHA256-shaped strings
 * the schema accepts. A zeroed digest is the simplest stable value.
 */
const VIRTUAL_NODE_PLACEHOLDER_HASH = '0'.repeat(64);

function buildVirtualNode(
  extractor: IExtractor,
  emitted: IEmittedNode,
  emitter: ProgressEmitterPort,
): Node | null {
  const qualifiedId = qualifiedExtensionId(extractor.pluginId, extractor.id);
  if (typeof emitted.path !== 'string' || emitted.path.length === 0) {
    emitter.emit(
      makeEvent('extension.error', {
        kind: 'virtual-node-missing-path',
        extensionId: qualifiedId,
        message: `Extractor ${qualifiedId} emitted a virtual node with no path; dropped.`,
      }),
    );
    return null;
  }
  if (typeof emitted.kind !== 'string' || emitted.kind.length === 0) {
    emitter.emit(
      makeEvent('extension.error', {
        kind: 'virtual-node-missing-kind',
        extensionId: qualifiedId,
        virtualPath: emitted.path,
        message: `Extractor ${qualifiedId} emitted a virtual node at '${emitted.path}' with no kind; dropped.`,
      }),
    );
    return null;
  }
  if (!Array.isArray(emitted.derivedFrom) || emitted.derivedFrom.length === 0) {
    emitter.emit(
      makeEvent('extension.error', {
        kind: 'virtual-node-missing-derived-from',
        extensionId: qualifiedId,
        virtualPath: emitted.path,
        message: `Extractor ${qualifiedId} emitted a virtual node at '${emitted.path}' with empty derivedFrom; dropped.`,
      }),
    );
    return null;
  }
  const node: Node = {
    path: emitted.path,
    kind: emitted.kind,
    provider: emitted.provider,
    bodyHash: VIRTUAL_NODE_PLACEHOLDER_HASH,
    frontmatterHash: VIRTUAL_NODE_PLACEHOLDER_HASH,
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    virtual: true,
    derivedFrom: [...emitted.derivedFrom],
  };
  if (emitted.frontmatter) node.frontmatter = emitted.frontmatter;
  return node;
}

function validateLink(extractor: IExtractor, link: Link, emitter: ProgressEmitterPort): Link | null {
  // Structure-as-truth: the per-extractor `emitsLinkKinds` allowlist was
  // retired; the global closed enum of link kinds (`invokes`, `references`,
  // `mentions`, `supersedes`) is the contract. AJV / persistence at
  // higher layers reject off-enum kinds; this stage validates only that
  // the kind is a known enum member, surfacing an `extension.error` so
  // plugin authors see WHY a link they expected vanished.
  const knownKinds: readonly LinkKind[] = ['invokes', 'references', 'mentions', 'supersedes'];
  if (!knownKinds.includes(link.kind as LinkKind)) {
    const qualifiedId = `${extractor.pluginId}/${extractor.id}`;
    emitter.emit(
      makeEvent('extension.error', {
        kind: 'link-kind-not-declared',
        extensionId: qualifiedId,
        linkKind: link.kind,
        declaredKinds: knownKinds,
        link: { source: link.source, target: link.target, kind: link.kind },
        message: tx(ORCHESTRATOR_TEXTS.extensionErrorLinkKindNotDeclared, {
          extractorId: qualifiedId,
          linkKind: link.kind,
          declaredKinds: knownKinds.join(', '),
        }),
      }),
    );
    return null;
  }
  // `defaultConfidence` was retired with the structure-as-truth refactor;
  // confidence is declared per-emit on the Link payload. Missing
  // confidence defaults to `ConfidenceTier.MEDIUM` (0.6) so links emitted
  // without an explicit value still validate. After the Phase 4
  // migration, confidence is numeric `[0..1]`; emissions outside that
  // range are rejected with an `extension.error` (mirrors the LinkKind
  // enum check above).
  const c = link.confidence;
  if (c !== undefined && (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1)) {
    const qualifiedId = `${extractor.pluginId}/${extractor.id}`;
    emitter.emit(
      makeEvent('extension.error', {
        kind: 'link-confidence-out-of-range',
        extensionId: qualifiedId,
        confidence: c,
        message: `Extractor ${qualifiedId} emitted a Link with confidence ${String(c)} outside [0..1]; dropped.`,
      }),
    );
    return null;
  }
  const confidence: Confidence = c ?? ConfidenceTier.MEDIUM;
  return { ...link, confidence };
}

const KNOWN_LINK_KINDS: readonly LinkKind[] = ['invokes', 'references', 'mentions', 'supersedes'];

/**
 * Validate a Signal emitted via `ctx.emitSignal()`. Phase 2 scaffold:
 * the resolver does not consume Signals yet, so this guard exists to
 * prevent obvious garbage from accumulating in the buffer. Checks:
 *
 *   - At least one candidate.
 *   - Every candidate kind is in the closed `LinkKind` enum.
 *   - Every candidate confidence is a finite number in `[0..1]`.
 *
 * Off-spec Signals drop silently with an `extension.error` event,
 * mirroring `validateLink`. Stability: experimental.
 */
function validateSignal(
  extractor: IExtractor,
  signal: Signal,
  emitter: ProgressEmitterPort,
): Signal | null {
  const qualifiedId = qualifiedExtensionId(extractor.pluginId, extractor.id);
  if (!Array.isArray(signal.candidates) || signal.candidates.length === 0) {
    emitter.emit(
      makeEvent('extension.error', {
        kind: 'signal-no-candidates',
        extensionId: qualifiedId,
        signal: { source: signal.source, scope: signal.scope },
        message: `Extractor ${qualifiedId} emitted a Signal with no candidates; dropped.`,
      }),
    );
    return null;
  }
  for (const candidate of signal.candidates) {
    if (!isValidSignalCandidate(qualifiedId, candidate, emitter)) return null;
  }
  return signal;
}

function isValidSignalCandidate(
  qualifiedId: string,
  candidate: Signal['candidates'][number],
  emitter: ProgressEmitterPort,
): boolean {
  if (!KNOWN_LINK_KINDS.includes(candidate.kind as LinkKind)) {
    emitter.emit(
      makeEvent('extension.error', {
        kind: 'signal-candidate-kind-not-declared',
        extensionId: qualifiedId,
        candidateKind: candidate.kind,
        declaredKinds: KNOWN_LINK_KINDS,
        message: `Extractor ${qualifiedId} emitted a Signal candidate with off-enum kind '${String(candidate.kind)}'; dropped.`,
      }),
    );
    return false;
  }
  const c = candidate.confidence;
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) {
    emitter.emit(
      makeEvent('extension.error', {
        kind: 'signal-candidate-confidence-out-of-range',
        extensionId: qualifiedId,
        confidence: candidate.confidence,
        message: `Extractor ${qualifiedId} emitted a Signal candidate with confidence ${String(c)} outside [0..1]; dropped.`,
      }),
    );
    return false;
  }
  return true;
}

/**
 * Collapse duplicate links emitted by extractors that ran on different
 * nodes but produced the exact same edge. The classic case is
 * `core/annotations` when a relation is declared from BOTH sides
 * (`supersedes: [B]` on A.sm AND `supersededBy: A` on B.sm): each
 * extract pass is isolated per node, no shared dedup state, so the
 * same `(A → B, supersedes)` edge lands twice in the merged
 * link list. Without this pass, downstream consumers (the per-node
 * `linksInCount` / `linksOutCount` denormalisations, the
 * `core/link-counts` chip, the `core/broken-ref` aggregator) inflate
 * proportionally.
 *
 * Identity = `(source, target, kind, normalizedTrigger ?? '')`,
 * matching `kernel/scan/delta.ts#linkIdentity` so the diff path
 * stays consistent. First occurrence wins, deterministic given the
 * walk order.
 *
 * `sources[]` of merged duplicates union (preserves order of first
 * seen, no repeats) so an edge legitimately produced by multiple
 * extractors (e.g. body `markdown-link` + sidecar `annotations`)
 * keeps all attributions visible.
 */
// eslint-disable-next-line complexity
export function dedupeLinks(links: readonly Link[]): Link[] {
  const out = new Map<string, Link>();
  for (const link of links) {
    const trigger = link.trigger?.normalizedTrigger ?? '';
    const key = `${link.source}\x00${link.target}\x00${link.kind}\x00${trigger}`;
    const existing = out.get(key);
    if (existing) {
      const seen = new Set(existing.sources);
      for (const src of link.sources) {
        if (!seen.has(src)) {
          seen.add(src);
          existing.sources = [...existing.sources, src];
        }
      }
      // Confidence-max on merge: when two extractors agree on the same
      // edge, the stronger signal wins. The classic case post-Step 9.7
      // is `markdown-link` (0.95, explicit `[text](path)`) merging with
      // `at-directive` (0.85, `@./path`); without this bump the
      // first-seen extractor in walk order would dictate the visual
      // weight of the edge in the UI. `originalTrigger` keeps the
      // first-seen author syntax (the bump is about strength of
      // detection, not about preferring one author surface over the
      // other).
      if (link.confidence > existing.confidence) {
        existing.confidence = link.confidence;
      }
      // Accumulate occurrences across extractor merges so the merged
      // edge carries every syntactic site the body advertised. The
      // `core/redundant-target-reference` analyzer reads this array
      // to flag multi-form references; rename / refactor consumers
      // read it to find every author surface that points at the
      // resolved target. Per-occurrence dedup uses
      // `(extractor, originalTrigger, line)` so identical re-emissions
      // (defensive double-emit by a single extractor) collapse but
      // distinct sites survive.
      if (link.occurrences && link.occurrences.length > 0) {
        const existingOccurrences = existing.occurrences ?? [];
        const occKey = (o: { extractor: string; originalTrigger: string; location?: { line: number } | null }): string =>
          `${o.extractor}\x00${o.originalTrigger}\x00${o.location?.line ?? -1}`;
        const occSeen = new Set(existingOccurrences.map(occKey));
        const merged = [...existingOccurrences];
        for (const occ of link.occurrences) {
          const k = occKey(occ);
          if (!occSeen.has(k)) {
            occSeen.add(k);
            merged.push(occ);
          }
        }
        existing.occurrences = merged;
      }
      continue;
    }
    out.set(key, link);
  }
  return [...out.values()];
}

export function recomputeLinkCounts(nodes: Node[], links: Link[]): void {
  const byPath = new Map<string, Node>();
  for (const node of nodes) {
    // Reset counts so a node reused from prior (which carries its prior
    // counts) gets re-counted from the merged internal-link list.
    node.linksOutCount = 0;
    node.linksInCount = 0;
    byPath.set(node.path, node);
  }
  for (const link of links) {
    const source = byPath.get(link.source);
    if (source) source.linksOutCount += 1;
    // Trigger-style links (mentions = `@<name>`, invokes = `/<command>`)
    // keep the authored trigger in `link.target` and store the resolved
    // path in `link.resolvedTarget` after the post-walk lift. The
    // denormalised `linksInCount` MUST follow the resolved path so the
    // inspector ("Linked nodes → INCOMING") and the `sm list` IN column
    // (both read from `scan_nodes`) match the live graph the card chip
    // already shows by walking `scan_links` directly. Path-style
    // (`references`) links keep `target === resolvedTarget`, so the
    // fallback to `target` covers the legacy emit verbatim.
    const targetKey = link.resolvedTarget ?? link.target;
    const target = byPath.get(targetKey);
    if (target) target.linksInCount += 1;
  }
}

// eslint-disable-next-line complexity
export function recomputeExternalRefsCount(
  nodes: Node[],
  externalLinks: Link[],
  cachedPaths: Set<string>,
): void {
  const byPath = new Map<string, Node>();
  for (const node of nodes) {
    // Zero only freshly-built nodes. Cached nodes preserve their prior
    // `externalRefsCount` AND `externalRefs[]` because external pseudo-
    // links were never persisted historically; today both fields ride
    // through on a fresh scan and the cached row replays its prior
    // values untouched.
    if (!cachedPaths.has(node.path)) {
      node.externalRefsCount = 0;
      // Strip any prior populated array; we are about to refill below.
      delete node.externalRefs;
    }
    byPath.set(node.path, node);
  }
  for (const link of externalLinks) {
    const source = byPath.get(link.source);
    // Cached nodes never appear as the source of a freshly-emitted
    // external pseudo-link (extractors didn't run for them), so this
    // increment only ever lands on a freshly-built node, but the guard
    // is cheap and defensive.
    if (!source || cachedPaths.has(source.path)) continue;
    source.externalRefsCount += 1;
    // Accumulate the URL onto the source node so the inspector can
    // list every external reference without re-walking the body. The
    // pseudo-link's `target` is the normalised URL the extractor
    // emitted (lowercased host, fragment-stripped, deduped within the
    // body), so straight-through assignment matches the spec.
    const refs = source.externalRefs ?? [];
    refs.push({
      url: link.target,
      ...(link.location?.line !== undefined ? { line: link.location.line } : {}),
      ...(link.trigger?.originalTrigger ? { originalTrigger: link.trigger.originalTrigger } : {}),
    });
    source.externalRefs = refs;
  }
}

/**
 * Any link whose target carries a URL-shaped scheme is external (counted
 * via `externalRefsCount`, dropped from `result.links`). Internal links
 * are filesystem paths, relative or absolute, no scheme.
 *
 * The regex matches RFC 3986's `scheme = ALPHA *( ALPHA / DIGIT / "+" /
 * "-" / "." )` followed by `:`, with the extra constraint of ≥ 2 chars
 * so a Windows-style absolute path (`C:\foo`) is not misclassified as a
 * URL on the rare cross-platform path that survives normalization.
 *
 * Before this regex the implementation only matched `http://` and
 * `https://`, which silently let `mailto:`, `data:`, `file:///`, `ftp://`
 * etc. pollute the graph as fake-internal links (their lookup against
 * `byPath` always missed, so counts stayed at 0, but the rows survived
 * in `result.links` and the analyzer pipeline saw them).
 */
const EXTERNAL_URL_SCHEME_RE = /^[a-z][a-z0-9+\-.]+:/i;

/**
 * Synthetic-node schemes that look like URLs but resolve to an
 * in-graph virtual node (Phase 5+). Excluded from the external-URL
 * partition so the orchestrator keeps the link in `internalLinks`
 * where the resolver / analyzers can see it. Today only `mcp://`
 * lives here (Codex sub-agents synthesise nothing URL-shaped, and
 * future Cursor MCPs reuse the same scheme); add new schemes here
 * as virtual-node extractors land.
 */
const VIRTUAL_NODE_SCHEME_RE = /^mcp:\/\//i;

export function isExternalUrlLink(link: Link): boolean {
  if (VIRTUAL_NODE_SCHEME_RE.test(link.target)) return false;
  return EXTERNAL_URL_SCHEME_RE.test(link.target);
}
