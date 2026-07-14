/**
 * Scan-time exclusion of probabilistic analyzers (finders).
 *
 * `spec/architecture.md` §Analyzer phases: "Probabilistic analyzers
 * (`mode: 'probabilistic'`) never participate in any scan-time phase".
 * A finder has no `evaluate()` (its judgment is a queued job an external
 * agent drains), so the orchestrator MUST drop it from the schedule
 * before invoking anything, whatever `phase` it declares. Driven through
 * the REAL `runAnalyzers` export with tiny in-memory fixtures.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { runAnalyzers } from '../analyzers.js';
import { makeHookDispatcher } from '../../extensions/hook-dispatcher.js';
import { InMemoryProgressEmitter } from '../../adapters/in-memory-progress.js';
import type { IAnalyzer } from '../../extensions/index.js';
import type { Node } from '../../types.js';

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

async function runWith(analyzers: IAnalyzer[]): ReturnType<typeof runAnalyzers> {
  const emitter = new InMemoryProgressEmitter();
  return runAnalyzers(
    analyzers,
    [mockNode('a.md')],
    [], // internalLinks
    [], // orphanSidecars
    new Map(), // sidecarRoots
    [], // annotationContributions
    [], // viewContributions
    undefined, // referenceablePaths
    undefined, // cwd
    new Set<string>(), // registeredActionIds
    emitter,
    makeHookDispatcher([], emitter),
    undefined, // reservedNodePaths
    undefined, // brokenLinks
    undefined, // nameCollisions
    undefined, // signals
    undefined, // nameMismatches
  );
}

describe('orchestrator, probabilistic analyzers stay out of scan-time phases', () => {
  it('a finder (no evaluate) is skipped; the deterministic sibling still runs', async () => {
    const finder: IAnalyzer = {
      kind: 'analyzer',
      id: 'quality-check',
      pluginId: 'plug',
      version: '1.0.0',
      description: 'probabilistic finder fixture (no evaluate)',
      mode: 'probabilistic',
      probExpectedDurationSeconds: 90,
      // Deliberately no `evaluate`: invoking it would crash; the gate
      // must drop the finder before the schedule reaches it.
    };
    const deterministic: IAnalyzer = {
      kind: 'analyzer',
      id: 'det-rule',
      pluginId: 'plug',
      version: '1.0.0',
      description: 'deterministic sibling',
      evaluate: () => [
        { analyzerId: 'det-rule', severity: 'info', nodeIds: ['a.md'], message: 'ran' },
      ],
    };

    const result = await runWith([finder, deterministic]);
    assert.deepEqual(
      result.issues.map((i) => i.analyzerId),
      ['det-rule'],
      'only the deterministic analyzer contributed',
    );
  });

  it('a probabilistic analyzer is excluded from EVERY phase, even a declared one', async () => {
    let evaluated = 0;
    // A misbehaving finder that DOES declare evaluate + a phase: the
    // gate keys on mode, so it must still never run (declared `phase`
    // on a probabilistic analyzer is ignored per the analyzer schema).
    const finderWithEvaluate: IAnalyzer = {
      kind: 'analyzer',
      id: 'sneaky-finder',
      pluginId: 'plug',
      version: '1.0.0',
      description: 'probabilistic with a stray evaluate',
      mode: 'probabilistic',
      probExpectedDurationSeconds: 60,
      phase: 'aggregate',
      evaluate: () => {
        evaluated += 1;
        return [];
      },
    };

    const result = await runWith([finderWithEvaluate]);
    assert.equal(evaluated, 0, 'the stray evaluate was never invoked');
    assert.deepEqual(result.issues, []);
  });

  it('a stub deterministic analyzer without evaluate is tolerated as an empty emission', async () => {
    const stub: IAnalyzer = {
      kind: 'analyzer',
      id: 'stub-rule',
      pluginId: 'plug',
      version: '1.0.0',
      description: 'deterministic stub without evaluate',
    };
    const result = await runWith([stub]);
    assert.deepEqual(result.issues, [], 'no crash, no issues');
  });
});
