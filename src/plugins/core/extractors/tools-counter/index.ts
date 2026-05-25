/**
 * Tools count extractor. Reads `frontmatter.tools` on agent-kind nodes
 * (Claude Code agents + Codex sub-agents, both providers declare the
 * field as `string[]`) and surfaces the count as a `card.footer.left`
 * counter chip with a wrench icon.
 *
 * Per-node, frontmatter-scope, no link emissions, the only output is
 * a single view contribution. Kept narrow to agents only via
 * `applicableKinds: ['agent']`: skills and commands declare their tool
 * surface under `allowed-tools` (different shape, different semantics),
 * and would deserve their own extractor if the chip is ever wanted
 * there too.
 *
 * Replaces the hardcoded wrench + count block that used to live in
 * `node-card.html` (legacy `toolsCount()` computed in `node-card.ts`).
 * Behavior parity: same icon (`pi-wrench`), same count source for the
 * agent path. The breakdown tooltip
 * (`N allowlist + M pre-approved`) is dropped because pre-approved
 * tools (`allowed-tools` on skills/commands) never applied to agents;
 * tooltip now lists the actual tool names instead.
 */

import type { IExtractor, IExtractorContext } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'tools-counter';

/**
 * Tooltip cap. View-slot payloads enforce a 256-char `tooltip` limit
 * (`spec/schemas/view-slots.schema.json#/$defs/payloads/_counter`). We
 * truncate one char shy of that so an appended ellipsis still fits.
 */
const TOOLTIP_MAX = 255;

export const toolsCounterExtractor: IExtractor = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'extractor',
  version: '1.0.0',
  description:
    'Counts the tools an agent declares in its frontmatter and shows the count on the agent card.',
  scope: 'frontmatter',
  precondition: { kind: ['claude/agent'] },

  ui: {
    count: {
      slot: 'card.footer.left',
      icon: 'pi-wrench',
      label: 'tools',
      emitWhenEmpty: false,
      priority: 40,
    },
  },

  extract(ctx: IExtractorContext): void {
    const raw = ctx.frontmatter['tools'];
    if (!Array.isArray(raw)) return;

    const names: string[] = [];
    for (const t of raw) {
      if (typeof t === 'string' && t.length > 0) names.push(t);
    }
    if (names.length === 0) return;

    ctx.emitContribution('count', {
      value: names.length,
      tooltip: buildTooltip(names),
    });
  },
};

function buildTooltip(names: readonly string[]): string {
  const joined = names.join(' · ');
  if (joined.length <= TOOLTIP_MAX) return joined;
  return `${joined.slice(0, TOOLTIP_MAX - 1)}…`;
}
