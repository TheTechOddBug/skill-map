/**
 * Central operator-dismissal gate in the analyzer pass.
 *
 * `spec/db-schema.md` §scan_issues + `spec/architecture.md` §Analyzer
 * phases: the KERNEL applies `annotations.issueSuppressions`, so ANY
 * deterministic analyzer (built-in or third-party, with no suppression
 * code of its own) stops re-emitting a dismissed value-carrying issue
 * on the next scan. Regression driver: `core/reference-redundant`
 * (and four siblings) offered a dismiss affordance that silently came
 * back, because only `core/reference-broken` consulted the entries.
 *
 * Driven through the REAL `runAnalyzers` export with in-memory
 * fixtures; the analyzers here deliberately know nothing about
 * suppressions.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { runAnalyzers } from '../analyzers.js';
import { makeHookDispatcher } from '../../extensions/hook-dispatcher.js';
import { InMemoryProgressEmitter } from '../../adapters/in-memory-progress.js';
import type { IAnalyzer } from '../../extensions/index.js';
import type { Issue, Node } from '../../types.js';

function mockNode(path: string): Node {
  return {
    path,
    kind: 'markdown',
    provider: 'core',
    bodyHash: 'a'.repeat(64),
    frontmatterHash: 'b'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

/** A dismiss-unaware analyzer emitting one value-carrying issue. */
function emitter(id: string, issues: Issue[]): IAnalyzer {
  return {
    id,
    pluginId: 'core',
    kind: 'analyzer',
    version: '1.0.0',
    description: `test ${id}`,
    evaluate: () => issues,
  } as IAnalyzer;
}

function issueOn(analyzerId: string, nodeIds: string[], target: string): Issue {
  return {
    analyzerId,
    severity: 'info',
    nodeIds,
    message: `flagged ${target}`,
    data: { target },
  };
}

function sidecarRootsWith(
  nodePath: string,
  entries: readonly { analyzer: string; value: string }[],
): Map<string, Record<string, unknown>> {
  return new Map([[nodePath, { annotations: { issueSuppressions: entries } }]]);
}

async function runWith(
  analyzers: IAnalyzer[],
  nodes: Node[],
  sidecarRoots: Map<string, Record<string, unknown>>,
): ReturnType<typeof runAnalyzers> {
  const progress = new InMemoryProgressEmitter();
  return runAnalyzers(
    analyzers,
    nodes,
    [], // internalLinks
    [], // orphanSidecars
    sidecarRoots,
    [], // annotationContributions
    [], // viewContributions
    undefined, // referenceablePaths
    undefined, // cwd
    new Set<string>(), // registeredActionIds
    progress,
    makeHookDispatcher([], progress),
    undefined, // reservedNodePaths
    undefined, // brokenLinks
    undefined, // nameCollisions
    undefined, // signals
    undefined, // nameMismatches
    undefined, // observedRelations
    undefined, // observedExecutions
  );
}

describe('orchestrator, central issue-suppression gate', () => {
  it('drops a dismissed issue from an analyzer that never consults suppressions', async () => {
    const analyzer = emitter('reference-redundant', [
      issueOn('reference-redundant', ['a.md'], 'refs/x.md'),
    ]);
    const { issues } = await runWith(
      [analyzer],
      [mockNode('a.md')],
      sidecarRootsWith('a.md', [{ analyzer: 'reference-redundant', value: 'refs/x.md' }]),
    );
    assert.deepEqual(issues, []);
  });

  it('matches a qualified entry against the same analyzer, and only that value', async () => {
    const analyzer = emitter('reference-redundant', [
      issueOn('reference-redundant', ['a.md'], 'refs/x.md'),
      issueOn('reference-redundant', ['a.md'], 'refs/other.md'),
    ]);
    const { issues } = await runWith(
      [analyzer],
      [mockNode('a.md')],
      sidecarRootsWith('a.md', [{ analyzer: 'core/reference-redundant', value: 'refs/x.md' }]),
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.data?.['target'], 'refs/other.md');
  });

  it('is case-sensitive on the value and scoped to the emitting analyzer', async () => {
    const analyzers = [
      emitter('reference-redundant', [issueOn('reference-redundant', ['a.md'], 'Refs/X.md')]),
      emitter('link-self-loop', [issueOn('link-self-loop', ['a.md'], 'refs/x.md')]),
    ];
    const { issues } = await runWith(
      analyzers,
      [mockNode('a.md')],
      sidecarRootsWith('a.md', [{ analyzer: 'reference-redundant', value: 'refs/x.md' }]),
    );
    assert.deepEqual(
      issues.map((i) => i.analyzerId),
      ['reference-redundant', 'link-self-loop'],
    );
  });

  it('drops a multi-node issue dismissed on ANY of its anchors', async () => {
    const analyzer = emitter('extractor-collision', [
      issueOn('extractor-collision', ['a.md', 'b.md'], 'dup'),
    ]);
    const { issues } = await runWith(
      [analyzer],
      [mockNode('a.md'), mockNode('b.md')],
      sidecarRootsWith('b.md', [{ analyzer: 'extractor-collision', value: 'dup' }]),
    );
    assert.deepEqual(issues, []);
  });

  it('never drops an issue without a data.target (no dismissal key)', async () => {
    const analyzer = emitter('issue-counter', [
      { analyzerId: 'issue-counter', severity: 'info', nodeIds: ['a.md'], message: '1 issue' },
    ]);
    const { issues } = await runWith(
      [analyzer],
      [mockNode('a.md')],
      sidecarRootsWith('a.md', [{ analyzer: 'issue-counter', value: 'a.md' }]),
    );
    assert.equal(issues.length, 1);
  });

  it('hides dismissed issues from the aggregate phase accumulator', async () => {
    const seen: number[] = [];
    const detector = emitter('reference-redundant', [
      issueOn('reference-redundant', ['a.md'], 'refs/x.md'),
    ]);
    const aggregator: IAnalyzer = {
      id: 'issue-counter',
      pluginId: 'core',
      kind: 'analyzer',
      version: '1.0.0',
      description: 'test aggregate',
      phase: 'aggregate',
      evaluate: (ctx) => {
        seen.push(ctx.accumulatedIssues?.length ?? 0);
        return [];
      },
    } as IAnalyzer;
    await runWith(
      [detector, aggregator],
      [mockNode('a.md')],
      sidecarRootsWith('a.md', [{ analyzer: 'reference-redundant', value: 'refs/x.md' }]),
    );
    assert.deepEqual(seen, [0]);
  });
});
