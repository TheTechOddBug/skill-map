/**
 * Collect the 1-indexed body lines where a Link was detected. Shared by
 * the analyzers that append a `(line N)` / `(lines N, M)` location
 * suffix to their finding messages (`reference-broken`,
 * `link-self-loop`, `name-reserved`).
 *
 * Source of truth, in order:
 *   1. `link.occurrences[].location.line`, the post-walk dedup's audit
 *      trail (one entry per detection site, possibly from several
 *      extractors converging on the same edge).
 *   2. The merged edge's own `link.location.line` when no occurrence
 *      carries a line.
 *
 * Deduplicated, ascending. Empty when the extractor tracked no lines
 * (frontmatter / sidecar-derived links), in which case callers omit
 * the suffix entirely.
 */

import type { Link } from '../types.js';

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
