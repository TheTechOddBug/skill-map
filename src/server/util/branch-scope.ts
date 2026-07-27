/**
 * Shared resolver for the map scope overrides both branch surfaces
 * consume (`GET /api/branch` and the MCP `get_branch` tool), per
 * `spec/cli-contract.md` §Map scope overrides. Single home for the
 * filtering / de-dup / root-inference / conflict rules so the two
 * surfaces cannot drift.
 *
 * Inference (normative): when the caller does not state the root
 * override, the root is treated as EXCLUDED iff at least one include
 * has no strict ancestor among the excludes. That keeps the historical
 * forms byte-for-byte: no params = whole corpus, a bare include list =
 * "only those subtrees" (the pre-deviation-model union), while an
 * include that only rescues part of an excluded subtree
 * (`exclude=vendor&path=vendor/keep`) leaves the root included. The
 * web UI always states `excludeRoot` explicitly; inference exists for
 * external callers.
 *
 * Conflict: the same path as BOTH an include and an exclude override is
 * rejected rather than ranked. A canonical override set never contains
 * it, and each surface maps the rejection to its own error shape (400
 * `bad-query` on the route, invalid params on MCP).
 */

import type { IBranchScope } from '../../kernel/ports/storage.js';

/** Raw override lists as they arrive on the wire, pre-validation. */
export interface IBranchScopeInput {
  include: readonly string[];
  exclude: readonly string[];
  /** The stated root override; `undefined` triggers the inference rule. */
  excludeRoot?: boolean | undefined;
}

export type TBranchScopeResult =
  | { ok: true; scope: IBranchScope }
  | { ok: false; conflictPath: string };

/** Filter empties, de-dupe, infer the root, detect conflicts. */
export function resolveBranchScope(input: IBranchScopeInput): TBranchScopeResult {
  const include = [...new Set(input.include.filter((p) => p.length > 0))];
  const exclude = [...new Set(input.exclude.filter((p) => p.length > 0))];

  const excludeSet = new Set(exclude);
  const conflictPath = include.find((p) => excludeSet.has(p));
  if (conflictPath !== undefined) return { ok: false, conflictPath };

  const rootExcluded = input.excludeRoot ?? inferRootExcluded(include, exclude);
  return { ok: true, scope: { include, exclude, rootExcluded } };
}

/**
 * The inference rule: an include with no strict ancestor among the
 * excludes only makes sense against an excluded root (it would be
 * redundant otherwise), so its presence implies the historical
 * "only these subtrees" intent. An empty include list infers an
 * included root (whole corpus / pure-subtractive case).
 */
function inferRootExcluded(
  include: readonly string[],
  exclude: readonly string[],
): boolean {
  return include.some((i) => !exclude.some((e) => i.startsWith(`${e}/`)));
}
