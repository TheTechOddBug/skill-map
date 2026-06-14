/**
 * Link-derived helpers shared across the built-in analyzers:
 *   - `isSelfLoop`, the self-reference predicate.
 *   - `linkLines`, the 1-indexed body lines where a Link was detected,
 *     fed to `formatFinding`'s `lines` so the canonical `L<line>:` prefix
 *     stays consistent (`reference-broken`, `link-self-loop`,
 *     `name-reserved`).
 */

import type { Link } from '../types.js';

/**
 * A link is a self-loop when its source node is also its own target,
 * either directly (`source === target`, a path-style link pointing at
 * its own file) or after trigger resolution (`source === resolvedTarget`,
 * e.g. a `# /deploy` heading inside the file that defines `/deploy`).
 *
 * The resolved arm reads `link.resolvedTarget`, the authoritative path
 * the post-walk lift transform (`lift-resolved-link-confidence.ts`)
 * stamps onto every edge that resolves to a real node. Both the
 * `core/link-self-loop` analyzer (which warns) and `core/link-counter`
 * (which skips the loop when tallying footer chips) call this, so the two
 * cannot drift on what "self-loop" means.
 */
export function isSelfLoop(link: Link): boolean {
  if (link.source === link.target) return true;
  if (link.resolvedTarget && link.source === link.resolvedTarget) return true;
  return false;
}

/**
 * Collect the 1-indexed body lines where a Link was detected.
 *
 * Source of truth, in order:
 *   1. `link.occurrences[].location.line`, the post-walk dedup's audit
 *      trail (one entry per detection site, possibly from several
 *      extractors converging on the same edge).
 *   2. The merged edge's own `link.location.line` when no occurrence
 *      carries a line.
 *
 * Deduplicated, ascending. Empty when the extractor tracked no lines
 * (frontmatter / sidecar-derived links), in which case `formatFinding`
 * omits the `L<line>:` prefix entirely.
 */
export function linkLines(link: Link): number[] {
  const lines = new Set<number>();
  for (const occ of link.occurrences ?? []) {
    const line = occ.location?.line;
    if (typeof line === 'number') lines.add(line);
  }
  if (lines.size === 0) {
    const line = link.location?.line;
    if (typeof line === 'number') lines.add(line);
  }
  return [...lines].sort((a, b) => a - b);
}
