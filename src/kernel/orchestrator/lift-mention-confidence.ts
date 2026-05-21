/**
 * Post-resolution confidence bump for `mentions` links.
 *
 * An extractor (today only `claude/at-directive`) emits a `mentions`
 * link with confidence `0.5` when it sees a bare handle like `@reviewer`
 * in a body, because the extractor cannot tell at extraction time
 * whether `reviewer` is a real entity in the graph, a nominal mention
 * ("the architect agent"), or generic prose. After the scan resolves
 * targets, mentions that point at an existing node are no longer
 * ambiguous, the runtime would treat them as real invocations, so the
 * graph's visual weight should reflect that.
 *
 * Policy (decided in `bd-owi`): a `mentions` link whose
 * `normalizedTrigger` (sigil-stripped, see broken-ref's resolver)
 * matches a node's `frontmatter.name` index, OR whose `target` matches
 * a node's `path`, gets its confidence bumped to `1.0`. Mentions that
 * do not resolve keep their `0.5` so the UI can still differentiate
 * "real but ambiguous" from "broken".
 *
 * The bump runs after `dedupeLinks` (so cross-extractor merge has
 * already settled `sources[]`) and before analyzers (so `broken-ref`
 * still sees the un-bumped state and fires its existing semantic for
 * unresolved triggers). Mutates `links` in place to align with the
 * dedup helper's style; the orchestrator passes the same array on to
 * the analyzer phase.
 */

import { normalizeTrigger } from '../trigger-normalize.js';
import type { Link, Node } from '../types.js';

/**
 * Bump every resolved `mentions` link in `links` to confidence 1.0.
 * No-op for any other link kind. In-place mutation.
 */
export function liftMentionConfidence(links: Link[], nodes: readonly Node[]): void {
  // Cheap early-out: if there are no mention links at all, skip the
  // index build entirely. Most scans have only path-style + invocation
  // links, so the common case stays free.
  if (!links.some((l) => l.kind === 'mentions')) return;

  const byPath = new Set<string>();
  for (const node of nodes) byPath.add(node.path);
  const byNormalizedName = indexByNormalizedName(nodes);

  for (const link of links) {
    if (link.kind !== 'mentions') continue;
    if (isResolved(link, byPath, byNormalizedName)) {
      // 1.0: the target exists in the graph. The runtime would
      // resolve the mention to a real node; the visual weight in the
      // UI matches that reality instead of staying at the
      // extraction-time ambiguity baseline.
      link.confidence = 1.0;
    }
  }
}

/**
 * Same resolution rule the `core/broken-ref` analyzer uses, kept here
 * as a tiny duplicate rather than imported from the plugin to avoid a
 * kernel → plugin dependency. If a third caller appears, refactor
 * both onto a shared util.
 */
function isResolved(
  link: Link,
  byPath: Set<string>,
  byNormalizedName: Map<string, true>,
): boolean {
  const normalized = link.trigger?.normalizedTrigger;
  if (normalized) {
    const withoutSigil = normalized.replace(/^[/@]/, '').trim();
    if (byNormalizedName.has(withoutSigil)) return true;
  }
  if (byPath.has(link.target)) return true;
  return false;
}

/**
 * Name index keyed by `normalizeTrigger(node.frontmatter.name)`.
 * Returns a presence-only Map (the analyzer phase needs the full
 * candidate list for hint generation, but the confidence bump just
 * needs "does it exist?"), so we keep the index lighter.
 */
function indexByNormalizedName(nodes: readonly Node[]): Map<string, true> {
  const out = new Map<string, true>();
  for (const node of nodes) {
    const raw = node.frontmatter?.['name'];
    const name = typeof raw === 'string' ? raw : '';
    if (!name) continue;
    out.set(normalizeTrigger(name), true);
  }
  return out;
}
