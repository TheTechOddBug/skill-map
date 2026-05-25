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
