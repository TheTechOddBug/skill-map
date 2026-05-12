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
  IExtractor,
  IExtractorContext,
} from '../extensions/index.js';
import type { IPluginStore } from '../adapters/plugin-store.js';
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
} from '../types.js';
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
  pluginStores?: ReadonlyMap<string, IPluginStore>;
}): Promise<{
  internalLinks: Link[];
  externalLinks: Link[];
  enrichments: IEnrichmentRecord[];
  contributions: IContributionRecord[];
}> {
  const internalLinks: Link[] = [];
  const externalLinks: Link[] = [];
  const enrichmentBuffer = new Map<string, IEnrichmentRecord>();
  const contributions: IContributionRecord[] = [];
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
    const store = opts.pluginStores?.get(extractor.pluginId);
    const ctx = buildExtractorContext(
      extractor,
      opts.node,
      opts.body,
      opts.frontmatter,
      emitLink,
      enrichNode,
      emitContribution,
      store,
    );
    await extractor.extract(ctx);
  }

  return {
    internalLinks,
    externalLinks,
    enrichments: Array.from(enrichmentBuffer.values()),
    contributions,
  };
}

/**
 * Pull the manifest's `viewContributions` map into a `Map<contributionId,
 * { slot }>`. Called once per extractor per node, the result lives
 * for the duration of `runExtractorsForNode` and disappears with the
 * function frame, so no caching is required (the manifest is already
 * the canonical source).
 */
export function readDeclaredContributions(
  extension: { viewContributions?: unknown },
): Map<string, { slot: string }> {
  const out = new Map<string, { slot: string }>();
  const raw = extension.viewContributions;
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
  store: IPluginStore | undefined,
): IExtractorContext {
  const scope = extractor.scope;
  // Spread `store` only when present so the resulting context stays
  // strictly-shaped under `exactOptionalPropertyTypes`, assigning
  // `store: undefined` would publish the property with an `undefined`
  // value, which is observably different from the field being absent
  // (the legacy contract for plugins without declared storage).
  return {
    node,
    body: scope === 'frontmatter' ? '' : body,
    frontmatter: scope === 'body' ? {} : frontmatter,
    emitLink,
    enrichNode,
    emitContribution,
    ...(store !== undefined ? { store } : {}),
  };
}

function validateLink(extractor: IExtractor, link: Link, emitter: ProgressEmitterPort): Link | null {
  if (!extractor.emitsLinkKinds.includes(link.kind as LinkKind)) {
    // Extractor emitted a kind outside its declared set, drop the link.
    // Surface a `extension.error` diagnostic so plugin authors see WHY a
    // link they expected vanished from the result; silent drops are the
    // worst possible plugin-author UX. The orchestrator is the last line
    // of defence against a misbehaving extractor, but the author needs to
    // know the line fired.
    //
    // `extensionId` carries the qualified form `<pluginId>/<id>` (spec
    // § A.6) so the diagnostic matches what `sm plugins list` and
    // registry lookups use. Older builds emitted just the short id; the
    // qualified form is unambiguous across plugins.
    const qualifiedId = `${extractor.pluginId}/${extractor.id}`;
    emitter.emit(
      makeEvent('extension.error', {
        kind: 'link-kind-not-declared',
        extensionId: qualifiedId,
        linkKind: link.kind,
        declaredKinds: extractor.emitsLinkKinds,
        link: { source: link.source, target: link.target, kind: link.kind },
        message: tx(ORCHESTRATOR_TEXTS.extensionErrorLinkKindNotDeclared, {
          extractorId: qualifiedId,
          linkKind: link.kind,
          declaredKinds: extractor.emitsLinkKinds.join(', '),
        }),
      }),
    );
    return null;
  }
  const confidence: Confidence = link.confidence ?? extractor.defaultConfidence;
  return { ...link, confidence };
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
    const target = byPath.get(link.target);
    if (target) target.linksInCount += 1;
  }
}

export function recomputeExternalRefsCount(
  nodes: Node[],
  externalLinks: Link[],
  cachedPaths: Set<string>,
): void {
  const byPath = new Map<string, Node>();
  for (const node of nodes) {
    // Zero only freshly-built nodes. Cached nodes preserve their prior
    // `externalRefsCount` because external pseudo-links were never
    // persisted, so we cannot re-derive the count from a fresh extractor
    // pass, the count survives untouched in the node row.
    if (!cachedPaths.has(node.path)) node.externalRefsCount = 0;
    byPath.set(node.path, node);
  }
  for (const link of externalLinks) {
    const source = byPath.get(link.source);
    // Cached nodes never appear as the source of a freshly-emitted
    // external pseudo-link (extractors didn't run for them), so this
    // increment only ever lands on a freshly-built node, but the guard
    // is cheap and defensive.
    if (source && !cachedPaths.has(source.path)) source.externalRefsCount += 1;
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

function isExternalUrlLink(link: Link): boolean {
  return EXTERNAL_URL_SCHEME_RE.test(link.target);
}
