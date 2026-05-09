/**
 * `core/unknown-contract` rule — Phase 7 / View contribution system
 * soft-warning. Walks the runtime catalog of plugin-contributed view
 * contributions (`IRuleContext.viewContributions`) and emits a `warn`
 * Issue for any contribution that references a contract not in the
 * UI's known closed catalog.
 *
 * AJV at manifest load already rejects unknown contracts as
 * `invalid-manifest` (the plugin never reaches `enabled` status).
 * This rule covers the soft-warning path that survives across catalog
 * version bumps:
 *   - Catalog v1 ships a contract.
 *   - Catalog v2 deprecates / renames it.
 *   - A plugin that was authored against v1 still loads (its
 *     manifest's `catalogCompat` may be permissive enough to satisfy
 *     v2 syntactically), but emits via a contract id the UI no longer
 *     renders.
 *   - The rule surfaces this as `warn` so the user knows to run
 *     `sm plugins upgrade <id>` (Phase 5).
 *
 * Mirror of `core/unknown-field` for the contracts surface; same
 * `warn` severity (advisory, never blocking).
 */

import type { IRule, IRuleContext } from '../../../kernel/extensions/index.js';
import type { Issue } from '../../../kernel/types.js';

const ID = 'unknown-contract';

/**
 * Closed catalog of contracts the kernel currently ships. Mirror of
 * `view-contracts.schema.json#/$defs/ContractName`. When the catalog
 * evolves, this set evolves in lock-step — the rule then surfaces
 * older entries that disappeared.
 */
const KNOWN_CONTRACTS = new Set<string>([
  'node-counter',
  'node-tag',
  'node-breakdown',
  'node-records',
  'node-tree',
  'node-key-values',
  'node-link-list',
  'node-markdown',
  'node-alert',
  'scope-stat',
]);

export const unknownContractRule: IRule = {
  id: ID,
  pluginId: 'core',
  kind: 'rule',
  version: '1.0.0',
  description:
    'Warns on plugin view contributions that reference a contract not in the current closed catalog.',
  stability: 'stable',
  mode: 'deterministic',

  evaluate(ctx: IRuleContext): Issue[] {
    const contributions = ctx.viewContributions;
    if (!contributions || contributions.length === 0) return [];
    const issues: Issue[] = [];
    for (const c of contributions) {
      if (KNOWN_CONTRACTS.has(c.contract)) continue;
      const qualified = `${c.pluginId}/${c.extensionId}/${c.contributionId}`;
      issues.push({
        ruleId: ID,
        severity: 'warn',
        nodeIds: [],
        message: `Plugin ${qualified} declares unknown contract '${c.contract}'. Run \`sm plugins upgrade ${c.pluginId}\` or update the plugin to a contract in the current catalog (\`sm plugins contracts list\`).`,
        data: {
          pluginId: c.pluginId,
          extensionId: c.extensionId,
          contributionId: c.contributionId,
          contract: c.contract,
        },
      });
    }
    return issues;
  },
};
