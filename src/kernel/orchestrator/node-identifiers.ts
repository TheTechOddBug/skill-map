/**
 * Identifier derivation for a node against its kind's declared sources.
 *
 * Two kernel-internal consumers share this helper:
 *
 *   - `liftResolvedLinkConfidence` builds the per-name index (which
 *     nodes resolve which trigger) at post-walk time.
 *   - `buildReservedNodePathSet` (orchestrator) flags nodes whose
 *     identifiers intersect the source Provider's `reservedNames`
 *     catalog, the flag is read by the `core/name-reserved` analyzer
 *     AND by the confidence-lift transform's downgrade rule.
 *
 * Keeping the derivation in one file means a future identifier source
 * (e.g. `'frontmatter.alias'`, `'sidecar.name'`) is added in exactly
 * one place; both consumers pick it up for free.
 */

import { posix as pathPosix } from 'node:path';

import type { IProviderKind, TIdentifierSource } from '../extensions/index.js';
import { normalizeTrigger } from '../trigger-normalize.js';
import type { Node } from '../types.js';

/**
 * Derive every normalised identifier for the node, in the priority
 * order declared by `kindDescriptor.identifiers`. Returns an empty
 * array when the kind declares no sources (the kind is not
 * name-resolvable, see `IProviderKind.identifiers` doc).
 *
 * Each yielded value is already normalised via `normalizeTrigger`
 * (NFD + diacritic strip + lowercase + separator unification), so
 * callers comparing against external strings MUST normalise their
 * side identically. Duplicates within the result are preserved (the
 * caller chooses whether to dedup; the post-walk transform's name
 * index does, the analyzer's reserved-name check does not need to).
 */
export function deriveNodeIdentifiers(
  node: Node,
  kindDescriptor: IProviderKind | undefined,
): readonly string[] {
  const sources = kindDescriptor?.identifiers;
  if (!sources || sources.length === 0) return [];
  const out: string[] = [];
  for (const source of sources) {
    const raw = readIdentifier(source, node);
    if (!raw) continue;
    const normalised = normalizeTrigger(raw);
    if (normalised) out.push(normalised);
  }
  return out;
}

function readIdentifier(source: TIdentifierSource, node: Node): string | null {
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

/** One node's claim on a normalised name (path + the node's kind). */
export interface INameClaim {
  readonly path: string;
  readonly kind: string;
}

/**
 * Names claimed by two or more distinct nodes, keyed by the normalised
 * name. A node contributes only when its kind declares `frontmatter.name`
 * as a resolution identifier (so `core/markdown` nodes, addressed by path,
 * never collide) and it carries a non-empty `name`. Names that normalise
 * to the same value (`Deploy` / `deploy`) collide, mirroring how the
 * resolver keys on the normalised identifier. Computed once per scan and
 * threaded to `core/name-collision` via `IAnalyzerContext.nameCollisions`,
 * the same precompute-and-project pattern as `collectBrokenLinks` /
 * `buildReservedNodePaths`. The `kindRegistry` is keyed by the
 * `<providerId>/<kindName>` tuple, matching the post-walk transform.
 */
export function collectNameCollisions(
  nodes: readonly Node[],
  kindRegistry: ReadonlyMap<string, IProviderKind>,
): Map<string, INameClaim[]> {
  const byName = indexNameClaims(nodes, kindRegistry);
  // Keep only true collisions: two or more DISTINCT node paths.
  const collisions = new Map<string, INameClaim[]>();
  for (const [name, claims] of byName) {
    const distinct = dedupeClaimsByPath(claims);
    if (distinct.length >= 2) collisions.set(name, distinct);
  }
  return collisions;
}

/**
 * Bucket every name-resolvable node by its normalised `frontmatter.name`.
 * A node contributes only when its kind declares `frontmatter.name` as an
 * identifier and it carries a non-empty name. Split from
 * `collectNameCollisions` to keep both branch counts under the lint cap.
 */
function indexNameClaims(
  nodes: readonly Node[],
  kindRegistry: ReadonlyMap<string, IProviderKind>,
): Map<string, INameClaim[]> {
  const byName = new Map<string, INameClaim[]>();
  for (const node of nodes) {
    const name = resolvableName(node, kindRegistry);
    if (name === null) continue;
    const bucket = byName.get(name) ?? [];
    bucket.push({ path: node.path, kind: node.kind });
    byName.set(name, bucket);
  }
  return byName;
}

/**
 * The node's normalised `frontmatter.name` when it is name-resolvable
 * (its kind declares `frontmatter.name` as an identifier) and carries a
 * non-empty name; `null` otherwise. Plain `core/markdown`, addressed by
 * path, declares no `frontmatter.name` identifier and so returns `null`.
 */
function resolvableName(
  node: Node,
  kindRegistry: ReadonlyMap<string, IProviderKind>,
): string | null {
  const descriptor = kindRegistry.get(`${node.provider}/${node.kind}`);
  if (!descriptor?.identifiers?.includes('frontmatter.name')) return null;
  const raw = node.frontmatter?.['name'];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const normalised = normalizeTrigger(raw);
  return normalised.length > 0 ? normalised : null;
}

/** Dedup claims by path (a node indexed twice never self-collides), sorted. */
function dedupeClaimsByPath(claims: readonly INameClaim[]): INameClaim[] {
  return [...new Map(claims.map((c) => [c.path, c])).values()].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
}
