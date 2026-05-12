/**
 * Rename + orphan classification per `spec/db-schema.md` §Rename
 * detection. Pure: takes the prior `ScanResult` and the current node
 * set, mutates the supplied `issues` array in place, and returns the
 * `RenameOp[]` the persistence layer must apply inside the same tx as
 * the scan zone replace-all.
 */

import type { Issue, Node, ScanResult } from '../types.js';

/**
 * Confidence-tagged plan to repoint `state_*` references from one node
 * path to another. Emitted by the rename heuristic during `runScan` and
 * consumed by `persistScanResult` so the FK migration runs inside the
 * same transaction as the scan zone replace-all.
 */
export interface RenameOp {
  from: string;
  to: string;
  confidence: 'high' | 'medium';
}

/**
 * Step 1 of `detectRenamesAndOrphans` — pair every `deletedPath` with a
 * `newPath` whose body hash matches. Greedy by sorted order; on first
 * hit the deletion is claimed and we move on. Mutates the supplied
 * `claimedDeleted` / `claimedNew` sets in place.
 */
function findHighConfidenceRenames(opts: {
  deletedPaths: string[];
  newPaths: string[];
  priorByPath: Map<string, Node>;
  currentByPath: Map<string, Node>;
  claimedDeleted: Set<string>;
  claimedNew: Set<string>;
}): RenameOp[] {
  const ops: RenameOp[] = [];
  for (const fromPath of opts.deletedPaths) {
    if (opts.claimedDeleted.has(fromPath)) continue;
    const fromNode = opts.priorByPath.get(fromPath)!;
    for (const toPath of opts.newPaths) {
      if (opts.claimedNew.has(toPath)) continue;
      const toNode = opts.currentByPath.get(toPath)!;
      if (toNode.bodyHash === fromNode.bodyHash) {
        ops.push({ from: fromPath, to: toPath, confidence: 'high' });
        opts.claimedDeleted.add(fromPath);
        opts.claimedNew.add(toPath);
        break;
      }
    }
  }
  return ops;
}

/**
 * Step 2 of `detectRenamesAndOrphans` — bucket every still-unclaimed
 * `newPath` by the set of still-unclaimed `deletedPath`s that share its
 * `frontmatterHash`. The map drives both the medium-confidence claim
 * pass and the ambiguous-flag pass.
 */
function buildFrontmatterRenameCandidates(opts: {
  deletedPaths: string[];
  newPaths: string[];
  priorByPath: Map<string, Node>;
  currentByPath: Map<string, Node>;
  claimedDeleted: Set<string>;
  claimedNew: Set<string>;
}): Map<string, string[]> {
  const candidatesByNew = new Map<string, string[]>();
  for (const toPath of opts.newPaths) {
    if (opts.claimedNew.has(toPath)) continue;
    const toNode = opts.currentByPath.get(toPath)!;
    const matches: string[] = [];
    for (const fromPath of opts.deletedPaths) {
      if (opts.claimedDeleted.has(fromPath)) continue;
      const fromNode = opts.priorByPath.get(fromPath)!;
      if (toNode.frontmatterHash === fromNode.frontmatterHash) {
        matches.push(fromPath);
      }
    }
    if (matches.length > 0) candidatesByNew.set(toPath, matches);
  }
  return candidatesByNew;
}

/**
 * Step 3a of `detectRenamesAndOrphans` — first pass over the candidate
 * map: a `newPath` whose surviving candidate set is a singleton wins
 * the deletion, with `auto-rename-medium`. Greedy by sorted `newPath`
 * order so a deletion claimed by an earlier singleton drops out of
 * later candidate filters. Mutates `claimedDeleted` / `claimedNew` /
 * `issues` in place.
 */
function claimSingletonRenames(opts: {
  newPaths: string[];
  candidatesByNew: Map<string, string[]>;
  claimedDeleted: Set<string>;
  claimedNew: Set<string>;
  issues: Issue[];
}): RenameOp[] {
  const ops: RenameOp[] = [];
  for (const toPath of opts.newPaths) {
    if (opts.claimedNew.has(toPath)) continue;
    const candidates = opts.candidatesByNew.get(toPath);
    if (!candidates) continue;
    const remaining = candidates.filter((p) => !opts.claimedDeleted.has(p));
    if (remaining.length === 1) {
      const fromPath = remaining[0]!;
      ops.push({ from: fromPath, to: toPath, confidence: 'medium' });
      opts.issues.push({
        analyzerId: 'auto-rename-medium',
        severity: 'warn',
        nodeIds: [toPath],
        message: `Auto-rename (medium confidence): ${fromPath} → ${toPath}`,
        data: { from: fromPath, to: toPath, confidence: 'medium' },
      });
      opts.claimedDeleted.add(fromPath);
      opts.claimedNew.add(toPath);
    }
  }
  return ops;
}

/**
 * Step 3b of `detectRenamesAndOrphans` — any `newPath` left with more
 * than one viable candidate after singletons settled is ambiguous.
 * Emits one `auto-rename-ambiguous` per `newPath`. Candidates are NOT
 * claimed; they fall through to the orphan step so the user can
 * reconcile manually with `sm orphans undo-rename`.
 */
function flagAmbiguousRenames(opts: {
  newPaths: string[];
  candidatesByNew: Map<string, string[]>;
  claimedDeleted: Set<string>;
  claimedNew: Set<string>;
  issues: Issue[];
}): void {
  for (const toPath of opts.newPaths) {
    if (opts.claimedNew.has(toPath)) continue;
    const candidates = opts.candidatesByNew.get(toPath);
    if (!candidates) continue;
    const remaining = candidates.filter((p) => !opts.claimedDeleted.has(p));
    if (remaining.length > 1) {
      opts.issues.push({
        analyzerId: 'auto-rename-ambiguous',
        severity: 'warn',
        nodeIds: [toPath],
        message:
          `Auto-rename ambiguous: ${toPath} matches ${remaining.length} ` +
          `prior frontmatters; pick one with \`sm orphans undo-rename ` +
          `${toPath} --from <old.path>\`.`,
        data: { to: toPath, candidates: remaining },
      });
    }
  }
}

/**
 * Step 4 of `detectRenamesAndOrphans` — every deletion left unclaimed
 * after steps 1-3 yields one `orphan` issue (info severity).
 */
function flagOrphans(opts: {
  deletedPaths: string[];
  claimedDeleted: Set<string>;
  issues: Issue[];
}): void {
  for (const fromPath of opts.deletedPaths) {
    if (opts.claimedDeleted.has(fromPath)) continue;
    opts.issues.push({
      analyzerId: 'orphan',
      severity: 'info',
      nodeIds: [fromPath],
      message: `Orphan history: ${fromPath} was deleted; no rename match found.`,
      data: { path: fromPath },
    });
  }
}

/**
 * Pure rename / orphan classification per `spec/db-schema.md` §Rename
 * detection. Mutates `issues` in place — caller passes the in-progress
 * issue list; returns the `RenameOp[]` for the persistence layer to
 * apply inside its tx.
 *
 * Pipeline (1-to-1: a `newPath` claimed by one stage cannot be reused
 * by another):
 *
 *   1. **High-confidence**: pair each `deletedPath` with a `newPath`
 *      that has the same `bodyHash`. No issue, no prompt.
 *   2. **Medium-confidence (1:1)**: of the remaining deletions, pair
 *      each with the *unique* unclaimed `newPath` that shares its
 *      `frontmatterHash`. Emits `auto-rename-medium` (severity warn)
 *      with `data: { from, to, confidence: 'medium' }`.
 *   3. **Ambiguous (N:1)**: when a single `newPath` has more than one
 *      remaining frontmatter-matching candidate, emit ONE
 *      `auto-rename-ambiguous` issue per `newPath`, listing all
 *      candidates in `data.candidates`. NO migration.
 *   4. **Orphan**: every `deletedPath` left after steps 1-3 yields one
 *      `orphan` issue (severity info) with `data: { path: <deletedPath> }`.
 *
 * Determinism: `deletedPaths` and `newPaths` are iterated in lex-asc
 * order so the same input always produces the same matches —
 * required for reproducible tests and conformance fixtures (the spec
 * does not prescribe an order, but stability is the obvious contract).
 */
export function detectRenamesAndOrphans(
  prior: ScanResult,
  current: Node[],
  issues: Issue[],
): RenameOp[] {
  const priorByPath = new Map<string, Node>();
  for (const n of prior.nodes) priorByPath.set(n.path, n);
  const currentByPath = new Map<string, Node>();
  for (const n of current) currentByPath.set(n.path, n);

  // Sets / sorted lists so iteration is deterministic.
  const deletedPaths = [...priorByPath.keys()]
    .filter((p) => !currentByPath.has(p))
    .sort();
  const newPaths = [...currentByPath.keys()]
    .filter((p) => !priorByPath.has(p))
    .sort();

  const claimedDeleted = new Set<string>();
  const claimedNew = new Set<string>();
  const ops: RenameOp[] = [];

  // Step 1 — high confidence (body hash match).
  ops.push(...findHighConfidenceRenames({
    deletedPaths, newPaths, priorByPath, currentByPath, claimedDeleted, claimedNew,
  }));

  // Step 2 — bucket every `newPath` by the deletions that share its
  // frontmatterHash, used by both medium-confidence and ambiguous passes.
  const candidatesByNew = buildFrontmatterRenameCandidates({
    deletedPaths, newPaths, priorByPath, currentByPath, claimedDeleted, claimedNew,
  });

  // Step 3a — singleton candidates → medium-confidence renames.
  ops.push(...claimSingletonRenames({
    newPaths, candidatesByNew, claimedDeleted, claimedNew, issues,
  }));

  // Step 3b — multi-candidate `newPath`s left after singletons settled.
  flagAmbiguousRenames({ newPaths, candidatesByNew, claimedDeleted, claimedNew, issues });

  // Step 4 — every unclaimed deletion is an orphan.
  flagOrphans({ deletedPaths, claimedDeleted, issues });

  return ops;
}
