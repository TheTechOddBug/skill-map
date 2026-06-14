/**
 * `link-counter` rule, emits per-node "incoming" and "outgoing" link
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

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue, LinkKind } from '../../../../kernel/types.js';
import type { IViewContribution } from '../../../../kernel/types/view-catalog.js';
import { isSelfLoop } from '../../../../kernel/util/link-lines.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'link-counter';

const linksIn = {
  slot: 'card.footer.left',
  icon: 'pi-download',
  label: 'incoming links',
  emitWhenEmpty: false,
  priority: 10,
} satisfies IViewContribution;

const linksOut = {
  slot: 'card.footer.left',
  icon: 'pi-upload',
  label: 'outgoing links',
  emitWhenEmpty: false,
  priority: 20,
} satisfies IViewContribution;

export const linkCounterAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description: 'Counts incoming and outgoing links per node.',
  mode: 'deterministic',

  ui: { linksIn, linksOut },

  evaluate(ctx: IAnalyzerContext): Issue[] {
    // Two passes over `ctx.links`: one tallying by resolved target
    // (incoming) and one by `source` (outgoing). Each tally is split by
    // `Link.kind` so the chip tooltip can surface the per-kind breakdown
    // ("invokes: 2\nmentions: 1\nreferences: 3"). Cap the totals at 99
    // to match the `_counter` slot schema's conventional ceiling.
    //
    // Count by `link.resolvedTarget`, the authoritative path the post-
    // walk lift transform (`lift-resolved-link-confidence.ts`) stamps on
    // every edge that resolves to a real node. The lift resolution is
    // kind/lens-aware, so a `/stale-skill` invocation lands on
    // `.claude/skills/stale-skill/SKILL.md` via that node's `dirname`
    // identifier; path-style links lift left untouched carry no
    // `resolvedTarget`, so fall back to `link.target`. Reading the lift's
    // result instead of recomputing a name lookup keeps the footer chip
    // in lock-step with the BFF incoming list and rename tooling, which
    // navigate by the same field.
    const perTarget = new Map<string, Map<LinkKind, number>>();
    const perSource = new Map<string, Map<LinkKind, number>>();
    for (const link of ctx.links) {
      // Skip self-loops: a node that links back to itself (directly via
      // `link.target` or transitively via the resolved trigger) would
      // bump both `linksIn` and `linksOut` of the same node, inflating
      // the footer chips and disagreeing with the `LinkedNodesPanel`
      // sidecar (which filters self-loops via the same `isSelfLoop`). The
      // self-reference is still surfaced as a warning by the
      // `core/link-self-loop` analyzer, so dropping it here only removes
      // the misleading count, not the signal that the loop exists.
      if (isSelfLoop(link)) continue;
      const target = link.resolvedTarget ?? link.target;
      bump(perTarget, target, link.kind);
      bump(perSource, link.source, link.kind);
    }
    for (const node of ctx.nodes) {
      emitChip(ctx, node.path, linksIn, 'in', perTarget.get(node.path));
      emitChip(ctx, node.path, linksOut, 'out', perSource.get(node.path));
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
  ref: typeof linksIn | typeof linksOut,
  direction: 'in' | 'out',
  byKind: Map<LinkKind, number> | undefined,
): void {
  if (!byKind) return;
  let total = 0;
  for (const n of byKind.values()) total += n;
  if (total === 0) return;
  const capped = Math.min(total, 99);
  ctx.emitContribution(nodePath, ref, {
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
