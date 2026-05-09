/**
 * `link-counts` rule. Emits per-node `node-counter` view contributions
 * for outbound and inbound link counts derived from the merged graph.
 *
 *   `linksOut` → number of links whose `source === node.path`
 *   `linksIn`  → number of links whose `target === node.path`
 *
 * Skip emission when count is 0 to avoid empty panels in the inspector
 * (a "Links out: 0" chip is noise). The `emitWhenEmpty: false` flag on
 * the manifest is a UI hint for empty-payload skipping; we drop a step
 * earlier (don't even emit) since `{ value: 0 }` is structurally
 * non-empty per the contract schema.
 *
 * Returns `[]` — no issues. The rule's only side effect is the per-node
 * contribution emission. The data also lives on `node.linksOutCount` /
 * `node.linksInCount` as kernel-denormalised fields, but those are SQL
 * indexing surface; this rule projects them into the view contribution
 * system so slot-aware UI surfaces (graph cards, inspector chips)
 * render the counts uniformly with any plugin contribution.
 *
 * Why a Rule and not a built-in Hook? Hooks are reaction-only by
 * design (`spec/architecture.md` § A.11) — they cannot mutate the
 * pipeline or alter outputs. Rules see the full graph post-merge in
 * `IRuleContext.{nodes, links}` and are the natural home for cross-
 * graph computation. Why not the existing `core/external-url-counter`
 * extractor? That extractor counts URLs per-node-body during the walk;
 * link counts depend on the merged graph (especially `linksIn`, which
 * needs every other node's emissions), available only post-walk.
 */

import type { IRule, IRuleContext } from '../../../kernel/extensions/index.js';
import type { Issue } from '../../../kernel/types.js';

const ID = 'link-counts';

export const linkCountsRule: IRule = {
  id: ID,
  pluginId: 'core',
  kind: 'rule',
  version: '1.0.0',
  description:
    'Emits per-node node-counter view contributions for outbound and inbound link counts.',
  stability: 'stable',
  mode: 'deterministic',
  viewContributions: {
    linksOut: {
      contract: 'node-counter',
      label: 'Links out',
      emitWhenEmpty: false,
    },
    linksIn: {
      contract: 'node-counter',
      label: 'Links in',
      emitWhenEmpty: false,
    },
  },

  evaluate(ctx: IRuleContext): Issue[] {
    const { outBy, inBy } = countLinks(ctx.links);
    for (const node of ctx.nodes) {
      emitCountIfNonZero(ctx, node.path, 'linksOut', outBy.get(node.path));
      emitCountIfNonZero(ctx, node.path, 'linksIn', inBy.get(node.path));
    }
    return [];
  },
};

/** Build per-node out / in count maps in a single O(L) pass. */
function countLinks(links: ReadonlyArray<{ source: string; target: string }>): {
  outBy: Map<string, number>;
  inBy: Map<string, number>;
} {
  const outBy = new Map<string, number>();
  const inBy = new Map<string, number>();
  for (const link of links) {
    outBy.set(link.source, (outBy.get(link.source) ?? 0) + 1);
    inBy.set(link.target, (inBy.get(link.target) ?? 0) + 1);
  }
  return { outBy, inBy };
}

/** Emit a node-counter contribution only when the count is positive. */
function emitCountIfNonZero(
  ctx: IRuleContext,
  nodePath: string,
  contributionId: 'linksOut' | 'linksIn',
  count: number | undefined,
): void {
  if (count === undefined || count === 0) return;
  ctx.emitContribution(nodePath, contributionId, { value: count });
}
