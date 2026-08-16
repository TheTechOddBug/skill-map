/**
 * Coverage for the `core/observed-link-missing` built-in analyzer
 * (`plugins/core/analyzers/observed-link-missing/index.ts`).
 *
 * Behaviour pinned by these tests:
 *   - One `info` issue per observed (source, target) pair no declared
 *     link covers, anchored on the SOURCE node, `data.target` carrying
 *     the dismiss key.
 *   - A declared `invokes` / `references` link suppresses, matching on
 *     `resolvedTarget` FIRST (a trigger-style link keeps `@foo` in
 *     `link.target`, so raw matching would false-positive).
 *   - `mentions` / `points` do NOT suppress (naming is not executing).
 *   - Pairs whose source or target is not in the scanned set drop.
 *   - Empty / absent `observedRelations` emits nothing.
 *   - The central emission gate honours a sidecar issueSuppressions
 *     entry (driven through the REAL `runAnalyzers`).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { observedLinkMissingAnalyzer } from '../index.js';
import type { IAnalyzerContext } from '../../../../../kernel/extensions/index.js';
import { makeHookDispatcher } from '../../../../../kernel/extensions/hook-dispatcher.js';
import { InMemoryProgressEmitter } from '../../../../../kernel/adapters/in-memory-progress.js';
import { SILENT_EXTENSION_LOGGER } from '../../../../../kernel/adapters/silent-logger.js';
import { runAnalyzers } from '../../../../../kernel/orchestrator/analyzers.js';
import type { IObservedRelation } from '../../../../../kernel/session-journal/index.js';
import type { Link, Node } from '../../../../../kernel/types.js';

const SKILL = '.claude/skills/deploy/SKILL.md';
const AGENT = '.claude/agents/architect.md';
const MCP = 'mcp://notion';

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

function observedMap(entries: IObservedRelation[]): ReadonlyMap<string, IObservedRelation> {
  return new Map(entries.map((e) => [`${e.source}\x00${e.target}`, e]));
}

function observed(over: Partial<IObservedRelation>): IObservedRelation {
  return {
    source: SKILL,
    target: MCP,
    relation: 'invokes',
    count: 3,
    sessions: 2,
    lastSeenAt: 1_723_800_000_000,
    ...over,
  };
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

describe('core/observed-link-missing analyzer', () => {
  it('emits nothing without observed relations', async () => {
    const issues = await observedLinkMissingAnalyzer.evaluate!(
      ctxWith({ nodes: [mockNode(SKILL), mockNode(MCP)] }),
    );
    assert.deepEqual(issues, []);
  });

  it('flags an observed invocation no declared link covers (info, on the source)', async () => {
    const issues = await observedLinkMissingAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL), mockNode(MCP)],
        observedRelations: observedMap([observed({})]),
      }),
    );
    assert.equal(issues.length, 1);
    const issue = issues[0]!;
    assert.equal(issue.severity, 'info');
    assert.deepEqual(issue.nodeIds, [SKILL]);
    assert.equal(issue.data?.['target'], MCP);
    assert.equal(issue.data?.['relation'], 'invokes');
    assert.equal(issue.data?.['count'], 3);
    assert.equal(issue.data?.['sessions'], 2);
    assert.match(issue.message, /Observed 3 invocations across 2 sessions/);
    assert.ok(issue.fix?.summary);
  });

  it('pluralises honestly for a single observation in one session', async () => {
    const issues = await observedLinkMissingAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(AGENT), mockNode(SKILL)],
        observedRelations: observedMap([
          observed({ source: AGENT, target: SKILL, relation: 'spawns', count: 1, sessions: 1 }),
        ]),
      }),
    );
    assert.equal(issues.length, 1);
    assert.match(issues[0]!.message, /Observed 1 spawn across 1 session;/);
  });

  it('a declared invokes link suppresses, matching on resolvedTarget (trigger-style)', async () => {
    // The authored trigger stays in `target`; only `resolvedTarget`
    // carries the real node path. Raw-target matching would MISS this.
    const link = mockLink({
      source: SKILL,
      target: '@notion',
      kind: 'invokes',
      resolvedTarget: MCP,
    });
    const issues = await observedLinkMissingAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL), mockNode(MCP)],
        links: [link],
        observedRelations: observedMap([observed({})]),
      }),
    );
    assert.deepEqual(issues, []);
  });

  it('a declared references link (path-style, no resolvedTarget) suppresses too', async () => {
    const link = mockLink({ source: SKILL, target: MCP, kind: 'references' });
    const issues = await observedLinkMissingAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL), mockNode(MCP)],
        links: [link],
        observedRelations: observedMap([observed({})]),
      }),
    );
    assert.deepEqual(issues, []);
  });

  it('mentions does NOT suppress (naming is not declaring execution)', async () => {
    const link = mockLink({ source: SKILL, target: MCP, kind: 'mentions', resolvedTarget: MCP });
    const issues = await observedLinkMissingAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL), mockNode(MCP)],
        links: [link],
        observedRelations: observedMap([observed({})]),
      }),
    );
    assert.equal(issues.length, 1);
  });

  it('drops pairs whose source or target left the scanned set', async () => {
    const issues = await observedLinkMissingAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL)], // MCP node not scanned
        observedRelations: observedMap([
          observed({}),
          observed({ source: 'deleted.md', target: SKILL, relation: 'spawns' }),
        ]),
      }),
    );
    assert.deepEqual(issues, []);
  });

  it('emits in deterministic (source, target) order regardless of map order', async () => {
    const issues = await observedLinkMissingAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL), mockNode(AGENT), mockNode(MCP)],
        observedRelations: observedMap([
          observed({ source: SKILL, target: MCP }),
          observed({ source: AGENT, target: SKILL, relation: 'spawns' }),
        ]),
      }),
    );
    assert.deepEqual(
      issues.map((i) => i.nodeIds[0]),
      [AGENT, SKILL],
    );
  });

  it('the central gate honours a sidecar suppression at (analyzer, target) grain', async () => {
    const progress = new InMemoryProgressEmitter();
    const sidecarRoots = new Map<string, Record<string, unknown>>([
      [
        SKILL,
        {
          annotations: {
            issueSuppressions: [{ analyzer: 'core/observed-link-missing', value: MCP }],
          },
        },
      ],
    ]);
    const result = await runAnalyzers(
      [{ ...observedLinkMissingAnalyzer, pluginId: 'core', version: '0.0.0' }],
      [mockNode(SKILL), mockNode(MCP)],
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
      observedMap([observed({})]),
    );
    assert.deepEqual(result.issues, []);
  });
});
