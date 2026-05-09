/**
 * Path-display helpers for CLI human output.
 *
 * Shared after the fourth caller earned the extraction (audit:
 * `scan.ts`, `db.ts`, `config.ts` had near-identical inline copies; a
 * fourth would have made the drift cost real). See
 * `context/cli-output-style.md` §5.
 *
 * `serve-banner.ts` keeps its own `formatDbPath` — it sanitises the
 * input string first, which the rest of the CLI does at the row-shape
 * boundary instead. The shared helper here stays sanitisation-free
 * so callers can compose; sanitise once at the boundary, then format.
 */

import { isAbsolute, relative as pathRelative } from 'node:path';

/**
 * Render `path` relative to `cwd` when it sits under it, otherwise
 * return the input unchanged.
 *
 * - Relative inputs pass through verbatim (no work to do).
 * - Absolute inputs under `cwd` collapse to `.skill-map/...`-style
 *   short displays.
 * - Absolute inputs OUTSIDE `cwd` (parents, siblings, different
 *   roots, Windows drives) keep their original absolute form so the
 *   user is never confused about WHICH file the path points at.
 *
 * Caller is responsible for sanitising plugin- / DB-sourced paths
 * with `sanitizeForTerminal` BEFORE calling — this helper does NOT
 * touch ANSI / C0 bytes.
 */
export function relativeIfBelow(path: string, cwd: string): string {
  if (!isAbsolute(path)) return path;
  const rel = pathRelative(cwd, path);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return path;
  return rel;
}
