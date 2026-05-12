/**
 * Built-in deterministic `prune-orphan-files` Action (STUB).
 *
 * Companion fixer for the `core/job-orphan-file` analyzer. The
 * analyzer flags `*.md` files under `.skill-map/jobs/` whose
 * absolute path no `state_jobs.filePath` row references. The action
 * will eventually delete those files, mirroring what the existing
 * `sm job prune --orphan-files` CLI verb does today.
 *
 * **Today both ends do their own thing**:
 *
 *   - `core/job-orphan-file` is fully wired and emits one `warn`
 *     issue per orphan file.
 *   - `core/prune-orphan-files` is a stub that returns
 *     `{ ok: true, noop: true }` unconditionally. The real cleanup
 *     path stays in the CLI verb until the spec decides how
 *     analyzer → action wiring works (no `fixAction` field exists
 *     on `IAnalyzer` or `Issue` yet).
 *
 * **Future work**:
 *
 *   1. Extend the spec with a formal `IAnalyzer.fixAction` (or
 *      per-`Issue` `fixAction`) so the UI / CLI can offer the fixer
 *      automatically.
 *   2. Refactor `sm job prune --orphan-files` to invoke this action
 *      so the deletion logic lives in one place.
 *   3. Ship a dedicated `prune-orphan-files-report.schema.json` that
 *      carries the pruned-file count.
 */

import type {
  IAction,
  IActionContext,
  IActionResult,
} from '../../../kernel/extensions/index.js';

/**
 * Report shape for the stub. Mirrors the `ok` field from the
 * deterministic base. A real `prunedCount` lands with the
 * implementation.
 */
export interface IPruneOrphanFilesReport {
  ok: boolean;
  noop?: boolean;
}

const ID = 'prune-orphan-files';
const PLUGIN_ID = 'core';

export const pruneOrphanFilesAction: IAction = {
  id: ID,
  pluginId: PLUGIN_ID,
  kind: 'action',
  version: '0.0.0',
  description:
    'Deletes leftover job result files no live job references. Paired with the `core/job-orphan-file` analyzer (and the existing `sm job prune --orphan-files` CLI verb).',
  stability: 'experimental',
  mode: 'deterministic',
  reportSchemaRef: 'https://skill-map.dev/spec/v0/report-base-deterministic.schema.json',

  invoke<TInput, TReport>(
    _input: TInput,
    _ctx: IActionContext,
  ): IActionResult<TReport> {
    const report: IPruneOrphanFilesReport = { ok: true, noop: true };
    return { report: report as unknown as TReport };
  },
};
