/**
 * `issue-counter` rule. Single source of truth for the per-card
 * severity chips on `card.footer.right`. Walks
 * `ctx.accumulatedIssues` (populated by the orchestrator with the
 * live issue accumulator from every previously-run analyzer), groups
 * per node + severity, and emits one `errorCount` / `warnCount` chip
 * per node with the aggregated count + tooltip.
 *
 * Replaces the historical pattern where every analyzer that found
 * issues also emitted its own counter chip on the same slot. The
 * sibling counter chips produced a forest of duplicate tints on a
 * node carrying multiple findings (a single broken-ref + schema
 * violation + frontmatter issue would paint three separate warn
 * chips), now collapsed into one aggregate chip per severity.
 *
 * Severity mapping for the slot renderer (`NodeCounter`):
 *   - `error` issues → `severity: 'danger'` (red tint, `pi-times-circle`)
 *   - `warn` issues  → `severity: 'warn'` (amber tint, `pi-exclamation-triangle`)
 *   - `info` issues  → not surfaced (UI filters info out of card chrome)
 *
 * Icon set is PrimeIcons (`pi-*`) to stay aligned with the list view's
 * Issues column, which uses the same two glyphs on the same severity
 * palette. The two surfaces (graph card + list table) read identically
 * so the operator's visual vocabulary stays consistent across views.
 *
 * MUST run AFTER every issue-emitting analyzer so the accumulator is
 * complete. Enforced declaratively by the manifest's `phase:
 * 'aggregate'` below: `orderAnalyzersByPhase`
 * (`kernel/orchestrator/analyzers.ts`) schedules every `detect`-phase
 * analyzer first, aggregate phase last, regardless of registry order.
 *
 * Dependency note: this analyzer only aggregates, it never detects. Its
 * output is exactly as complete as the set of ENABLED detect analyzers.
 * If a detector such as `core/reference-broken` is disabled
 * (`plugins.core.extensions.reference-broken.enabled = false`), its
 * findings never reach
 * `accumulatedIssues` and this chip silently omits them, even though the
 * underlying signal (e.g. a broken markdown link) is still extracted.
 * Re-enable the detector for its findings to be counted here.
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue } from '../../../../kernel/types.js';
import type { IViewContribution } from '../../../../kernel/types/view-catalog.js';
import { tx } from '../../../../kernel/util/tx.js';
import { ISSUE_COUNTER_TEXTS as TEXTS } from './issue-counter.texts.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'issue-counter';

// Third in the footer-right cluster, after the drift chip (priority 10)
// and the stability badge (priority 20). The warn counter sits before
// the error counter so the operator reads "advisory → blocking"
// left-to-right.
const warnCount = {
  slot: 'card.footer.right',
  icon: 'pi-exclamation-triangle',
  emitWhenEmpty: false,
  priority: 30,
} satisfies IViewContribution;

// Last in the cluster, the red chip pins to the right edge so the most
// severe signal anchors the row's reading position.
const errorCount = {
  slot: 'card.footer.right',
  icon: 'pi-times-circle',
  emitWhenEmpty: false,
  priority: 40,
} satisfies IViewContribution;

interface ITierCounts {
  readonly errors: ReadonlyMap<string, number>;
  readonly warns: ReadonlyMap<string, number>;
}

function countByTier(issues: readonly Issue[]): ITierCounts {
  const errors = new Map<string, number>();
  const warns = new Map<string, number>();
  for (const issue of issues) {
    const bucket =
      issue.severity === 'error' ? errors :
      issue.severity === 'warn' ? warns : null;
    if (!bucket) continue;
    for (const nodeId of issue.nodeIds) {
      bucket.set(nodeId, (bucket.get(nodeId) ?? 0) + 1);
    }
  }
  return { errors, warns };
}

function emitTierChips(
  ctx: IAnalyzerContext,
  ref: typeof warnCount | typeof errorCount,
  severity: 'danger' | 'warn',
  counts: ReadonlyMap<string, number>,
  singleTooltip: string,
  manyTooltip: string,
): void {
  for (const [nodePath, count] of counts) {
    const capped = Math.min(count, 99);
    ctx.emitContribution(nodePath, ref, {
      value: capped,
      severity,
      tooltip: count === 1 ? singleTooltip : tx(manyTooltip, { count }),
    });
  }
}

export const issueCounterAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Emits one aggregate severity chip per node (error + warn counts) from the live issue accumulator.',
  mode: 'deterministic',
  phase: 'aggregate',

  ui: { warnCount, errorCount },

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const accumulator = ctx.accumulatedIssues ?? [];
    if (accumulator.length === 0) return [];
    const { errors, warns } = countByTier(accumulator);
    emitTierChips(ctx, errorCount, 'danger', errors,
      TEXTS.errorTooltipSingle, TEXTS.errorTooltipMany);
    emitTierChips(ctx, warnCount, 'warn', warns,
      TEXTS.warnTooltipSingle, TEXTS.warnTooltipMany);
    // The aggregator emits zero issues, only contributions. Issues
    // remain owned by the analyzers that detected the underlying
    // findings; double-counting here would inflate `scan.issues`
    // without any new diagnostic value.
    return [];
  },
};
