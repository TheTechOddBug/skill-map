/**
 * `job-orphan-file` rule. Emits one `warn` issue per `*.md` under
 * `.skill-map/jobs/` whose absolute path no `state_jobs.filePath`
 * references.
 *
 * Detection runs **outside** the rule: the driving adapter (CLI / BFF)
 * computes orphan paths via `findOrphanJobFiles(jobsDir, await
 * port.jobs.listReferencedFilePaths())` inside its already-open
 * storage transaction and threads them into `runScan` via
 * `RunScanOptions.orphanJobFiles`. The rule then projects each path
 * as a graph-level issue. Mirrors the `annotation-orphan` model
 * (orphan sidecars discovered by the walker, projected by the rule)
 * so the kernel stays free of storage-port reads at rule time and
 * the rule stays trivial / deterministic / pure.
 *
 * `nodeIds` carries the orphan path itself, the orphan has no live
 * node by definition (it sits in the jobs dir, never walked into the
 * graph), and the issue schema requires at least one `nodeId`. The
 * `data.filePath` mirror gives consumers a stable structured field
 * to key off without parsing the message.
 *
 * Severity is `warn` per parity with `annotation-orphan` (orphan
 * cleanup is a manual gesture; the warning prompts the user but
 * never blocks a scan).
 *
 * Action: the user runs `sm job prune --orphan-files` to delete the
 * files. Detection (here) and action (CLI verb) stay separate; both
 * paths consume the same `findOrphanJobFiles` helper to avoid
 * drift.
 *
 * **No companion Action.** The cleanup is project-level (filesystem
 * deletion in `.skill-map/jobs/`), not per-node, so it does not
 * belong as an Action (Actions are per-node by design, see
 * `IActionPrecondition`). The `sm job prune --orphan-files` CLI
 * verb is the correct surface. This analyzer omits
 * `recommendedActions`.
 */

import type { IAnalyzer, IAnalyzerContext } from '../../../../kernel/extensions/index.js';
import type { Issue } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { JOB_ORPHAN_FILE_TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'job-orphan-file';

export const jobOrphanFileAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  version: '1.0.0',
  description:
    'Flags leftover job result files (no live job references them). Clean up via `sm job prune --orphan-files`.',
  mode: 'deterministic',

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const orphans = ctx.orphanJobFiles;
    if (!orphans || orphans.length === 0) return [];
    const issues: Issue[] = [];
    for (const filePath of orphans) {
      issues.push({
        analyzerId: ID,
        severity: 'warn',
        nodeIds: [filePath],
        message: tx(JOB_ORPHAN_FILE_TEXTS.message, { filePath }),
        data: { filePath },
      });
    }
    return issues;
  },
};
