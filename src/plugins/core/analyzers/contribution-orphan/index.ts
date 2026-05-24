/**
 * `core/contribution-orphan` rule, Phase 7 / View contribution
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
 * `IAnalyzerContext.viewContributions` (which lists registered shapes,
 * NOT per-node emissions). The actual orphan check requires the
 * full `scan_contributions` table at evaluate time. The rule logic
 * lives here as a stub that emits zero issues until the
 * `IAnalyzerContext.contributionsRows` companion field lands. The stub
 * keeps the rule registered (so it appears in `sm plugins list`) and
 * the typed surface exists for the integration extension that
 * threads through the per-node rows.
 *
 * See `ROADMAP.md` § UI contribution system → Built-in soft-warning
 * rules.
 *
 * **No companion Action.** The natural fix (re-point a contribution
 * to a renamed node, or prune the orphan row) is project-level, not
 * per-node, so it does not belong as an Action (Actions are per-node
 * by design, see `IActionPrecondition`). The cleanup belongs to a
 * dedicated CLI verb when one lands; this analyzer therefore omits
 * `recommendedActions`.
 */

import type { IAnalyzer, IAnalyzerContext } from '../../../../kernel/extensions/index.js';
import type { Issue } from '../../../../kernel/types.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'contribution-orphan';

export const contributionOrphanAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  version: '0.0.0',
  description:
    'Warns about plugin data referencing nodes renamed or deleted in the latest scan.',
  mode: 'deterministic',

  evaluate(_ctx: IAnalyzerContext): Issue[] {
    // Phase 7 stub, the rule's data dependency
    // (`scan_contributions` rows joined against the live node set) is
    // not yet plumbed onto `IAnalyzerContext`. The structural rule entry
    // exists so:
    //   1. `sm plugins list` shows the rule and its `core/`
    //      qualified id.
    //   2. The follow-up wiring (a `contributionRows` field on
    //      `IAnalyzerContext`) lands without spec churn.
    //
    // When the wiring lands, replace this body with:
    //   for (const row of ctx.contributionRows) {
    //     if (livePaths.has(row.nodePath)) continue;
    //     issues.push({...});
    //   }
    return [];
  },
};
