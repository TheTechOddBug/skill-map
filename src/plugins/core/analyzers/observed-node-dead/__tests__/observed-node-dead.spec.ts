/**
 * Coverage for the `core/observed-node-dead` built-in analyzer
 * (`plugins/core/analyzers/observed-node-dead/index.ts`), the node-level
 * dead-design detector.
 *
 * Behaviour pinned by these tests:
 *   - One `info` issue per RUNNABLE node (skill / agent / command) with
 *     zero recorded runs once `MIN_ACTIVE_SESSIONS` active sessions
 *     accumulated; anchored on the node, `data.target` = its own path.
 *   - Below the active-session gate: total silence.
 *   - Any observed run silences the node; docs / virtual nodes are
 *     never judged (they do not execute).
 *   - The central emission gate honours a sidecar issueSuppressions
 *     entry (driven through the REAL `runAnalyzers`).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { observedNodeDeadAnalyzer, MIN_ACTIVE_SESSIONS } from '../index.js';
import type { IAnalyzerContext } from '../../../../../kernel/extensions/index.js';
import { makeHookDispatcher } from '../../../../../kernel/extensions/hook-dispatcher.js';
import { InMemoryProgressEmitter } from '../../../../../kernel/adapters/in-memory-progress.js';
import { SILENT_EXTENSION_LOGGER } from '../../../../../kernel/adapters/silent-logger.js';
import { runAnalyzers } from '../../../../../kernel/orchestrator/analyzers.js';
import type {
  IObservedExecution,
  IObservedExecutions,
} from '../../../../../kernel/session-journal/index.js';
import type { Node } from '../../../../../kernel/types.js';

const SKILL = '.claude/skills/deploy/SKILL.md';
const AGENT = '.claude/agents/architect.md';
const DOC = 'docs/guide.md';

function mockNode(path: string, kind = 'skill', virtual?: boolean): Node {
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
    ...(virtual === undefined ? {} : { virtual }),
  };
}

function executions(
  ran: string[],
  activeSessions = MIN_ACTIVE_SESSIONS,
): IObservedExecutions {
  const byPath = new Map<string, IObservedExecution>(
    ran.map((path) => [
      path,
      { path, count: 4, sessions: 4, lastSeenAt: 1_723_800_000_000 },
    ]),
  );
  return { byPath, activeSessions };
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

describe('core/observed-node-dead analyzer', () => {
  it('flags a runnable node with zero recorded runs once the session gate is met', async () => {
    const issues = await observedNodeDeadAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL), mockNode(AGENT, 'agent')],
        observedExecutions: executions([AGENT]),
      }),
    );
    assert.equal(issues.length, 1);
    const issue = issues[0]!;
    assert.equal(issue.severity, 'info');
    assert.deepEqual(issue.nodeIds, [SKILL]);
    assert.equal(issue.data?.['target'], SKILL);
    assert.equal(issue.data?.['activeSessions'], MIN_ACTIVE_SESSIONS);
    assert.match(issue.message, /Never observed executing/);
    assert.match(issue.message, new RegExp(`${MIN_ACTIVE_SESSIONS} recorded sessions`));
    assert.ok(issue.fix?.summary);
  });

  it('stays silent below the active-session gate', async () => {
    const issues = await observedNodeDeadAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL)],
        observedExecutions: executions([], MIN_ACTIVE_SESSIONS - 1),
      }),
    );
    assert.deepEqual(issues, []);
  });

  it('the session gate is an extension setting (default 20, tunable)', async () => {
    const issues = await observedNodeDeadAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL)],
        settings: { 'min-active-sessions': 5 },
        observedExecutions: executions([], 5),
      }),
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.data?.['activeSessions'], 5);
  });

  it('emits nothing at all without observed executions', async () => {
    const issues = await observedNodeDeadAnalyzer.evaluate!(
      ctxWith({ nodes: [mockNode(SKILL)] }),
    );
    assert.deepEqual(issues, []);
  });

  it('never judges docs or virtual nodes (they do not execute)', async () => {
    const issues = await observedNodeDeadAnalyzer.evaluate!(
      ctxWith({
        nodes: [
          mockNode(DOC, 'markdown'),
          mockNode('mcp://notion', 'mcp', true),
          mockNode(SKILL, 'skill', true), // virtual unit: no backing run to expect
        ],
        observedExecutions: executions([]),
      }),
    );
    assert.deepEqual(issues, []);
  });

  it('any observed run silences the node', async () => {
    const issues = await observedNodeDeadAnalyzer.evaluate!(
      ctxWith({
        nodes: [mockNode(SKILL)],
        observedExecutions: executions([SKILL]),
      }),
    );
    assert.deepEqual(issues, []);
  });

  it('the central gate honours a sidecar suppression at (analyzer, target) grain', async () => {
    const progress = new InMemoryProgressEmitter();
    const sidecarRoots = new Map<string, Record<string, unknown>>([
      [
        SKILL,
        {
          annotations: {
            issueSuppressions: [{ analyzer: 'core/observed-node-dead', value: SKILL }],
          },
        },
      ],
    ]);
    const result = await runAnalyzers(
      [{ ...observedNodeDeadAnalyzer, pluginId: 'core', version: '0.0.0' }],
      [mockNode(SKILL)],
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
      executions([]),
    );
    assert.deepEqual(result.issues, []);
  });
});
