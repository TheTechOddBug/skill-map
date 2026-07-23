/**
 * Built-in probabilistic `ai-tagger-action` (2026-07-21, the taxonomy leg
 * of the summarizer-split direction, user-requested "auto-tag").
 *
 * Analyzes a node's markdown content and infers a small set of topical
 * tags. The agent processes it through the normal queue (`sm jobs claim`
 * + `sm record`) and returns ONLY a report; the agent never touches the
 * `.sm` file (it cannot compute the identity hashes). The APPLY happens
 * on the record path: `sm record` detects the tagger by its report
 * schema's `tags/` namespace reference (`spec/job-lifecycle.md` §Tags
 * write-through, mirror of the `summaries/` detection) and merges the
 * report's `tags[]` into the sidecar's `annotations.tags` through the
 * gated `.sm` channel (standing consent only; without it the tags stay
 * in the report and a human advisory says so).
 *
 * Like the summarizer, the two sibling files (`prompt.md` +
 * `report.schema.json`) are inlined onto the emitted manifest by the
 * built-ins codegen (`scripts/generate-built-ins.js`).
 *
 * Storage-rule note (`spec/architecture.md` §Storage rule): the applied
 * tags land in the CURATION store as the documented delegated-curation
 * carve-out, the operator launched the tagger, and afterwards the tags
 * are ordinary human-owned annotations (editable via the tags row).
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
    "Reads a file and tags it with a few short topics in the file's own language, merging them into any tags it already has (probabilistic; an agent processes it via `sm jobs claim` + `sm record`).",
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
