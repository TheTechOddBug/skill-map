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
 *   - `error` issues → `severity: 'danger'` (red tint, fa-circle-xmark)
 *   - `warn` issues  → `severity: 'warn'` (amber tint, fa-circle-exclamation)
 *   - `info` issues  → not surfaced (UI filters info out of card chrome)
 *
 * MUST run AFTER every issue-emitting analyzer so the accumulator is
 * complete. Today this is enforced by ordering in the built-ins
 * registry (`src/plugins/built-ins.ts`); a future phase mechanism
 * would make the ordering declarative.
 */

import type { IAnalyzer, IAnalyzerContext } from '../../../../kernel/extensions/index.js';
import type { Issue } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { ISSUE_COUNTER_TEXTS as TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'issue-counter';

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
  contributionId: 'errorCount' | 'warnCount',
  severity: 'danger' | 'warn',
  counts: ReadonlyMap<string, number>,
  singleTooltip: string,
  manyTooltip: string,
): void {
  for (const [nodePath, count] of counts) {
    const capped = Math.min(count, 99);
    ctx.emitContribution(nodePath, contributionId, {
      value: capped,
      severity,
      tooltip: count === 1 ? singleTooltip : tx(manyTooltip, { count }),
    });
  }
}

export const issueCounterAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  version: '1.0.0',
  description:
    'Emits one aggregate severity chip per node (error + warn counts) from the live issue accumulator.',
  mode: 'deterministic',
  phase: 'aggregate',

  ui: {
    // Third in the footer-right cluster, after the drift chip
    // (priority 10) and the stability badge (priority 20). The warn
    // counter sits before the error counter so the operator reads
    // "advisory → blocking" left-to-right.
    warnCount: {
      slot: 'card.footer.right',
      icon: 'fa-solid fa-circle-exclamation',
      emitWhenEmpty: false,
      priority: 30,
    },
    // Last in the cluster, the red chip pins to the right edge so the
    // most severe signal anchors the row's reading position.
    errorCount: {
      slot: 'card.footer.right',
      icon: 'fa-solid fa-circle-xmark',
      emitWhenEmpty: false,
      priority: 40,
    },
  },

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const accumulator = ctx.accumulatedIssues ?? [];
    if (accumulator.length === 0) return [];
    const { errors, warns } = countByTier(accumulator);
    emitTierChips(ctx, 'errorCount', 'danger', errors,
      TEXTS.errorTooltipSingle, TEXTS.errorTooltipMany);
    emitTierChips(ctx, 'warnCount', 'warn', warns,
      TEXTS.warnTooltipSingle, TEXTS.warnTooltipMany);
    // The aggregator emits zero issues, only contributions. Issues
    // remain owned by the analyzers that detected the underlying
    // findings; double-counting here would inflate `scan.issues`
    // without any new diagnostic value.
    return [];
  },
};
