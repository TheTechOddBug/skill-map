/**
 * `annotation-stale` rule (Step 9.6.2). Emits an `info` issue per node
 * whose co-located `.sm` sidecar is stale relative to the current node
 * hashes, `node.sidecar.status` ∈ {`stale-body`, `stale-frontmatter`,
 * `stale-both`}, AND emits a `pi-clock` icon-only chip to
 * `card.footer.right` so the operator can spot drift visually without
 * opening the Issues panel. Severity uniform `info`; the per-face
 * detail (body / frontmatter / both) lives on the chip's tooltip
 * rather than on a numeric count.
 *
 * The kernel computes drift status at scan time (pure function over
 * `node.{bodyHash, frontmatterHash}` and the sidecar's stored
 * `for.{bodyHash, frontmatterHash}`); this rule just surfaces the
 * already-computed status through both surfaces.
 *
 * Severity is `info` (was `warn` under the original Decision #4): drift
 * is informational, not a warning, bumps are never auto-applied, so
 * stale state is purely advisory until the user runs `sm bump` (Step
 * 9.6.4). The footer chip carries no severity at all (neutral clock).
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue, SidecarStatus } from '../../../../kernel/types.js';
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
      // Sits right after the stability badge and before the severity
      // counters: stability is the node's declared lifecycle state,
      // drift is "this node disagrees with its sidecar", then the
      // warn / error counts anchor the right edge.
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
        severity: 'info',
        nodeIds: [node.path],
        message,
        data: { status },
      });
      // `value: 0` + the renderer's `value > 0` guard yields an
      // icon-only chip in the footer, no number next to the clock.
      // No `severity`: drift is a neutral state, not a warning, so the
      // clock renders in the foreground colour (the node-counter
      // renderer's no-severity default) instead of the warn tint. The
      // Findings issue above is `info` for the same reason; `info`
      // issues stay out of the card's warn chip (issue-counter buckets
      // error/warn only) and never fail `sm check`'s exit code.
      ctx.emitContribution(node.path, 'staleIcon', {
        value: 0,
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
