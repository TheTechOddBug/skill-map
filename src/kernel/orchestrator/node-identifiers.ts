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

import type {
  INameClaim,
  INameMismatch,
  IProviderKind,
  TIdentifierSource,
} from '../extensions/index.js';
import { normalizeTrigger } from '../trigger-normalize.js';
import type { Node } from '../types.js';

export type { INameClaim, INameMismatch } from '../extensions/index.js';

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

/**
 * Names claimed by two or more distinct nodes, keyed by the normalised
 * name. Two-tier verdict feeding `core/name-collision` (spec
 * §Provider · kind identifiers · Name collisions): only kinds declaring
 * `frontmatter.name` among their `identifiers` participate (plain
 * `core/markdown` and filename-only kinds contribute nothing, so
 * common-basename twins stay silent), each participating node claims via
 * EVERY declared source that yields a value, and buckets whose claims are
 * all path-derived are dropped (two `deploy.md` under different folders
 * are legitimate). Names that normalise to the same value (`Deploy` /
 * `deploy`) collide, mirroring how the resolver keys on the normalised
 * identifier. Computed once per scan and threaded to `core/name-collision`
 * via `IAnalyzerContext.nameCollisions`, the same precompute-and-project
 * pattern as `collectBrokenLinks` / `buildReservedNodePaths`. The
 * `kindRegistry` is keyed by the `<providerId>/<kindName>` tuple,
 * matching the post-walk transform.
 */
export function collectNameCollisions(
  nodes: readonly Node[],
  kindRegistry: ReadonlyMap<string, IProviderKind>,
): Map<string, INameClaim[]> {
  const byName = indexNameClaims(nodes, kindRegistry);
  // Keep only true collisions: two or more DISTINCT node paths, at
  // least one of them claiming via a DECLARED name (path-only buckets
  // are noise, not authored ambiguity).
  const collisions = new Map<string, INameClaim[]>();
  for (const [name, claims] of byName) {
    const distinct = dedupeClaimsByPath(claims);
    if (distinct.length < 2) continue;
    if (!distinct.some((c) => c.source === 'frontmatter.name')) continue;
    collisions.set(name, distinct);
  }
  return collisions;
}

/**
 * Bucket every collision-relevant claim by its normalised name. Split
 * from `collectNameCollisions` to keep both branch counts under the
 * lint cap.
 */
function indexNameClaims(
  nodes: readonly Node[],
  kindRegistry: ReadonlyMap<string, IProviderKind>,
): Map<string, INameClaim[]> {
  const byName = new Map<string, INameClaim[]>();
  for (const node of nodes) {
    for (const { name, claim } of nodeClaims(node, kindRegistry)) {
      const bucket = byName.get(name) ?? [];
      bucket.push(claim);
      byName.set(name, bucket);
    }
  }
  return byName;
}

/**
 * Every collision-relevant claim for one node. Participation is gated on
 * the kind declaring `frontmatter.name` among its identifiers (plain
 * `core/markdown` and filename-only kinds contribute nothing); a
 * participating node then claims through EVERY declared source that
 * yields a value. Path-derived sources are skipped for virtual nodes
 * (`mcp://<server>` has no meaningful basename or dirname).
 */
function nodeClaims(
  node: Node,
  kindRegistry: ReadonlyMap<string, IProviderKind>,
): Array<{ name: string; claim: INameClaim }> {
  const sources = kindRegistry.get(`${node.provider}/${node.kind}`)?.identifiers;
  if (!sources || !sources.includes('frontmatter.name')) return [];
  const out: Array<{ name: string; claim: INameClaim }> = [];
  for (const source of sources) {
    const entry = claimForSource(node, source);
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * One source's claim for the node, or `null` when the source yields
 * nothing. Path-derived sources are skipped for virtual nodes
 * (`mcp://<server>` has no meaningful basename or dirname).
 */
function claimForSource(
  node: Node,
  source: TIdentifierSource,
): { name: string; claim: INameClaim } | null {
  if (source !== 'frontmatter.name' && node.virtual === true) return null;
  const raw = readIdentifier(source, node);
  if (!raw) return null;
  const name = normalizeTrigger(raw);
  if (!name) return null;
  return { name, claim: { path: node.path, kind: node.kind, source } };
}

/**
 * Dedup claims by path (a node claiming one name via two sources never
 * self-collides), sorted for deterministic issue payloads. The
 * `frontmatter.name`-sourced claim wins the dedup per path: a node whose
 * declared name equals its filename must keep counting as a DECLARED
 * claimant, otherwise a bucket of two same-named commands would drain to
 * path-sourced claims and the error tier would silently degrade to warn
 * (flipping the scan exit code from 1 to 0).
 */
function dedupeClaimsByPath(claims: readonly INameClaim[]): INameClaim[] {
  const byPath = new Map<string, INameClaim>();
  for (const claim of claims) {
    const prev = byPath.get(claim.path);
    if (!prev || (prev.source !== 'frontmatter.name' && claim.source === 'frontmatter.name')) {
      byPath.set(claim.path, claim);
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Nodes whose declared `frontmatter.name` diverges from a declared
 * path-derived identifier (filename stem / parent dirname), per the
 * kind's `identifierMismatch` knob (spec §Provider · kind identifiers ·
 * Identifier agreement). Both sides are compared NORMALISED, so values
 * that collapse to one resolution entry (`Deploy` / `deploy`,
 * `my_skill` / `my-skill`) never mismatch. The effective severity is
 * resolved here, at precompute time, because the projecting analyzer
 * (`core/name-mismatch`) has no access to the kind registry. One entry
 * per divergent (node, path source) pair, raw values preserved for the
 * issue message.
 */
export function collectNameMismatches(
  nodes: readonly Node[],
  kindRegistry: ReadonlyMap<string, IProviderKind>,
): INameMismatch[] {
  const out: INameMismatch[] = [];
  for (const node of nodes) {
    out.push(...nodeMismatches(node, kindRegistry.get(`${node.provider}/${node.kind}`)));
  }
  return out;
}

/** What `nodeMismatches` needs once a node passes the eligibility gate. */
interface IMismatchBasis {
  readonly severity: 'warn' | 'info';
  readonly sources: readonly TIdentifierSource[];
  readonly declaredName: string;
  readonly declared: string;
}

/** The mismatch entries for one node; empty when the kind opts out. */
function nodeMismatches(node: Node, descriptor: IProviderKind | undefined): INameMismatch[] {
  const basis = mismatchBasis(node, descriptor);
  if (!basis) return [];
  const out: INameMismatch[] = [];
  for (const source of basis.sources) {
    if (source === 'frontmatter.name') continue;
    const entry = mismatchForSource(node, source, basis);
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * Eligibility gate + declared-name derivation. `null` when the kind
 * declares no knob, resolves no `frontmatter.name`, the node carries no
 * usable name, or the node is virtual (a `mcp://<server>` path would
 * yield a garbage basename, and no declared-vs-path contract exists for
 * an entity that has no authored file).
 */
function mismatchBasis(node: Node, descriptor: IProviderKind | undefined): IMismatchBasis | null {
  const gate = mismatchGate(node, descriptor);
  if (!gate) return null;
  const declaredName = readFrontmatterName(node);
  if (!declaredName) return null;
  const declared = normalizeTrigger(declaredName);
  if (!declared) return null;
  return { ...gate, declaredName, declared };
}

/** The knob + identifier gate half of `mismatchBasis`; split for the lint complexity cap. */
function mismatchGate(
  node: Node,
  descriptor: IProviderKind | undefined,
): Pick<IMismatchBasis, 'severity' | 'sources'> | null {
  const severity = descriptor?.identifierMismatch;
  const sources = descriptor?.identifiers;
  if (!severity || !sources?.includes('frontmatter.name') || node.virtual === true) return null;
  return { severity, sources };
}

/** One path source's divergence entry, or `null` when it agrees / yields nothing. */
function mismatchForSource(
  node: Node,
  source: Exclude<TIdentifierSource, 'frontmatter.name'>,
  basis: IMismatchBasis,
): INameMismatch | null {
  const derivedName = readIdentifier(source, node);
  if (!derivedName) return null;
  const derived = normalizeTrigger(derivedName);
  if (!derived || derived === basis.declared) return null;
  return {
    path: node.path,
    kind: node.kind,
    severity: basis.severity,
    declaredName: basis.declaredName,
    derivedName,
    derivedSource: source,
  };
}
