/**
 * Tools count extractor. Reads `frontmatter.tools` on Claude Code
 * agent nodes (declared as `string[]`) and surfaces the count as a
 * `card.footer.left` counter chip with a wrench icon.
 *
 * Per-node, frontmatter-scope, no link emissions, the only output is
 * a single view contribution. Bundled in the `claude` plugin because
 * its precondition is `claude/agent` only: skills and commands declare
 * their tool surface under `allowed-tools` (different shape, different
 * semantics) and would deserve their own extractor if the chip is ever
 * wanted there; Codex sub-agents declare a similar `tools: string[]`
 * in their TOML, but that is deliberately out of scope today and would
 * belong to an `openai`-bundled extractor, not this one.
 *
 * Replaces the hardcoded wrench + count block that used to live in
 * `node-card.html` (legacy `toolsCount()` computed in `node-card.ts`).
 * Behavior parity: same icon (`pi-wrench`), same count source for the
 * agent path. The breakdown tooltip
 * (`N allowlist + M pre-approved`) is dropped because pre-approved
 * tools (`allowed-tools` on skills/commands) never applied to agents;
 * tooltip now lists the actual tool names instead.
 */

import type { IBuiltInManifest, IExtractor, IExtractorContext } from '../../../../kernel/extensions/index.js';
import type { IViewContribution } from '../../../../kernel/types/view-catalog.js';
import { CLAUDE_PLUGIN_ID } from '../../../ids.js';

const ID = 'tools-counter';

const count = {
  slot: 'card.footer.left',
  icon: 'pi-wrench',
  label: 'tools',
  emitWhenEmpty: false,
  priority: 40,
} satisfies IViewContribution;

/**
 * Tooltip cap. View-slot payloads enforce a 256-char `tooltip` limit
 * (`spec/schemas/view-slots.schema.json#/$defs/payloads/_counter`). We
 * truncate one char shy of that so an appended ellipsis still fits.
 */
const TOOLTIP_MAX = 255;

export const toolsCounterExtractor: IBuiltInManifest<IExtractor> = {
  id: ID,
  pluginId: CLAUDE_PLUGIN_ID,
  kind: 'extractor',
  description:
    'Counts the tools an agent declares in its frontmatter and shows the count on the agent card. Example: an agent with `tools: [Bash, Read, Grep]` shows a count of 3.',
  scope: 'frontmatter',
  precondition: { kind: ['claude/agent'] },

  ui: { count },

  extract(ctx: IExtractorContext): void {
    const raw = ctx.frontmatter['tools'];
    if (!Array.isArray(raw)) return;

    const names: string[] = [];
    for (const t of raw) {
      if (typeof t === 'string' && t.length > 0) names.push(t);
    }
    if (names.length === 0) return;

    ctx.emitContribution(count, {
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
