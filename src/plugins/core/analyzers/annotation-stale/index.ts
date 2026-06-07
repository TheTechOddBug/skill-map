/**
 * `annotation-stale` rule (Step 9.6.2). Surfaces sidecar drift across
 * four surfaces:
 *   - an `info` issue per node whose `.sm` sidecar is stale relative to
 *     the current node hashes (`node.sidecar.status` ∈ {`stale-body`,
 *     `stale-frontmatter`, `stale-both`});
 *   - a `pi-clock` icon-only chip on `card.footer.right` (card / list);
 *   - a `pi-clock` badge on `inspector.header.badge` (the clock that
 *     used to be hardcoded in the inspector header), stale-only;
 *   - a `Bump` button on `inspector.action.button` that dispatches
 *     `core/node-bump`. Always emitted for nodes that already have a
 *     sidecar; the payload's `enabled` flag carries the dynamic gate
 *     (stale => enabled), so the contributions upsert refreshes it each
 *     scan with no per-node sweep.
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
import { tx } from '../../../../kernel/util/tx.js';
import { ANNOTATION_STALE_TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'annotation-stale';

export const annotationStaleAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description: 'Marks sidecars (`.sm`) that are out of date with their `.md`.',
  mode: 'deterministic',
  // The natural fix is to bump the node: refreshes the sidecar hashes,
  // increments `annotations.version`, and stamps the audit block. The
  // inspector surfaces `core/node-bump` as the `bumpButton` contribution.

  ui: {
    // A `pi-clock` chip in the footer-right cluster so the operator
    // spots drift in the list / inspector card. Emitted with `value: 0`
    // + `emitWhenEmpty: true` so the renderer treats it as icon-only;
    // the tooltip carries the per-face detail (body / frontmatter / both).
    staleIcon: {
      slot: 'card.footer.right',
      icon: 'pi-clock',
      emitWhenEmpty: true,
      priority: 20,
    },
    // Inspector header badge: the same clock, now plugin-driven instead
    // of hardcoded in inspector-header.html. Emitted only for stale
    // nodes (see evaluate). The payload carries the icon + tooltip.
    staleBadge: {
      slot: 'inspector.header.badge',
      emitWhenEmpty: false,
      priority: 20,
    },
    // Inspector action button that dispatches `core/node-bump`. Always
    // emitted for nodes that already have a sidecar; the payload's
    // `enabled` flag carries the dynamic gate (stale => enabled).
    bumpButton: {
      slot: 'inspector.action.button',
      priority: 10,
    },
  },

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const issues: Issue[] = [];
    for (const node of ctx.nodes) {
      const status = staleStatus(node.sidecar);

      // Bump button: present for every node that already has a sidecar,
      // enabled only when stale. Nodes with no sidecar are skipped so the
      // inspector never offers to scaffold a `.sm` (creation is CLI-only).
      if (node.sidecar?.present === true) {
        emitBumpButton(ctx, node.path, status !== null);
      }

      if (status === null) continue;

      issues.push({
        analyzerId: ID,
        severity: 'info',
        nodeIds: [node.path],
        message: messageFor(status, node.path),
        data: { status },
      });
      // `value: 0` yields an icon-only footer chip (no count). No
      // severity: drift is neutral, and the issue above is `info`, so it
      // stays out of the card's warn chip and never fails `sm check`.
      ctx.emitContribution(node.path, 'staleIcon', {
        value: 0,
        tooltip: tooltipFor(status),
      });
      ctx.emitContribution(node.path, 'staleBadge', {
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

function messageFor(status: Exclude<SidecarStatus, 'fresh'>, path: string): string {
  switch (status) {
    case 'stale-body':
      return tx(ANNOTATION_STALE_TEXTS.bodyDrift, { path });
    case 'stale-frontmatter':
      return tx(ANNOTATION_STALE_TEXTS.frontmatterDrift, { path });
    case 'stale-both':
      return tx(ANNOTATION_STALE_TEXTS.bothDrift, { path });
  }
}

function emitBumpButton(ctx: IAnalyzerContext, nodePath: string, enabled: boolean): void {
  ctx.emitContribution(nodePath, 'bumpButton', {
    actionId: 'core/node-bump',
    label: ANNOTATION_STALE_TEXTS.bumpLabel,
    icon: 'pi-arrow-up-right',
    enabled,
    ...(enabled ? {} : { disabledReason: ANNOTATION_STALE_TEXTS.bumpDisabledReason }),
  });
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
