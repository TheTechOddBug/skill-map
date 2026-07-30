/**
 * One definition of "is this absolute path inside one of these roots".
 *
 * Lifted out of `kernel/scan/walk-content.ts` (2026-07-30) when a second
 * consumer appeared: `orchestrator/link-target-probe.ts`, which
 * `lstat`s a link target and must refuse one that escapes the scan
 * roots. Two private copies of a containment rule is how the rule drifts,
 * and a containment rule that drifts is a traversal bug waiting for the
 * next reader.
 *
 * Purely LEXICAL: it compares already-resolved absolute strings and does
 * no I/O. Callers that must also defeat symlinks resolve the realpath
 * first and pass THAT in (see `isScopedPathContained`, audit M1 / H4):
 * a lexically interior `docs/link/x.md` whose `link` component is a
 * symlink out of the tree is contained by this function and rejected by
 * the caller's realpath step. Keeping the two concerns separate is
 * deliberate, the cheap check runs on every path and the expensive one
 * only where an escape is actually possible.
 */

import { sep } from 'node:path';

/**
 * True when `candidate` is one of `roots` or sits underneath one.
 *
 * The trailing-separator guard is what stops `/tmp/project-evil` from
 * passing as inside `/tmp/project`: a bare `startsWith` would accept any
 * sibling whose name merely begins with the root's name.
 */
export function isPathContained(candidate: string, roots: readonly string[]): boolean {
  for (const root of roots) {
    if (candidate === root) return true;
    const prefix = root.endsWith(sep) ? root : root + sep;
    if (candidate.startsWith(prefix)) return true;
  }
  return false;
}
