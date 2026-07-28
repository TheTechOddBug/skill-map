/**
 * The single YAML entry point for untrusted documents.
 *
 * Every YAML skill-map parses is attacker-authored under the
 * clone-and-scan threat model: `.md` frontmatter and `.sm` sidecars both
 * come out of a tree the operator did not write. `js-yaml` defaults are
 * tuned for trusted input, so calling `load()` directly is a footgun.
 *
 * --- The "billion laughs" problem, and why the obvious fix is not one --
 *
 * Mutually-referencing anchors let a few hundred bytes denote an
 * astronomically large structure:
 *
 *   a0: &a0 "boom"
 *   a1: &a1 [*a0, *a0, ... ]     # nine times
 *   a2: &a2 [*a1, *a1, ... ]     # nine levels deep -> 9^9 leaves
 *
 * `load()` itself stays fast and small: it returns a shared-reference
 * DAG, not a tree. The detonation happens downstream, the moment
 * anything materialises it, and skill-map materialises it twice over
 * (`stripPrototypePollution` deep-clones; persistence `JSON.stringify`s).
 * The observed failure was a hard `heap out of memory` that takes the
 * whole `sm serve` process, BFF plus watcher plus UI, down with it. A
 * byte cap like `scan.maxFileSizeBytes` is no defence at 400 bytes.
 *
 * **`maxAliases` alone does NOT close this.** It bounds how many alias
 * TOKENS the document may contain, not how large the graph they denote
 * expands to. Two references per level is enough: `N` alias tokens buy
 * `2^(N/2)` leaves, so even a cap of 100 still permits `2^50`. The cap is
 * kept as a cheap first line, but the real bound has to be measured on
 * the parsed graph, which is what {@link assertExpansionBudget} does, in
 * time proportional to the DISTINCT nodes (memoised subtree sizes) rather
 * than to the expanded size it is protecting against.
 *
 * `JSON_SCHEMA` is likewise baked in: it excludes `!!js/function`,
 * `!!js/regexp` and `!!js/undefined`, so no tag can construct executable
 * values (audit L3). It also excludes the `<<` merge type, which is why
 * `maxTotalMergeKeys` below is belt-and-braces rather than load-bearing.
 *
 * A document that trips any bound throws a `YAMLException`, exactly like
 * a syntax error, so existing call sites surface it through their normal
 * parse-error path (an issue on the node) instead of crashing.
 */

import { load as yamlLoad, JSON_SCHEMA, YAMLException } from 'js-yaml';

/**
 * Parser bounds handed to js-yaml.
 *
 * `maxAliases` is the only one that departs from the library defaults
 * (upstream is `-1`, unlimited). `maxDepth` and `maxTotalMergeKeys`
 * match the defaults and are re-stated so an upstream change cannot
 * silently widen our exposure.
 */
export const YAML_LOAD_LIMITS = {
  maxAliases: 100,
  maxDepth: 100,
  maxTotalMergeKeys: 10_000,
} as const;

/**
 * Maximum number of nodes the parsed document may denote once expanded.
 *
 * Legitimate frontmatter and sidecars are metadata: tens of nodes,
 * hundreds at the outside. 100k leaves four orders of magnitude of head
 * room while keeping the materialised form comfortably small.
 */
export const YAML_MAX_EXPANDED_NODES = 100_000;

/**
 * Reject a parsed document whose expanded size exceeds the budget, or
 * that is cyclic.
 *
 * Walks the DAG memoising each object's subtree size, so a node shared
 * by a thousand parents is costed once and the whole check runs in time
 * proportional to the DISTINCT node count. That is what makes it viable:
 * naively counting an expanded bomb would take as long as building it.
 *
 * A true cycle (`a: &a [*a]`) denotes an infinitely large document and
 * is refused outright, it can never be legitimate metadata and would
 * hang any downstream serializer.
 */
function assertExpansionBudget(root: unknown, budget: number): void {
  const sizes = new Map<object, number>();
  const inProgress = new Set<object>();

  const measure = (value: unknown): number => {
    if (value === null || typeof value !== 'object') return 1;
    const obj = value as object;
    const known = sizes.get(obj);
    if (known !== undefined) return known;
    if (inProgress.has(obj)) {
      throw new YAMLException('document contains a cyclic anchor reference');
    }
    inProgress.add(obj);

    let total = 1;
    const children: unknown[] = Array.isArray(obj)
      ? obj
      : Object.keys(obj).map((key) => (obj as Record<string, unknown>)[key]);
    for (const child of children) {
      total += measure(child);
      if (total > budget) {
        throw new YAMLException(
          `document expands beyond the ${budget}-node budget (alias expansion)`,
        );
      }
    }

    inProgress.delete(obj);
    sizes.set(obj, total);
    return total;
  };

  measure(root);
}

/**
 * Parse an untrusted YAML document under {@link YAML_LOAD_LIMITS} and
 * {@link YAML_MAX_EXPANDED_NODES}.
 *
 * Returns whatever the document denotes (a scalar, an array, an object);
 * callers narrow. Throws `YAMLException` on a syntax error, a breached
 * parser limit, a cyclic anchor, or an over-budget expansion. Callers
 * already handle the first case and want identical handling for the rest.
 */
export function loadYamlSafe(raw: string): unknown {
  const doc = yamlLoad(raw, { schema: JSON_SCHEMA, ...YAML_LOAD_LIMITS });
  assertExpansionBudget(doc, YAML_MAX_EXPANDED_NODES);
  return doc;
}
