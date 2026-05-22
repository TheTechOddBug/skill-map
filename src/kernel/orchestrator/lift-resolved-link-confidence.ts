/**
 * Post-resolution confidence bump for links whose normalized trigger or
 * target resolves against a known node in the merged graph. Sits as a
 * post-walk transform (see `post-walk-transforms.ts`), runs AFTER
 * `dedupeLinks` so the merged edge state is final before the bump.
 *
 * Two independent rules, applied in order, first hit wins:
 *
 *   1. **Path match (any link.kind)**: `link.target` equals a node's
 *      `path` ⇒ confidence bumped to 1.0. Covers `at-directive`
 *      references (target is a resolved relative path),
 *      `markdown-link` references (already 1.0 from emit, no-op
 *      here), and `core/mcp-tools` references (target is the synthetic
 *      `mcp://<server>` node, emitted alongside the link).
 *
 *   2. **Name match (links with `trigger.normalizedTrigger`)**:
 *      strip the leading `@` / `/` sigil, look up the resulting handle
 *      in the name index. The index is built from each node's
 *      declared `identifiers` sources (`frontmatter.name`,
 *      `filename-basename`, `dirname`, see [`provider.ts`
 *      `IProviderKind.identifiers`](../extensions/provider.ts)).
 *      A match bumps only when the candidate node's `kind` is in the
 *      source Provider's `resolution[link.kind]` list, the strict
 *      kind matrix avoids slash → agent and mention → command false
 *      positives.
 *
 * Links that hit neither rule stay at their extractor-emitted
 * confidence (typically 0.5 for bare `@handle` mentions, 0.8 for clean
 * `/cmd` slash invocations), so `broken-ref` can still flag them on
 * the analyzer side, the visual ambiguity is preserved.
 *
 * Mutates `links` in place to align with `dedupeLinks` style; the
 * orchestrator passes the same array on to the analyzer phase.
 */

import { posix as pathPosix } from 'node:path';

import { normalizeTrigger } from '../trigger-normalize.js';
import type { Link, Node } from '../types.js';
import type { TIdentifierSource } from '../extensions/index.js';
import type { IPostWalkTransformCtx } from './post-walk-transforms.js';

/**
 * Per-candidate row stored in the name index. Carries only the kind so
 * the strict-kind filter (against the source Provider's `resolution`
 * map) can run on a hit without holding a node reference.
 */
interface INameIndexEntry {
  readonly kind: string;
}

/**
 * Bump every resolvable invocation link in `links` to confidence 1.0.
 * No-op for any link already at >= 1.0 confidence. In-place mutation.
 */
export function liftResolvedLinkConfidence(
  links: Link[],
  nodes: readonly Node[],
  ctx: IPostWalkTransformCtx,
): void {
  if (!links.some((l) => l.confidence < 1)) return;
  const indexes = buildIndexes(nodes, ctx);
  for (const link of links) {
    if (link.confidence < 1 && resolves(link, indexes, ctx)) {
      link.confidence = 1.0;
    }
  }
}

interface IIndexes {
  readonly byPath: ReadonlySet<string>;
  readonly byName: ReadonlyMap<string, INameIndexEntry[]>;
  readonly nodeByPath: ReadonlyMap<string, Node>;
}

function buildIndexes(nodes: readonly Node[], ctx: IPostWalkTransformCtx): IIndexes {
  const byPath = new Set<string>();
  const byName = new Map<string, INameIndexEntry[]>();
  const nodeByPath = new Map<string, Node>();
  for (const node of nodes) {
    byPath.add(node.path);
    nodeByPath.set(node.path, node);
    indexNode(node, ctx, byName);
  }
  return { byPath, byName, nodeByPath };
}

/**
 * Per-link decision: does this link resolve under either of the two
 * rules? Path match runs first (cheaper); the name-match path consults
 * the source Provider's `resolution` matrix.
 */
function resolves(link: Link, indexes: IIndexes, ctx: IPostWalkTransformCtx): boolean {
  if (indexes.byPath.has(link.target)) return true;
  return resolvesByName(link, indexes, ctx);
}

function resolvesByName(link: Link, indexes: IIndexes, ctx: IPostWalkTransformCtx): boolean {
  const stripped = stripTriggerSigil(link.trigger?.normalizedTrigger);
  if (stripped === null) return false;
  const candidates = indexes.byName.get(stripped);
  if (!candidates?.length) return false;
  const allowedKinds = lookupAllowedKinds(link, indexes, ctx);
  if (!allowedKinds?.length) return false;
  return candidates.some((c) => allowedKinds.includes(c.kind));
}

function lookupAllowedKinds(
  link: Link,
  indexes: IIndexes,
  ctx: IPostWalkTransformCtx,
): readonly string[] | undefined {
  const sourceNode = indexes.nodeByPath.get(link.source);
  if (!sourceNode) return undefined;
  return ctx.providerResolution.get(sourceNode.provider)?.[link.kind];
}

/**
 * Strip the leading `@` or `/` sigil from a normalized trigger so the
 * remaining handle aligns with the name index entries (which are
 * stored sigil-free). Returns `null` when the trigger is empty / absent
 * so the caller can short-circuit.
 */
function stripTriggerSigil(normalized: string | undefined): string | null {
  if (!normalized) return null;
  const trimmed = normalized.replace(/^[/@]/, '').trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Iterate the node's kind's declared `identifiers` and contribute one
 * normalized entry per source to `byName`. Multiple identifier sources
 * that resolve to the same normalized name collapse into a single
 * bucket entry (the bucket carries the kind for the downstream filter,
 * not the source-of-truth).
 */
function indexNode(
  node: Node,
  ctx: IPostWalkTransformCtx,
  byName: Map<string, INameIndexEntry[]>,
): void {
  const kindDescriptor = ctx.kindRegistry.get(kindKey(node));
  const sources = kindDescriptor?.identifiers;
  if (!sources || sources.length === 0) return;

  for (const source of sources) {
    const raw = deriveIdentifier(source, node);
    if (!raw) continue;
    const normalized = normalizeTrigger(raw);
    if (!normalized) continue;
    const bucket = byName.get(normalized);
    if (bucket) {
      bucket.push({ kind: node.kind });
    } else {
      byName.set(normalized, [{ kind: node.kind }]);
    }
  }
}

/**
 * Read one identifier value from a node according to the declared
 * source. Returns the raw (un-normalized) string or `null` when the
 * source yields nothing (e.g. `frontmatter.name` absent, dirname empty
 * for a root-level file, basename stripped to nothing).
 */
function deriveIdentifier(source: TIdentifierSource, node: Node): string | null {
  if (source === 'frontmatter.name') return readFrontmatterName(node);
  if (source === 'filename-basename') return readFilenameBasename(node);
  return readDirname(node);
}

function readFrontmatterName(node: Node): string | null {
  const raw = node.frontmatter?.['name'];
  if (typeof raw !== 'string') return null;
  return raw.length > 0 ? raw : null;
}

function readFilenameBasename(node: Node): string | null {
  const base = pathPosix.basename(node.path);
  if (!base) return null;
  const ext = pathPosix.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  return stem.length > 0 ? stem : null;
}

function readDirname(node: Node): string | null {
  const dir = pathPosix.dirname(node.path);
  if (!dir || dir === '.' || dir === '/') return null;
  const base = pathPosix.basename(dir);
  return base.length > 0 ? base : null;
}

/**
 * The kind registry built by the orchestrator keys entries by the
 * `<providerId>/<kindName>` tuple so two Providers can declare the
 * same kind name (e.g. both `claude` and `gemini` ship `agent`)
 * without collision. This helper mirrors the key shape on the lookup
 * side.
 */
function kindKey(node: Node): string {
  return `${node.provider}/${node.kind}`;
}
