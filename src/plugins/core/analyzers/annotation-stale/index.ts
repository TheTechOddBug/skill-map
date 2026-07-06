/**
 * `annotation-stale` rule (Step 9.6.2). Surfaces sidecar drift across
 * three surfaces:
 *   - an `info` issue per node whose `.sm` sidecar is stale relative to
 *     the current node hashes (`node.sidecar.status` ∈ {`stale-body`,
 *     `stale-frontmatter`, `stale-both`});
 *   - a `pi-clock` icon-only chip on `card.footer.right` (card / list);
 *   - a `pi-clock` badge on `inspector.header.badge` (the clock that
 *     used to be hardcoded in the inspector header), stale-only.
 *
 * The `Bump` button on `inspector.action.button` USED to live here too;
 * it now self-projects from the `core/node-bump` action's scan-time
 * `project()` (the button lives with the action that dispatches it).
 * This analyzer keeps the drift detection surfaces above.
 *
 * The kernel computes drift status at scan time (pure function over
 * `node.{bodyHash, frontmatterHash}` and the sidecar's stored hashes);
 * this rule just surfaces the already-computed status.
 *
 * Severity is `info` (was `warn` under the original Decision #4): drift
 * is informational, not a warning, bumps are never auto-applied. The
 * footer chip and header badge carry no severity (neutral clock).
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { ISidecarOverlay, Issue, SidecarStatus } from '../../../../kernel/types.js';
import type { IViewContribution } from '../../../../kernel/types/view-catalog.js';
import { tx } from '../../../../kernel/util/tx.js';
import { formatFinding } from '../../../../kernel/util/finding-format.js';
import { ANNOTATION_STALE_TEXTS } from './annotation-stale.texts.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'annotation-stale';

// A `pi-clock` chip in the footer-right cluster so the operator spots
// drift in the list / inspector card. Emitted with `value: 0` +
// `emitWhenEmpty: true` so the renderer treats it as icon-only; the
// tooltip carries the per-face detail (body / frontmatter / both).
const staleIcon = {
  slot: 'card.footer.right',
  icon: 'pi-clock',
  emitWhenEmpty: true,
  priority: 20,
} satisfies IViewContribution;

// Inspector header badge: the same clock, now plugin-driven instead of
// hardcoded in inspector-header.html. Emitted only for stale nodes (see
// evaluate). The payload carries the icon + tooltip.
const staleBadge = {
  slot: 'inspector.header.badge',
  emitWhenEmpty: false,
  priority: 20,
} satisfies IViewContribution;

export const annotationStaleAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description: 'Marks sidecars (`.sm`) that are out of date with their `.md`.',
  // Ships experimental (disabled by default, Decision #128), gated as a
  // unit with the `core/node-bump` action that resolves the drift it
  // reports.
  stability: 'experimental',
  mode: 'deterministic',
  // The natural fix is to bump the node: refreshes the sidecar hashes,
  // increments `annotations.version`, and stamps the audit block. The
  // inspector surfaces that affordance via the `core/node-bump` action's
  // own scan-time `project()` self-projection, not from this analyzer.

  ui: { staleIcon, staleBadge },

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const issues: Issue[] = [];
    for (const node of ctx.nodes) {
      const status = staleStatus(node.sidecar);

      if (status === null) continue;

      issues.push({
        analyzerId: ID,
        severity: 'info',
        nodeIds: [node.path],
        message: formatFinding({ body: messageFor(status) }),
        fix: { summary: tx(ANNOTATION_STALE_TEXTS.fixSummary) },
        data: { status },
      });
      // `value: 0` yields an icon-only footer chip (no count). No
      // severity: drift is neutral, and the issue above is `info`, so it
      // stays out of the card's warn chip and never fails `sm check`.
      ctx.emitContribution(node.path, staleIcon, {
        value: 0,
        tooltip: tooltipFor(status),
      });
      ctx.emitContribution(node.path, staleBadge, {
        icon: 'pi-clock',
        tooltip: tooltipFor(status),
      });
    }
    return issues;
  },
};

/**
 * Narrow a sidecar overlay to its stale status, or `null` when the node
 * has no sidecar / is fresh. Keeps the `Exclude<…, 'fresh'>` narrowing in
 * one place so `evaluate` stays under the complexity budget.
 */
function staleStatus(overlay: ISidecarOverlay | null | undefined): Exclude<SidecarStatus, 'fresh'> | null {
  const status = overlay?.status;
  if (status === undefined || status === null || status === 'fresh') return null;
  return status;
}

function messageFor(status: Exclude<SidecarStatus, 'fresh'>): string {
  switch (status) {
    case 'stale-body':
      return tx(ANNOTATION_STALE_TEXTS.bodyDrift);
    case 'stale-frontmatter':
      return tx(ANNOTATION_STALE_TEXTS.frontmatterDrift);
    case 'stale-both':
      return tx(ANNOTATION_STALE_TEXTS.bothDrift);
  }
}

function tooltipFor(status: Exclude<SidecarStatus, 'fresh'>): string {
  switch (status) {
    case 'stale-body':
      return ANNOTATION_STALE_TEXTS.bodyTooltip;
    case 'stale-frontmatter':
      return ANNOTATION_STALE_TEXTS.frontmatterTooltip;
    case 'stale-both':
      return ANNOTATION_STALE_TEXTS.bothTooltip;
  }
}
