/**
 * `core/contribution-orphan` rule — Phase 7 / View contribution
 * system soft-warning. The kernel's replace-all on `scan_contributions`
 * already drops obsolete rows when a node disappears between scans,
 * so this rule has nothing to flag during the scan-write pipeline.
 *
 * The rule exists for the **incremental scan** path: when
 * `sm scan --changed` re-walks only changed nodes, prior contributions
 * for unchanged nodes are kept (mirroring `scan_extractor_runs`
 * cache reuse). If a node is renamed via the rename heuristic and
 * the target path is also unchanged, the rename migration takes
 * over. If the heuristic misses (low confidence below the threshold),
 * `scan_contributions` rows can point at a `node_path` that no longer
 * exists in `scan_nodes`. This rule walks the rule context's
 * `viewContributions` runtime catalog (each entry carries its `slot`)
 * plus the live node set and emits `warn` Issues for the orphans.
 *
 * Today the rule has access to the manifest catalog via
 * `IRuleContext.viewContributions` (which lists registered shapes,
 * NOT per-node emissions). The actual orphan check requires the
 * full `scan_contributions` table at evaluate time. The rule logic
 * lives here as a stub that emits zero issues until the
 * `IRuleContext.contributionsRows` companion field lands. The stub
 * keeps the rule registered (so it appears in `sm plugins list`) and
 * the typed surface exists for the integration extension that
 * threads through the per-node rows.
 *
 * See `ROADMAP.md` § UI contribution system → Built-in soft-warning
 * rules.
 */

import type { IRule, IRuleContext } from '../../../kernel/extensions/index.js';
import type { Issue } from '../../../kernel/types.js';

const ID = 'contribution-orphan';

export const contributionOrphanRule: IRule = {
  id: ID,
  pluginId: 'core',
  kind: 'rule',
  version: '1.0.0',
  description:
    'Warns when scan_contributions rows reference nodes that no longer exist (post-rename heuristic miss).',
  stability: 'experimental',
  mode: 'deterministic',

  evaluate(_ctx: IRuleContext): Issue[] {
    // Phase 7 stub — the rule's data dependency
    // (`scan_contributions` rows joined against the live node set) is
    // not yet plumbed onto `IRuleContext`. The structural rule entry
    // exists so:
    //   1. `sm plugins list` shows the rule and its `core/`
    //      qualified id.
    //   2. The follow-up wiring (a `contributionRows` field on
    //      `IRuleContext`) lands without spec churn.
    //
    // When the wiring lands, replace this body with:
    //   for (const row of ctx.contributionRows) {
    //     if (livePaths.has(row.nodePath)) continue;
    //     issues.push({...});
    //   }
    return [];
  },
};
