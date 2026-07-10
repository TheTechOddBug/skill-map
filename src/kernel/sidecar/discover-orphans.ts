/**
 * Orphan sidecar discovery (Step 9.6.2).
 *
 * Walks the scan roots, finds every `*.sm` file, and returns the paths
 * whose anchoring node does NOT exist on disk. The anchor is whichever
 * node `sidecarPathFor` (parse.ts) maps to the sidecar: a `.md` node
 * swaps its extension (`X.md` -> `X.sm`), any other node appends
 * (`X.toml` -> `X.toml.sm`, e.g. Codex `.toml` sub-agents). The
 * `annotation-orphan` built-in rule consumes the result and emits one
 * warning per stranded sidecar.
 *
 * Implementation is intentionally a fresh walk (rather than piggy-
 * backing on the Provider walk): orphans are exactly the `.sm` files
 * whose node no longer exists, so we need an `.sm`-driven sweep.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface IOrphanSidecar {
  /** Absolute path to the orphan `.sm` file. */
  sidecarPath: string;
  /** Relative path (POSIX-separated) from the root that contained it. */
  relativePath: string;
  /**
   * Absolute path of the node the sidecar was expected to accompany. For a
   * genuine orphan the anchoring node is gone, so this reports the swap-form
   * (`<stem>.md`) candidate for the message; the unambiguous `sidecarPath`
   * above is what identifies the stranded file.
   */
  expectedMdPath: string;
}

/**
 * Find orphaned `.sm` files across the supplied roots. A `.sm` is an
 * orphan when neither of its anchor candidates exists: the append-form
 * node (the `.sm`-stripped stem, e.g. `X.toml`) nor the swap-form node
 * (`<stem>.md`). See `sidecarPathFor` for the forward mapping.
 *
 * Walks the filesystem directly. Symbolic links are skipped (mirrors
 * the Claude Provider's walk policy, audit M7). Errors reading a
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
// shape mirrors the Claude Provider's walker, same tradeoff applies.
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
    // A `.sm` anchors to whichever node `sidecarPathFor` (parse.ts) maps to
    // it, and that map has TWO branches: a `.md` node swaps its extension
    // (`X.md` -> `X.sm`), every other node appends (`X.toml` -> `X.toml.sm`,
    // the shape Codex `.toml` sub-agents carry). Invert BOTH: the `.sm`-
    // stripped stem is the append-form anchor, and `<stem>.md` is the swap-
    // form anchor. Present either way -> not orphan. Checking only `<stem>.md`
    // (the old behaviour) falsely stranded every non-`.md` node's sidecar.
    const stem = full.slice(0, -'.sm'.length);
    if (safeIsFile(stem) || safeIsFile(`${stem}.md`)) continue;
    out.push({ sidecarPath: full, relativePath: rel, expectedMdPath: `${stem}.md` });
  }
}

function safeIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
