/**
 * Built-in deterministic `relink-contributions` Action (STUB).
 *
 * Companion fixer for the `core/contribution-orphan` analyzer. The
 * analyzer detects `scan_contributions` rows whose `node_path` no
 * longer exists (typically after an incremental scan where the
 * rename heuristic missed). This action will eventually resolve
 * those orphans by re-pointing them at the renamed target (high-
 * confidence rename match) or pruning them outright (target gone).
 *
 * Today both ends are stubs:
 *
 *   - `core/contribution-orphan` returns `[]` because its data
 *     dependency (`IAnalyzerContext.contributionRows`) is not yet
 *     plumbed.
 *   - `core/relink-contributions` returns `{ ok: true, noop: true }`
 *     unconditionally. No formal `IAnalyzer → IAction` wire exists
 *     in the spec yet; the cross-reference lives in this docstring
 *     and the analyzer's. Future work: extend `IAnalyzer` (or
 *     `Issue`) with a `fixAction: string` field so the UI / CLI can
 *     surface the action automatically.
 *
 * `reportSchemaRef` points at the shared deterministic base because
 * the stub does not declare any extra report fields. When the real
 * implementation lands, ship a dedicated
 * `relink-contributions-report.schema.json` (mirroring bump) that
 * carries the relink / prune counts.
 */

import type {
  IAction,
  IActionContext,
  IActionResult,
} from '../../../kernel/extensions/index.js';

/**
 * Report shape for the stub. Mirrors the `ok` field from the
 * deterministic base. Real fields (relinked / pruned counts) land
 * with the implementation.
 */
export interface IRelinkContributionsReport {
  ok: boolean;
  noop?: boolean;
}

const ID = 'relink-contributions';
const PLUGIN_ID = 'core';

export const relinkContributionsAction: IAction = {
  id: ID,
  pluginId: PLUGIN_ID,
  kind: 'action',
  version: '0.0.0',
  description:
    'Re-points or prunes plugin contributions left orphan after a rename or deletion. Paired with the `core/contribution-orphan` analyzer.',
  stability: 'experimental',
  mode: 'deterministic',
  reportSchemaRef: 'https://skill-map.dev/spec/v0/report-base-deterministic.schema.json',

  invoke<TInput, TReport>(
    _input: TInput,
    _ctx: IActionContext,
  ): IActionResult<TReport> {
    const report: IRelinkContributionsReport = { ok: true, noop: true };
    return { report: report as unknown as TReport };
  },
};
