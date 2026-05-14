/**
 * Trigger → path resolution for graph rendering.
 *
 * Extractors that emit invocation-style links (`slash`, `at-directive`)
 * keep `link.target` as the **bare trigger** (`/full-command-claude`,
 * `@my-agent`) because target resolution is the rules layer's job
 * (kernel side, see `core/broken-ref`). The graph view, however, has
 * to draw the arrow between actual node cards, not a phantom node
 * named after the trigger; so it needs to map `/foo` to the node
 * whose `frontmatter.name` normalises to `foo`.
 *
 * Behaviour mirrors `core/broken-ref`'s `isResolved()` (`src/built-in-
 * plugins/analyzers/broken-ref/index.ts`):
 *   - strip the leading sigil (`/` or `@`),
 *   - normalise (NFD → strip Mn → lowercase → separator unify → trim),
 *   - lookup in the per-scan name index.
 *
 * The normalizer is a verbatim port of
 * `src/kernel/trigger-normalize.ts` so a node that resolves on the
 * kernel side (no `broken-ref` issue) also resolves on the UI side
 * (edge drawn between real nodes).
 */

/**
 * Normalize a trigger to its canonical comparable form. Identical to
 * the kernel implementation; any change here must also land in
 * `src/kernel/trigger-normalize.ts`.
 */
export function normalizeTrigger(source: string): string {
  let out = source.normalize('NFD');
  out = out.replace(/\p{Mn}+/gu, '');
  out = out.toLowerCase();
  out = out.replace(/[-_\s]+/g, ' ');
  out = out.replace(/\s+/g, ' ');
  return out.trim();
}

/**
 * Build a `normalize(name) → path` index from the node set. Nodes
 * without a `frontmatter.name` are skipped (they cannot be addressed
 * by trigger). Collisions are reported back via the duplicate
 * tracker so the caller can decide how to handle them; the index
 * keeps the FIRST occurrence so the resolution is deterministic.
 */
export function buildNameIndex(
  nodes: readonly { path: string; frontmatter?: { name?: unknown } }[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const node of nodes) {
    const raw = node.frontmatter?.name;
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const key = normalizeTrigger(raw);
    if (!out.has(key)) out.set(key, node.path);
  }
  return out;
}

/**
 * Resolve a link target to a node path when the target is a bare
 * trigger (starts with `/` or `@`). Returns the original target
 * untouched when:
 *   - the target is already path-style (no leading sigil), or
 *   - no node's name normalises to the trigger (kernel side
 *     `broken-ref` would flag this; the UI keeps the raw target so
 *     the existing `validPaths.has(target)` check drops the edge).
 *
 * `normalizedTrigger` is preferred when present (already normalized,
 * cheaper); falls back to normalising the raw target if absent.
 */
export function resolveTargetToPath(
  rawTarget: string,
  normalizedTrigger: string | null,
  nameIndex: ReadonlyMap<string, string>,
): string {
  const sigil = rawTarget.charAt(0);
  if (sigil !== '/' && sigil !== '@') return rawTarget;
  const normalized =
    normalizedTrigger !== null
      ? normalizedTrigger.replace(/^[/@]/, '').trim()
      : normalizeTrigger(rawTarget.slice(1));
  const resolved = nameIndex.get(normalized);
  return resolved ?? rawTarget;
}
