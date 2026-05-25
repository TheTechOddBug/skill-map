/**
 * Trigger → path resolution for kernel-side consumers (analyzers like
 * `core/link-counter` that need to count edges against the *real*
 * target, not the bare trigger an extractor emitted).
 *
 * Mirrors the UI's `ui/src/services/trigger-resolve.ts`. Two passes
 * over the node set when building the name index:
 *
 *   1. Index by `frontmatter.name` (the canonical addressable name).
 *   2. Fill gaps with a path-derived basename for nodes whose
 *      `frontmatter.name` is missing or empty, so the analyzer can
 *      still resolve `@foo` / `/foo` to `.claude/agents/foo.md`
 *      when the `.md` has broken / missing frontmatter (a typical
 *      shape in the wild and in fixtures).
 *
 * The first-occurrence-wins rule applies inside each pass: a node
 * with a canonical name claims the key before any path-derived
 * fallback can step on it.
 *
 * Behaviour parity with `core/reference-broken`'s own `indexByNormalizedName`
 * is intentional but partial, `reference-broken` does NOT use the path
 * fallback (it deliberately flags nodes with missing names as broken
 * targets so the operator fixes the frontmatter). `link-counter` is
 * the opposite, the chip should reflect what the graph *renders*,
 * including the UI's path-basename fallback, so the operator sees
 * the same number on the chip as flèches on the canvas.
 */

import { normalizeTrigger } from '../trigger-normalize.js';
import type { Node, Link } from '../types.js';

/**
 * Build a `normalize(name) → path` index from a node set. See module
 * doc-comment for the two-pass semantics.
 */
export function buildNameIndex(nodes: readonly Node[]): Map<string, string> {
  const out = new Map<string, string>();
  indexByCanonicalName(nodes, out);
  fillIndexWithPathBasename(nodes, out);
  return out;
}

function indexByCanonicalName(nodes: readonly Node[], out: Map<string, string>): void {
  for (const node of nodes) {
    const raw = canonicalName(node);
    if (raw === null) continue;
    const key = normalizeTrigger(raw);
    if (!out.has(key)) out.set(key, node.path);
  }
}

function fillIndexWithPathBasename(nodes: readonly Node[], out: Map<string, string>): void {
  for (const node of nodes) {
    if (canonicalName(node) !== null) continue;
    const derived = pathBasenameForLink(node.path);
    if (derived.length === 0) continue;
    const key = normalizeTrigger(derived);
    if (!out.has(key)) out.set(key, node.path);
  }
}

function canonicalName(node: Node): string | null {
  const raw = node.frontmatter?.['name'];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return raw;
}

/**
 * Path → friendly basename, mirrors the UI's helper of the same name.
 * `<dir>/<name>/SKILL.md` → `<name>`; `<dir>/<name>.md` → `<name>`;
 * bare path with no slash → path stripped of `.md`.
 */
export function pathBasenameForLink(path: string): string {
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return path;
  const last = segments[segments.length - 1]!;
  if (last === 'SKILL.md' && segments.length >= 2) {
    return segments[segments.length - 2]!;
  }
  return last.replace(/\.md$/, '');
}

/**
 * Resolve a `Link`'s `target` to a node path when the target is a
 * bare trigger (starts with `/` or `@`). Returns the raw target
 * untouched when:
 *   - already path-style (no leading sigil); or
 *   - no node's name normalises to the trigger.
 *
 * `link.trigger?.normalizedTrigger` is preferred when present
 * (already normalised, cheaper); falls back to normalising the raw
 * target without the sigil otherwise.
 */
export function resolveLinkTargetToPath(
  link: Link,
  nameIndex: ReadonlyMap<string, string>,
): string {
  const raw = link.target;
  const sigil = raw.charAt(0);
  if (sigil !== '/' && sigil !== '@') return raw;
  const normalizedTrigger = link.trigger?.normalizedTrigger;
  const normalized =
    typeof normalizedTrigger === 'string'
      ? normalizedTrigger.replace(/^[/@]/, '').trim()
      : normalizeTrigger(raw.slice(1));
  const resolved = nameIndex.get(normalized);
  return resolved ?? raw;
}
