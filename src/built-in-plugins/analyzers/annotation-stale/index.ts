/**
 * `annotation-stale` rule (Step 9.6.2). Emits a `warn` issue per node
 * whose co-located `.sm` sidecar is stale relative to the current node
 * hashes — `node.sidecar.status` ∈ {`stale-body`, `stale-frontmatter`,
 * `stale-both`} — AND, since spec 0.22.0, emits a `pi-sync` corner
 * badge to `graph.node.alert` so the operator can spot drift visually
 * on the graph card without opening the Issues panel. Severity uniform
 * `warn`; `stale-both` adds `count: 2` to differentiate the worst case.
 *
 * The kernel computes drift status at scan time (pure function over
 * `node.{bodyHash, frontmatterHash}` and the sidecar's stored
 * `for.{bodyHash, frontmatterHash}`); this rule just surfaces the
 * already-computed status as a graph-level warning + a visual badge so
 * the standard issue surface (CLI, UI, REST) discovers staleness
 * without bespoke plumbing.
 *
 * Severity is `warn` per Decision #4 — bumps are never auto-applied,
 * so stale state is advisory until the user runs `sm bump` (Step
 * 9.6.4).
 */

import type { IAnalyzer, IAnalyzerContext } from '../../../kernel/extensions/index.js';
import type { Issue, SidecarStatus } from '../../../kernel/types.js';
import { tx } from '../../../kernel/util/tx.js';
import { ANNOTATION_STALE_TEXTS } from '../../i18n/annotation-stale.texts.js';

const ID = 'annotation-stale';

export const annotationStaleAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: 'core',
  kind: 'analyzer',
  version: '1.0.0',
  description: 'Marks nodes whose `.sm` sidecar is out of date — the `.md` content changed since the last sidecar bump. Surfaces both an Issue (panel) and a `pi-sync` corner badge on the graph card.',
  stability: 'stable',
  mode: 'deterministic',

  viewContributions: {
    drift: {
      slot: 'graph.node.alert',
      icon: 'sync',
      emitWhenEmpty: false,
    },
    // Card-side counterpart: a `pi-clock` chip in the footer-right
    // cluster so the operator spots drift in the list / inspector view
    // too, not just on the graph. `card.footer.right` is a counter
    // slot — the value communicates gravity (1 = one face drifted, 2
    // = both faces drifted), mirroring the `count` field on the
    // `graph.node.alert` badge above.
    staleIcon: {
      slot: 'card.footer.right',
      icon: 'clock',
      emitWhenEmpty: false,
    },
  },

  // Status → message / tooltip / payload mapping branches three ways
  // and the dual surface (issue + two contributions) adds a couple
  // more — the per-status switch is the whole point. Splitting it into
  // sub-functions only scatters the vocabulary.
  // eslint-disable-next-line complexity
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
      const tooltip = tooltipFor(status);
      ctx.emitContribution(node.path, 'drift', driftPayload(status, tooltip));
      ctx.emitContribution(node.path, 'staleIcon', {
        value: status === 'stale-both' ? 2 : 1,
        severity: 'warn',
        tooltip,
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

function driftPayload(
  status: Exclude<SidecarStatus, 'fresh'>,
  tooltip: string,
): { icon: string; severity: 'warn'; tooltip: string; count?: number } {
  const payload: { icon: string; severity: 'warn'; tooltip: string; count?: number } = {
    icon: 'sync',
    severity: 'warn',
    tooltip,
  };
  if (status === 'stale-both') payload.count = 2;
  return payload;
}
