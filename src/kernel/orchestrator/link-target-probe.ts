/**
 * On-disk existence probe for link targets, the third clause of the
 * "genuinely broken" definition (`spec/architecture.md` §Provider ·
 * resolution rules, rule 3): a path-style link whose target exists on
 * disk under any scan root points at SOMETHING, so it is not broken,
 * even when the file is not an indexed node (a `.json` schema, an
 * image, an ignored / oversized / over-ceiling `.md`).
 *
 * Shape: a factory returning a memoized `(target) => boolean`. The
 * probe is deliberately lazy, `collectBrokenLinks` consults it only
 * for links that already failed both in-graph lookups (path index +
 * name index), so the syscall count is bounded by the number of
 * candidate-broken path-style links (typically tens), not by tree
 * size. This is why the existence check is NOT a seen-files side set
 * collected during the walk: incremental watcher batches walk only the
 * changed paths (no `readdir`), so a walk-time set would go stale,
 * while a live `lstat` at analysis time is always exact.
 *
 * `lstatSync`, not `statSync` / `existsSync`: the probe observes the
 * directory ENTRY and never dereferences a symlink, consistent with
 * the realpath-containment stance (audit M1). A committed escaping
 * link (`x.json -> ~/secret`) counts as existing without skill-map
 * ever following it; a dangling symlink also counts (the entry the
 * author referenced is there).
 *
 * Targets arrive in the link convention: POSIX paths relative to the
 * scan root that yielded the source node (extractors resolve against
 * `dirname(node.path)`). The caller cannot know WHICH root a given
 * link came from, so the probe tries every root; a cross-root false
 * hit mirrors the ambiguity the in-graph `byPath` index already has
 * (node paths from all roots share one namespace). Memoization is
 * per-instance: the orchestrator builds a fresh probe per scan pass,
 * so a watcher batch never sees a stale verdict from a previous pass.
 */

import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';

import { isPathContained } from '../util/path-containment.js';

/** Existence probe: `true` when the target names an on-disk entry under any scan root. */
export type TLinkTargetProbe = (target: string) => boolean;

/**
 * Build the memoized probe for one scan pass. `cwd` anchors relative
 * roots (kernel-boundary rule: the kernel never reads `process.cwd()`
 * itself, the driving adapter supplies it via `RunScanOptions.cwd`);
 * absolute roots pass through `resolve` unchanged.
 */
export function makeLinkTargetProbe(cwd: string, roots: readonly string[]): TLinkTargetProbe {
  const verdicts = new Map<string, boolean>();
  const rootAbs = roots.map((root) => resolve(cwd, root));
  return (target: string): boolean => {
    const cached = verdicts.get(target);
    if (cached !== undefined) return cached;
    const exists = rootAbs.some((root) => {
      const absPath = resolve(root, target);
      // Containment BEFORE the stat, not after (audit posture, 2026-07-30).
      //
      // `target` comes from a link a scanned file authored, so under
      // clone-and-scan it is attacker-controlled text. A `../`-laden
      // target resolves outside the scan root, and statting it would
      // turn the scan into an existence oracle for the operator's
      // filesystem: the verdict decides whether the link is reported
      // `reference-broken`, so the answer is readable straight out of
      // `sm check --json`. Only `.md`-suffixed paths are reachable
      // (the token grammar requires it), which narrows the oracle
      // without closing it.
      //
      // Refusing costs nothing real: every node lives inside a scan
      // root, so an escaping target could never have resolved to one
      // anyway. This turns a pointless read into no read.
      if (!isPathContained(absPath, [root])) return false;
      return entryExists(absPath);
    });
    verdicts.set(target, exists);
    return exists;
  };
}

function entryExists(absPath: string): boolean {
  try {
    lstatSync(absPath);
    return true;
  } catch {
    return false;
  }
}
