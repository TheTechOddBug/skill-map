/**
 * `link-counts` rule, emits per-node "incoming" and "outgoing" link
 * counter chips on `card.footer.left`. Exclusive owner of the link
 * counter surface on the card: the per-extractor counters (slash,
 * at-directive, markdown-link) used to render their own chips here
 * but were removed in favour of these two aggregates, the per-kind
 * breakdown lives in the tooltip, so the footer stays uncluttered
 * while the detail remains one hover away.
 *
 * `linksIn` (`pi-download`): every `Link` whose `target` matches the
 * node's path, grouped by `Link.kind`. The tray-with-vertical-arrow
 * glyph reads as "things landing on this node" without competing
 * visually with the arrow markers Foblex paints on the graph's own
 * edges (those are pure arrows on a line; this one is contained over
 * a baseline).
 *
 * `linksOut` (`pi-upload`): every `Link` whose `source` matches the
 * node's path, same per-kind tooltip breakdown.
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

import type { IAnalyzer, IAnalyzerContext } from '../../../../kernel/extensions/index.js';
import type { Issue, LinkKind } from '../../../../kernel/types.js';
import { buildNameIndex, resolveLinkTargetToPath } from '../../../../kernel/util/trigger-resolve.js';

const ID = 'link-counts';

export const linkCountsAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: 'core',
  kind: 'analyzer',
  version: '1.0.0',
  description: 'Counts incoming and outgoing links per node.',
  mode: 'deterministic',

  ui: {
    linksIn: {
      slot: 'card.footer.left',
      icon: 'pi-download',
      label: 'incoming links',
      emitWhenEmpty: false,
      priority: 10,
    },
    linksOut: {
      slot: 'card.footer.left',
      icon: 'pi-upload',
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
    //
    // Trigger-style targets (`/<cmd>` from the slash extractor,
    // `@<handle>` from at-directive) arrive as bare names; resolve
    // them to the real node path via the shared `trigger-resolve`
    // helper before counting so a `/stale-skill` invocation lands
    // on `.claude/skills/stale-skill/SKILL.md`'s `linksIn` chip,
    // matching what the graph view renders. Path-style targets
    // (markdown-link, annotations) pass through untouched.
    const nameIndex = buildNameIndex(ctx.nodes);
    const perTarget = new Map<string, Map<LinkKind, number>>();
    const perSource = new Map<string, Map<LinkKind, number>>();
    for (const link of ctx.links) {
      const resolvedTarget = resolveLinkTargetToPath(link, nameIndex);
      // Skip self-loops: a node that links back to itself (directly via
      // `link.target` or transitively via the resolved trigger) used to
      // bump both `linksIn` and `linksOut` of the same node, inflating
      // the footer chips and disagreeing with the `LinkedNodesPanel`
      // sidecar (which already filters self-loops out of its outgoing
      // / incoming lists via `isSelfLoop`). The self-reference is still
      // surfaced as a warning by the `core/self-loop` analyzer, so
      // dropping it here only removes the misleading count, not the
      // signal that the loop exists.
      if (link.source === link.target || link.source === resolvedTarget) continue;
      bump(perTarget, resolvedTarget, link.kind);
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
