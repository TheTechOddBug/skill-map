/**
 * Body offset → 1-indexed line conversion. Shared by every extractor
 * that records `LinkOccurrence.location.line` (today: `markdown-link`,
 * `slash`, `at-directive`). The two helpers are intentionally small and
 * allocation-light because they run inside the per-emit loop of each
 * extractor.
 *
 * Algorithm: precompute the start offset of every line once per body
 * via `computeLineStarts`, then use binary search (`lineFor`) for each
 * match. O(N) to precompute, O(log N) per lookup.
 */

/**
 * Sorted list of byte offsets at which each line starts. Index 0 is
 * always `0`. Each subsequent entry is the offset immediately AFTER a
 * `\n` byte, so the line at `starts[k]` covers offsets `[starts[k],
 * starts[k+1])`.
 */
export function computeLineStarts(body: string): number[] {
  const starts = [0];
  for (let i = 0; i < body.length; i += 1) {
    if (body.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return starts;
}

/**
 * Resolve `offset` against the precomputed `lineStarts` table and
 * return the 1-indexed line number containing that offset. Binary
 * search keeps the per-emit cost logarithmic so extractors that match
 * dozens of triggers in a single body stay cheap.
 */
export function lineFor(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineStarts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
