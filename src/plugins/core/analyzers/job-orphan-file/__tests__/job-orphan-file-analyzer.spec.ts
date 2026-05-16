/**
 * Coverage for the `core/job-orphan-file` built-in rule
 * (`plugins/core/analyzers/job-orphan-file/index.ts`).
 *
 * Behaviour pinned by these tests:
 *   - One `warn` issue per orphan path threaded through `ctx.orphanJobFiles`.
 *   - Empty / absent `orphanJobFiles` → no issues (cheap no-op).
 *   - `nodeIds` carries the orphan path itself (issue schema requires
 *     at least one entry; the orphan has no live graph node by
 *     definition).
 *   - `data.filePath` mirrors the orphan path so consumers have a
 *     stable structured field to key off without parsing the message.
 *   - The rule stays pure / deterministic: same input → same output,
 *     no FS / port reads (detection runs OUTSIDE the rule, in the
 *     driving adapter via `findOrphanJobFiles`).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { jobOrphanFileAnalyzer } from '../index.js';
import type { IAnalyzerContext } from '../../../../../kernel/extensions/index.js';

function emptyCtx(overrides: Partial<IAnalyzerContext> = {}): IAnalyzerContext {
  return {
    nodes: [],
    links: [],
    emitContribution: () => {
      /* unused, the rule emits issues only */
    },
    ...overrides,
  };
}

describe('core/job-orphan-file rule', () => {
  it('emits no issues when ctx.orphanJobFiles is absent (legacy callers)', async () => {
    const issues = await jobOrphanFileAnalyzer.evaluate(emptyCtx());
    assert.deepEqual(issues, []);
  });

  it('emits no issues when ctx.orphanJobFiles is empty', async () => {
    const issues = await jobOrphanFileAnalyzer.evaluate(emptyCtx({ orphanJobFiles: [] }));
    assert.deepEqual(issues, []);
  });

  it('emits one warn issue per orphan path', async () => {
    const orphans = [
      '/tmp/proj/.skill-map/jobs/d-20260501-100000-aaaa.md',
      '/tmp/proj/.skill-map/jobs/d-20260501-110000-bbbb.md',
    ];
    const issues = await jobOrphanFileAnalyzer.evaluate(emptyCtx({ orphanJobFiles: orphans }));
    assert.equal(issues.length, 2);
    for (const [i, issue] of issues.entries()) {
      assert.equal(issue.analyzerId, 'job-orphan-file');
      assert.equal(issue.severity, 'warn');
      assert.deepEqual(issue.nodeIds, [orphans[i]]);
      assert.equal((issue.data as { filePath: string }).filePath, orphans[i]);
      assert.match(issue.message, /Orphan job file/);
      assert.match(issue.message, /sm job prune --orphan-files/);
    }
  });

  it('preserves the order the caller supplied (no in-place sort)', async () => {
    const orphans = [
      '/tmp/proj/.skill-map/jobs/zzzz.md',
      '/tmp/proj/.skill-map/jobs/aaaa.md',
      '/tmp/proj/.skill-map/jobs/mmmm.md',
    ];
    const issues = await jobOrphanFileAnalyzer.evaluate(emptyCtx({ orphanJobFiles: orphans }));
    assert.deepEqual(
      issues.map((i) => i.nodeIds[0]),
      orphans,
    );
  });

  it('is pure, the same input yields the same issues across two evaluations', async () => {
    const orphans = ['/tmp/proj/.skill-map/jobs/x.md'];
    const a = await jobOrphanFileAnalyzer.evaluate(emptyCtx({ orphanJobFiles: orphans }));
    const b = await jobOrphanFileAnalyzer.evaluate(emptyCtx({ orphanJobFiles: orphans }));
    assert.deepEqual(a, b);
  });
});
