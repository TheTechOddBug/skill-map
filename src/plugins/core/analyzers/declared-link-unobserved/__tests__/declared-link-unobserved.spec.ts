/**
 * Coverage for the `core/declared-link-unobserved` built-in analyzer
 * (`plugins/core/analyzers/declared-link-unobserved/index.ts`), the
 * dead-design detector.
 *
 * Behaviour pinned by these tests:
 *   - One `info` issue per declared `invokes` / `references` link whose
 *     resolved target is OBSERVABLE (`mcp://` or `agent`-kind), whose
 *     source cleared the volume gate (`MIN_SOURCE_RUNS` observed unit
 *     runs), and whose pair no recorded session confirms. Anchored on
 *     the SOURCE, `data.target` carrying the dismiss key.
 *   - Below the volume gate: silence (absence of evidence means nothing
 *     until the source demonstrably ran).
 *   - An observed pair silences; matching is on `resolvedTarget` FIRST.
 *   - Non-observable targets (a plain markdown doc) never flag: their
 *     only honest firing would be a READ and reads stay unfolded.
 *   - `mentions` / `points` links are not judged (not declarations).
 *   - Missing endpoints drop; duplicate links dedupe to one issue.
 *   - The central emission gate honours a sidecar issueSuppressions
 *     entry (driven through the REAL `runAnalyzers`).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { declaredLinkUnobservedAnalyzer, MIN_SOURCE_RUNS } from '../index.js';
import type { IAnalyzerContext } from '../../../../../kernel/extensions/index.js';
import { makeHookDispatcher } from '../../../../../kernel/extensions/hook-dispatcher.js';
import { InMemoryProgressEmitter } from '../../../../../kernel/adapters/in-memory-progress.js';
import { SILENT_EXTENSION_LOGGER } from '../../../../../kernel/adapters/silent-logger.js';
import { runAnalyzers } from '../../../../../kernel/orchestrator/analyzers.js';
import type {
  IObservedExecution,
  IObservedRelation,
} from '../../../../../kernel/session-journal/index.js';
import type { Link, Node } from '../../../../../kernel/types.js';

const SKILL = '.claude/skills/deploy/SKILL.md';
const AGENT = '.claude/agents/architect.md';
const MCP = 'mcp://notion';
const DOC = 'docs/guide.md';

function mockNode(path: string, kind = 'markdown'): Node {
  return {
    path,
    kind,
    provider: 'core',
    bodyHash: 'a'.repeat(64),
    frontmatterHash: 'b'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

function mockLink(over: Partial<Link>): Link {
  return {
    source: SKILL,
    target: MCP,
    kind: 'references',
    confidence: 1.0,
    sources: [],
    ...over,
  };
}

function execMap(entries: Partial<IObservedExecution>[]): ReadonlyMap<string, IObservedExecution> {
  return new Map(
    entries
      .map((over) => ({
        path: SKILL,
        count: MIN_SOURCE_RUNS,
        sessions: 2,
        lastSeenAt: 1_723_800_000_000,
        ...over,
      }))
      .map((e) => [e.path, e]),
  );
}

function observedMap(entries: Partial<IObservedRelation>[]): ReadonlyMap<string, IObservedRelation> {
  return new Map(
    entries
      .map((over) => ({
        source: SKILL,
        target: MCP,
        relation: 'invokes' as const,
        count: 1,
        sessions: 1,
        lastSeenAt: 1_723_800_000_000,
        ...over,
      }))
      .map((e) => [`${e.source}\x00${e.target}`, e]),
  );
}

function ctxWith(over: Partial<IAnalyzerContext>): IAnalyzerContext {
  return {
    nodes: [],
    links: [],
    settings: {},
    log: SILENT_EXTENSION_LOGGER,
    emitContribution: () => {
      /* unused */
    },
    ...over,
  };
}

describe('core/declared-link-unobserved analyzer', () => {
  it('emits nothing without observed executions (no recorded evidence at all)', async () => {
    const issues = await declaredLinkUnobservedAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL), mockNode(MCP)],
        links: [mockLink({})],
      }),
    );
    assert.deepEqual(issues, []);
  });

  it('flags a declared link to an mcp target the recordings never confirmed (info, on the source)', async () => {
    const issues = await declaredLinkUnobservedAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL), mockNode(MCP)],
        links: [mockLink({ kind: 'invokes' })],
        observedExecutions: execMap([{}]),
      }),
    );
    assert.equal(issues.length, 1);
    const issue = issues[0]!;
    assert.equal(issue.severity, 'info');
    assert.deepEqual(issue.nodeIds, [SKILL]);
    assert.equal(issue.data?.['target'], MCP);
    assert.equal(issue.data?.['runs'], MIN_SOURCE_RUNS);
    assert.equal(issue.data?.['sessions'], 2);
    assert.match(issue.message, /never observed/);
    assert.match(issue.message, /ran 3 times across 2 recorded sessions/);
    assert.ok(issue.fix?.summary);
  });

  it('stays silent below the volume gate (the source has not run enough)', async () => {
    const issues = await declaredLinkUnobservedAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL), mockNode(MCP)],
        links: [mockLink({})],
        observedExecutions: execMap([{ count: MIN_SOURCE_RUNS - 1 }]),
      }),
    );
    assert.deepEqual(issues, []);
  });

  it('an observed pair silences, matching the link on resolvedTarget (trigger-style)', async () => {
    const link = mockLink({ target: '@notion', kind: 'invokes', resolvedTarget: MCP });
    const issues = await declaredLinkUnobservedAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL), mockNode(MCP)],
        links: [link],
        observedExecutions: execMap([{}]),
        observedRelations: observedMap([{}]),
      }),
    );
    assert.deepEqual(issues, []);
  });

  it('a trigger-style link with NO observation flags with the RESOLVED target as the key', async () => {
    const link = mockLink({ target: '@notion', kind: 'invokes', resolvedTarget: MCP });
    const issues = await declaredLinkUnobservedAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL), mockNode(MCP)],
        links: [link],
        observedExecutions: execMap([{}]),
      }),
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.data?.['target'], MCP);
  });

  it('an agent-kind target is observable (the spawns evidence class)', async () => {
    const issues = await declaredLinkUnobservedAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL), mockNode(AGENT, 'agent')],
        links: [mockLink({ target: AGENT })],
        observedExecutions: execMap([{}]),
      }),
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.data?.['target'], AGENT);
  });

  it('a plain doc target is NOT observable: never judged while reads stay unfolded', async () => {
    const issues = await declaredLinkUnobservedAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL), mockNode(DOC)],
        links: [mockLink({ target: DOC })],
        observedExecutions: execMap([{}]),
      }),
    );
    assert.deepEqual(issues, []);
  });

  it('mentions is not a declaration of execution: never judged', async () => {
    const issues = await declaredLinkUnobservedAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL), mockNode(MCP)],
        links: [mockLink({ kind: 'mentions' })],
        observedExecutions: execMap([{}]),
      }),
    );
    assert.deepEqual(issues, []);
  });

  it('drops links whose target left the scanned set; dedupes duplicate pairs', async () => {
    const issues = await declaredLinkUnobservedAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL), mockNode(MCP)],
        links: [
          mockLink({ target: 'mcp://deleted' }), // not scanned
          mockLink({ kind: 'invokes' }),
          mockLink({ kind: 'references' }), // same pair, one issue
        ],
        observedExecutions: execMap([{}]),
      }),
    );
    assert.equal(issues.length, 1);
  });

  it('the central gate honours a sidecar suppression at (analyzer, target) grain', async () => {
    const progress = new InMemoryProgressEmitter();
    const sidecarRoots = new Map<string, Record<string, unknown>>([
      [
        SKILL,
        {
          annotations: {
            issueSuppressions: [{ analyzer: 'core/declared-link-unobserved', value: MCP }],
          },
        },
      ],
    ]);
    const result = await runAnalyzers(
      [{ ...declaredLinkUnobservedAnalyzer, pluginId: 'core', version: '0.0.0' }],
      [mockNode(SKILL), mockNode(MCP)],
      [mockLink({ kind: 'invokes' })],
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
      execMap([{}]),
    );
    assert.deepEqual(result.issues, []);
  });
});
