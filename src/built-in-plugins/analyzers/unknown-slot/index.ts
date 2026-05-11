/**
 * `core/unknown-slot` rule — Phase 7 / View contribution system
 * soft-warning. Walks the runtime catalog of plugin-contributed view
 * contributions (`IAnalyzerContext.viewContributions`) and emits a `warn`
 * Issue for any contribution that references a slot not in the
 * UI's known closed catalog.
 *
 * AJV at manifest load already rejects unknown slots as
 * `invalid-manifest` (the plugin never reaches `enabled` status).
 * This rule covers the soft-warning path that survives across catalog
 * version bumps:
 *   - Catalog v1 ships a slot.
 *   - Catalog v2 deprecates / renames it.
 *   - A plugin that was authored against v1 still loads (its
 *     manifest's `catalogCompat` may be permissive enough to satisfy
 *     v2 syntactically), but emits via a slot id the UI no longer
 *     renders.
 *   - The rule surfaces this as `warn` so the user knows to run
 *     `sm plugins upgrade <id>` (Phase 5).
 *
 * Mirror of `core/unknown-field` for the slots surface; same
 * `warn` severity (advisory, never blocking).
 */

import type { IAnalyzer, IAnalyzerContext } from '../../../kernel/extensions/index.js';
import type { Issue } from '../../../kernel/types.js';

const ID = 'unknown-slot';

/**
 * Closed catalog of slots the kernel currently ships. Mirror of
 * `view-slots.schema.json#/$defs/SlotName`. When the catalog evolves,
 * this set evolves in lock-step — the rule then surfaces older entries
 * that disappeared.
 */
const KNOWN_SLOTS = new Set<string>([
  'card.title.right',
  'card.subtitle.left',
  'card.footer.left',
  'card.footer.right',
  'graph.node.alert',
  'inspector.header.badge.counter',
  'inspector.header.badge.tag',
  'inspector.body.panel.breakdown',
  'inspector.body.panel.records',
  'inspector.body.panel.tree',
  'inspector.body.panel.key-values',
  'inspector.body.panel.link-list',
  'inspector.body.panel.markdown',
  'topbar.nav.start',
]);

export const unknownSlotAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: 'core',
  kind: 'analyzer',
  version: '1.0.0',
  description:
    'Warns when a plugin tries to render in a UI position that does not exist (typo or removed in a newer skill-map version).',
  stability: 'stable',
  mode: 'deterministic',

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const contributions = ctx.viewContributions;
    if (!contributions || contributions.length === 0) return [];
    const issues: Issue[] = [];
    for (const c of contributions) {
      if (KNOWN_SLOTS.has(c.slot)) continue;
      const qualified = `${c.pluginId}/${c.extensionId}/${c.contributionId}`;
      issues.push({
        analyzerId: ID,
        severity: 'warn',
        nodeIds: [],
        message: `Plugin ${qualified} declares unknown slot '${c.slot}'. Run \`sm plugins upgrade ${c.pluginId}\` or update the plugin to a slot in the current catalog (\`sm plugins slots list\`).`,
        data: {
          pluginId: c.pluginId,
          extensionId: c.extensionId,
          contributionId: c.contributionId,
          slot: c.slot,
        },
      });
    }
    return issues;
  },
};
