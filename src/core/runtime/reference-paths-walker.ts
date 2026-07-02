/**
 * Reference-paths walker, collects every existing absolute file path
 * under each configured `scan.referencePaths` entry into a side set.
 *
 * Purpose: feeds `IAnalyzerContext.referenceablePaths` so the built-in
 * `core/reference-broken` rule can suppress its `warn` for path-style links
 * whose target lands in the set. Files here are NOT parsed and NOT
 * indexed as graph nodes, the only effect is link-validation
 * coverage outside the indexed surface.
 *
 * Walk shape:
 *   - Recursive, depth-first.
 *   - Skips symlinks (no cycle detection, the simplest correct path).
 *   - Skips well-known noisy dirs (`node_modules`, `.git`, `.skill-map`).
 *   - Caps the output at `MAX_FILES` (50_000) to bound memory + time
 *     when an operator points the setting at a huge tree by mistake.
 *     The cap is an absolute hard stop across all roots combined.
 *   - Missing / non-directory roots are silently skipped (parity with
 *     `findOrphanJobFiles`, a misconfigured path is a no-op, not a
 *     throw, because the scan must keep working).
 *
 * Lives under `core/runtime/` so both CLI and BFF can share one
 * implementation. Receives `cwd` as a parameter; reads no
 * `process.env` / `process.cwd()` (kernel-boundary lint rule applies
 * to `core/**`).
 *
 * `~/...` expansion: `scan.referencePaths` entries written by the
 * user with a leading `~/` are resolved against the operator's home
 * directory via a direct `os.homedir()` read. This is an EXPLICIT,
 * user-authored read (the value lands in `project-local` config; the
 * user wrote `~/` deliberately) and is therefore consistent with
 * `spec/cli-contract.md` §Scope is always project-local, which
 * forbids IMPLICIT `$HOME` reads (auto-walking `~/.skill-map/...`,
 * picking up global state without the operator naming it). The
 * spec's `scan.referencePaths` text mandates that `~/...` entries
 * resolve against the user home; this expander honours that.
 */

import { readdirSync, statSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { SKILL_MAP_DIR } from '../paths/db-path.js';

/** Hard cap on total files collected across every reference-path root. */
export const REFERENCE_WALK_MAX_FILES = 50_000;

const SKIPPED_DIR_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  SKILL_MAP_DIR,
]);

export interface IReferencePathsWalkResult {
  /** Absolute paths of every existing file under the configured roots. */
  paths: Set<string>;
  /** True when the walk hit `REFERENCE_WALK_MAX_FILES` and stopped early. */
  truncated: boolean;
  /**
   * Roots we resolved (post-`~` expansion + relative-to-`cwd`
   * resolution) but that did not exist on disk. Surfaced so the
   * driving adapter can warn the operator without the walker
   * touching stderr itself.
   */
  missingRoots: string[];
}

/**
 * Resolve a `scan.referencePaths` entry against the project's runtime
 * context. `~` expands to the operator's home (explicit user-authored
 * read, see module header); relative paths resolve against `cwd`;
 * absolute paths pass through.
 */
export function resolveScanPath(raw: string, cwd: string): string {
  if (raw.startsWith('~/')) return resolve(join(osHomedir(), raw.slice(2)));
  if (raw === '~') return resolve(osHomedir());
  if (isAbsolute(raw)) return resolve(raw);
  return resolve(cwd, raw);
}

/**
 * Walk every configured root and return the side-set of absolute file
 * paths. Never throws, IO failures degrade to "the offending root
 * contributed nothing." The caller surfaces `truncated` /
 * `missingRoots` to the operator.
 */
export function walkReferencePaths(
  rawRoots: readonly string[],
  cwd: string,
): IReferencePathsWalkResult {
  const paths = new Set<string>();
  const missingRoots: string[] = [];
  let truncated = false;

  for (const raw of rawRoots) {
    if (truncated) break;
    const root = resolveScanPath(raw, cwd);
    const stat = safeStat(root);
    if (!stat || !stat.isDirectory()) {
      missingRoots.push(root);
      continue;
    }
    truncated = walkInto(root, paths) || truncated;
  }

  return { paths, truncated, missingRoots };
}

// Cyclomatic complexity is dominated by the per-entry dispatch
// (file / dir / symlink / skip-list / cap-check). Splitting further
// scatters the dispatch table without making the algorithm clearer.
// eslint-disable-next-line complexity
function walkInto(dir: string, out: Set<string>): boolean {
  if (out.size >= REFERENCE_WALK_MAX_FILES) return true;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (out.size >= REFERENCE_WALK_MAX_FILES) return true;
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIR_NAMES.has(entry.name)) continue;
      if (walkInto(full, out)) return true;
    } else if (entry.isFile()) {
      out.add(full);
    }
  }
  return false;
}

function safeStat(path: string): import('node:fs').Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}
