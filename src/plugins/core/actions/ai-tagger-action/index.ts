/**
 * Built-in probabilistic `ai-tagger-action` (2026-07-21, the taxonomy leg
 * of the summarizer-split direction, user-requested "auto-tag").
 *
 * Analyzes a node's markdown content and infers a small set of topical
 * tags. It PROPOSES, it never writes: the agent processes it through the
 * normal queue (`sm jobs claim` + `sm record`) and returns ONLY a report,
 * and the record path (which detects the tagger by its report schema's
 * `tags/` namespace reference, `spec/job-lifecycle.md` §Tags proposal,
 * mirror of the `summaries/` detection) surfaces the report's `tags[]` on
 * the `job.completed` event for the operator to review and save from the
 * ordinary tags editor. Nothing touches the `.sm` file on this path.
 *
 * Like the summarizer, the two sibling files (`prompt.md` +
 * `report.schema.json`) are inlined onto the emitted manifest by the
 * built-ins codegen (`scripts/generate-built-ins.js`).
 *
 * Storage-rule note (`spec/architecture.md` §Storage rule): tags are
 * human curation, and the rule admits no carve-out, a machine may PROPOSE
 * curation but never author it. The human saving the proposal is what
 * turns it into curation, through the usual consent-gated `.sm`
 * handshake, and afterwards the tags are ordinary human-owned
 * annotations (editable via the tags row).
 *
 * **Owns the `inspector.surface.auto-tag` slot** (2026-07-23, the
 * kernel-agnosticism sweep): the tag row's sparkles affordance is
 * claimed by the deterministic `project()` below instead of a hardcoded
 * extension id in the UI. Mirror of the summarizer's surface claim.
 */

import type {
  IAction,
  IActionProjectionContext,
  IBuiltInManifest,
} from '../../../../kernel/extensions/index.js';
import type { IViewContribution } from '../../../../kernel/types/view-catalog.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

const ID = 'ai-tagger-action';

// Module-level const so the manifest `ui` map and the `project()` emit
// reference the SAME object (the orchestrator recovers the contribution
// id + slot by object identity), mirroring `node-bump`.
const autoTagSurface = {
  slot: 'inspector.surface.auto-tag',
  priority: 10,
} satisfies IViewContribution;

export const aiTaggerAction: IBuiltInManifest<IAction> = {
  id: ID,
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    "Reads a file and proposes a few short topics in the file's own language, skipping what its current tags already cover; you review the suggestion in the tag editor and keep what you want (probabilistic; an agent processes it via `sm jobs claim` + `sm record`).",
  stability: 'stable',
  mode: 'probabilistic',
  // Best-effort wall-clock estimate; drives the job TTL. Tagging is a
  // lighter judgment than the full summary.
  probExpectedDurationSeconds: 60,
  // No precondition: the tagger is universal, `--all` fans out to every
  // non-virtual node regardless of kind.
  ui: { autoTagSurface },
  // Claims the auto-tag sparkles for every real node; static payload,
  // live queue state comes from the prob-extensions catalog entry
  // matching this `actionId` (same pattern as the summarizer surface).
  project(ctx: IActionProjectionContext): void {
    for (const node of ctx.nodes) {
      if (node.virtual === true) continue;
      ctx.emitContribution(node.path, autoTagSurface, {
        actionId: `${PLUGIN_ID}/${ID}`,
        label: 'Auto-tag',
        icon: 'pi-sparkles',
        enabled: true,
      });
    }
  },
};
