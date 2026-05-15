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
 * Build a `normalize(name) → path` index from the node set.
 *
 * Two-pass strategy so the canonical `frontmatter.name` always wins
 * when present, and nodes with a broken / empty / missing `name`
 * still participate in trigger resolution via a path-derived
 * fallback. The fallback matters in practice when a `.md` has a
 * frontmatter parse error or fails schema validation, the kernel's
 * `broken-ref` still flags the absent name, but the graph view
 * keeps rendering the intended `@foo` / `/foo` edge so the operator
 * can see the topology and fix the frontmatter from there.
 *
 * Pass 1 indexes every node whose `frontmatter.name` is a non-empty
 * string. Pass 2 fills gaps with `pathBasenameForLink(node.path)`
 * for nodes the first pass skipped, the first occurrence wins so
 * resolution stays deterministic.
 */
type INameIndexNode = { path: string; frontmatter?: { name?: unknown } };

export function buildNameIndex(nodes: readonly INameIndexNode[]): Map<string, string> {
  const out = new Map<string, string>();
  indexByCanonicalName(nodes, out);
  fillIndexWithPathBasename(nodes, out);
  return out;
}

function indexByCanonicalName(
  nodes: readonly INameIndexNode[],
  out: Map<string, string>,
): void {
  for (const node of nodes) {
    const raw = canonicalName(node);
    if (raw === null) continue;
    const key = normalizeTrigger(raw);
    if (!out.has(key)) out.set(key, node.path);
  }
}

function fillIndexWithPathBasename(
  nodes: readonly INameIndexNode[],
  out: Map<string, string>,
): void {
  for (const node of nodes) {
    if (canonicalName(node) !== null) continue;
    const derived = pathBasenameForLink(node.path);
    if (derived.length === 0) continue;
    const key = normalizeTrigger(derived);
    if (!out.has(key)) out.set(key, node.path);
  }
}

function canonicalName(node: INameIndexNode): string | null {
  const raw = node.frontmatter?.name;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return raw;
}

/**
 * Path → friendly basename used as the trigger-resolution fallback
 * and as the node-card display name when `frontmatter.name` is
 * absent. Conventions:
 *
 *   - `<dir>/<name>/SKILL.md`  → `<name>`
 *   - `<dir>/<name>.md`        → `<name>`
 *   - bare path with no slash  → path stripped of `.md`
 *
 * Pure helper, no Angular deps.
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
