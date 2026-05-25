/**
 * `annotation-stale` rule (Step 9.6.2). Emits a `warn` issue per node
 * whose co-located `.sm` sidecar is stale relative to the current node
 * hashes, `node.sidecar.status` ∈ {`stale-body`, `stale-frontmatter`,
 * `stale-both`}, AND emits a `pi-clock` icon-only chip to
 * `card.footer.right` so the operator can spot drift visually without
 * opening the Issues panel. Severity uniform `warn`; the per-face
 * detail (body / frontmatter / both) lives on the chip's tooltip
 * rather than on a numeric count.
 *
 * The kernel computes drift status at scan time (pure function over
 * `node.{bodyHash, frontmatterHash}` and the sidecar's stored
 * `for.{bodyHash, frontmatterHash}`); this rule just surfaces the
 * already-computed status through both surfaces.
 *
 * Severity is `warn` per Decision #4, bumps are never auto-applied,
 * so stale state is advisory until the user runs `sm bump` (Step
 * 9.6.4).
 */

import type { IAnalyzer, IAnalyzerContext } from '../../../../kernel/extensions/index.js';
import type { Issue, SidecarStatus } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { ANNOTATION_STALE_TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'annotation-stale';

export const annotationStaleAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  version: '1.0.0',
  description: 'Marks sidecars (`.sm`) that are out of date with their `.md`.',
  mode: 'deterministic',
  // The natural fix is to bump the node: refreshes `for` hashes,
  // increments `annotations.version`, and stamps the audit block. The
  // UI surfaces `core/node-bump` in the node inspector under "Recommended
  // for issues" whenever this analyzer fires.

  ui: {
    // A `pi-clock` chip in the footer-right cluster so the operator
    // spots drift in the list / inspector view (and on the graph card
    // body). Emitted with `value: 0` and `emitWhenEmpty: true` so the
    // renderer treats it as icon-only, drift severity is binary at
    // this surface (the tooltip carries the per-face detail body /
    // frontmatter / both). The corner badge on `graph.node.alert` was
    // dropped on purpose: a tooltip on the footer chip is enough, and
    // the corner badge stacked on top of broken-ref / unknown-field
    // alerts produced visual noise.
    staleIcon: {
      slot: 'card.footer.right',
      icon: 'pi-clock',
      emitWhenEmpty: true,
      priority: 20,
    },
  },

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const issues: Issue[] = [];
    for (const node of ctx.nodes) {
      const status = node.sidecar?.status;
      if (status === undefined || status === null) continue;
      if (status === 'fresh') continue;
      const message =
        status === 'stale-body'
          ? tx(ANNOTATION_STALE_TEXTS.bodyDrift, { path: node.path })
          : status === 'stale-frontmatter'
            ? tx(ANNOTATION_STALE_TEXTS.frontmatterDrift, { path: node.path })
            : tx(ANNOTATION_STALE_TEXTS.bothDrift, { path: node.path });
      issues.push({
        analyzerId: ID,
        severity: 'warn',
        nodeIds: [node.path],
        message,
        data: { status },
      });
      // `value: 0` + the renderer's `value > 0` guard yields an
      // icon-only chip in the footer, no number next to the clock.
      ctx.emitContribution(node.path, 'staleIcon', {
        value: 0,
        severity: 'warn',
        tooltip: tooltipFor(status),
      });
    }
    return issues;
  },
};

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
