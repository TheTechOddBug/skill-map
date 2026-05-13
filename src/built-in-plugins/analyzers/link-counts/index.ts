/**
 * `link-counts` rule, emits per-node "incoming" and "outgoing" link
 * counter chips on `card.footer.left`. Exclusive owner of the link
 * counter surface on the card: the per-extractor counters (slash,
 * at-directive, markdown-link) used to render their own chips here
 * but were removed in favour of these two aggregates, the per-kind
 * breakdown lives in the tooltip, so the footer stays uncluttered
 * while the detail remains one hover away.
 *
 * `linksIn` (`pi-sign-in`): every `Link` whose `target` matches the
 * node's path, grouped by `Link.kind`. The door-with-arrow glyph reads
 * as "things coming in" without competing visually with the arrow
 * markers that paint the graph's own edges.
 *
 * `linksOut` (`pi-sign-out`): every `Link` whose `source` matches
 * the node's path, same per-kind tooltip breakdown.
 *
 * Tooltip shape (PrimeNG `[pTooltip]` honours `\n`):
 *
 *   in
 *   invokes: 2
 *   mentions: 1
 *   references: 3
 *
 * `emitWhenEmpty: false` on both so silent nodes stay quiet.
 *
 * Why a Rule and not a built-in Hook? Hooks are reaction-only by
 * design (`spec/architecture.md` § A.11), they cannot mutate the
 * pipeline or alter outputs. Rules see the full graph post-merge in
 * `IAnalyzerContext.{nodes, links}` and are the natural home for cross-
 * graph computation. Why not the existing `core/external-url-counter`
 * extractor? That extractor counts URLs per-node-body during the walk;
 * link counts depend on the merged graph (`linksIn` needs every other
 * node's emissions), available only post-walk.
 */

import type { IAnalyzer, IAnalyzerContext } from '../../../kernel/extensions/index.js';
import type { Issue, LinkKind } from '../../../kernel/types.js';

const ID = 'link-counts';

export const linkCountsAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: 'core',
  kind: 'analyzer',
  version: '1.0.0',
  description: 'Counts incoming and outgoing links per node.',
  stability: 'stable',
  mode: 'deterministic',

  viewContributions: {
    linksIn: {
      slot: 'card.footer.left',
      icon: 'pi-sign-in',
      label: 'incoming links',
      emitWhenEmpty: false,
      priority: 10,
    },
    linksOut: {
      slot: 'card.footer.left',
      icon: 'pi-sign-out',
      label: 'outgoing links',
      emitWhenEmpty: false,
      priority: 20,
    },
  },

  evaluate(ctx: IAnalyzerContext): Issue[] {
    // Two passes over `ctx.links`: one tallying by `target` (incoming)
    // and one by `source` (outgoing). Each tally is split by `Link.kind`
    // so the chip tooltip can surface the per-kind breakdown
    // ("invokes: 2\nmentions: 1\nreferences: 3"). Cap the totals at 99
    // to match the `_counter` slot schema's conventional ceiling.
    const perTarget = new Map<string, Map<LinkKind, number>>();
    const perSource = new Map<string, Map<LinkKind, number>>();
    for (const link of ctx.links) {
      bump(perTarget, link.target, link.kind);
      bump(perSource, link.source, link.kind);
    }
    for (const node of ctx.nodes) {
      emitChip(ctx, node.path, 'linksIn', perTarget.get(node.path));
      emitChip(ctx, node.path, 'linksOut', perSource.get(node.path));
    }
    return [];
  },
};

function bump(map: Map<string, Map<LinkKind, number>>, key: string, kind: LinkKind): void {
  let byKind = map.get(key);
  if (!byKind) {
    byKind = new Map();
    map.set(key, byKind);
  }
  byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
}

function emitChip(
  ctx: IAnalyzerContext,
  nodePath: string,
  contributionId: 'linksIn' | 'linksOut',
  byKind: Map<LinkKind, number> | undefined,
): void {
  if (!byKind) return;
  let total = 0;
  for (const n of byKind.values()) total += n;
  if (total === 0) return;
  const capped = Math.min(total, 99);
  const direction = contributionId === 'linksIn' ? 'in' : 'out';
  ctx.emitContribution(nodePath, contributionId, {
    value: capped,
    tooltip: formatBreakdown(byKind, direction),
  });
}

/**
 * Render the per-kind breakdown as a multi-line tooltip. First line is
 * the direction label (`in` / `out`) so the chip is self-identifying
 * when only one of the two is visible; the rest is one line per kind
 * sorted alphabetically for a stable layout. PrimeNG's `[pTooltip]`
 * honours `\n` as a line break (`.p-tooltip-text` defaults to
 * `white-space: pre-line`), so the output flows naturally as:
 *
 *   in
 *   invokes: 2
 *   mentions: 1
 *   references: 3
 */
function formatBreakdown(byKind: Map<LinkKind, number>, direction: 'in' | 'out'): string {
  const lines = [...byKind.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([kind, n]) => `${kind}: ${n}`);
  return [direction, ...lines].join('\n');
}
