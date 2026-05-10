/**
 * `link-counts` rule — currently a no-op placeholder.
 *
 * **Status (2026-05-10)**: the rule's view contributions (`linksOut` /
 * `linksIn`) were removed temporarily. `linksOut` summed every outgoing
 * link kind (mentions + references + invokes + supersedes) and ended up
 * duplicating the per-extractor counters living next to it
 * (`@ N` from at-directive, `📎 N` from markdown-link, `/ N` from slash).
 * `linksIn` was unique but kept here for symmetry — re-enable both
 * together if the chip surface is reinstated.
 *
 * The rule stays registered (no-op `evaluate`) so the kernel keeps its
 * place in the rules registry; rewiring the contributions is then a
 * single-file change.
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
  description: 'No-op placeholder — view contributions paused (see file header).',
  stability: 'stable',
  mode: 'deterministic',

  evaluate(_ctx: IRuleContext): Issue[] {
    return [];
  },
};
