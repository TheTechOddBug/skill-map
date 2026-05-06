/**
 * Orphan sidecar discovery (Step 9.6.2).
 *
 * Walks the scan roots, finds every `*.sm` file, and returns the
 * paths whose accompanying `*.md` does NOT exist on disk. The
 * `annotation-orphan` built-in rule consumes the result and emits one
 * warning per stranded sidecar.
 *
 * Implementation is intentionally a fresh walk (rather than piggy-
 * backing on the Provider walk) — the Provider only yields `.md`
 * files; orphans are exactly the `.sm` files that have no corresponding
 * `.md` to anchor them, so we need an `.sm`-driven sweep.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface IOrphanSidecar {
  /** Absolute path to the orphan `.sm` file. */
  sidecarPath: string;
  /** Relative path (POSIX-separated) from the root that contained it. */
  relativePath: string;
  /** Absolute path of the `.md` file the sidecar was expected to accompany. */
  expectedMdPath: string;
}

/**
 * Find orphaned `.sm` files across the supplied roots. A `.sm` is an
 * orphan when its sibling `<basename>.md` does not exist.
 *
 * Walks the filesystem directly. Symbolic links are skipped (mirrors
 * the Claude Provider's walk policy — audit M7). Errors reading a
 * directory are swallowed silently; the walk degrades to "no orphans
 * found in that subtree".
 */
export function discoverOrphanSidecars(
  roots: readonly string[],
  shouldSkip?: (relativePath: string) => boolean,
): IOrphanSidecar[] {
  const out: IOrphanSidecar[] = [];
  for (const root of roots) {
    walk(root, root, shouldSkip ?? (() => false), out);
  }
  return out;
}

// Recursive directory walker with five guards (try/catch, skip filter,
// symlink check, isDirectory recursion, isFile + extension check). The
// shape mirrors the Claude Provider's walker — same tradeoff applies.
// eslint-disable-next-line complexity
function walk(
  root: string,
  current: string,
  shouldSkip: (relativePath: string) => boolean,
  out: IOrphanSidecar[],
): void {
  let entries;
  try {
    entries = readdirSync(current, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(current, entry.name);
    const rel = relative(root, full).split(sep).join('/');
    if (shouldSkip(rel)) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walk(root, full, shouldSkip, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.sm')) continue;
    const expectedMd = `${full.slice(0, -'.sm'.length)}.md`;
    if (existsSync(expectedMd) && safeIsFile(expectedMd)) continue;
    out.push({ sidecarPath: full, relativePath: rel, expectedMdPath: expectedMd });
  }
}

function safeIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
