/**
 * Unit tests for the pure half of the live-activity resolution
 * (`resolveSignalsAgainstNodes`) plus the short-circuit paths of
 * `resolveActivityEvent` that need no DB.
 *
 * The provider stub mirrors the shape the claude built-in declares
 * (kinds with `identifiers`), so the resolution behavior asserted here
 * matches what the real registry produces.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { IProvider } from '../../kernel/extensions/index.js';
import type { Node } from '../../kernel/types.js';
import { resolveActivityEvent, resolveSignalsAgainstNodes } from '../activity-resolver.js';

const HASH = 'a'.repeat(64);

function makeNode(overrides: Partial<Node> & Pick<Node, 'path' | 'kind'>): Node {
  return {
    provider: 'claude',
    bodyHash: HASH,
    frontmatterHash: HASH,
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    ...overrides,
  };
}

/**
 * Minimal provider stub: only the fields the resolver reads (`id`,
 * `kinds[*].identifiers`, `activity`). Cast through `unknown` because a
 * full `IProvider` carries required presentation / classify surface the
 * resolver never touches.
 */
function makeProvider(mapEvent?: (raw: unknown) => never[] | null): IProvider {
  return {
    id: 'claude',
    kind: 'provider',
    kinds: {
      skill: { identifiers: ['frontmatter.name', 'dirname'] },
      agent: { identifiers: ['frontmatter.name', 'filename-basename'] },
      command: { identifiers: ['frontmatter.name', 'filename-basename'] },
    },
    activity: mapEvent
      ? { install: { kind: 'json-hooks', configPath: '.claude/settings.json' }, mapEvent }
      : undefined,
  } as unknown as IProvider;
}

const NODES: readonly Node[] = [
  makeNode({ path: '.claude/skills/deploy/SKILL.md', kind: 'skill' }),
  makeNode({
    path: '.claude/agents/reviewer.md',
    kind: 'agent',
    frontmatter: { name: 'code-reviewer' },
  }),
  makeNode({ path: '.claude/agents/worker.md', kind: 'agent' }),
  makeNode({ path: '.claude/commands/ship.md', kind: 'command' }),
  makeNode({ path: 'notes/deploy.md', kind: 'markdown', provider: 'markdown' }),
];

describe('resolveSignalsAgainstNodes', () => {
  const provider = makeProvider();

  it('resolves a skill by dirname', () => {
    const resolved = resolveSignalsAgainstNodes(
      [{ kind: 'skill', name: 'deploy', phase: 'start', owner: 'main' }],
      provider,
      NODES,
    );
    assert.deepEqual(resolved.activity, [
      { nodePath: '.claude/skills/deploy/SKILL.md', phase: 'start', owner: 'main' },
    ]);
    assert.deepEqual(resolved.spawns, []);
  });

  it('resolves an agent by frontmatter.name over the filename', () => {
    const resolved = resolveSignalsAgainstNodes(
      [{ kind: 'agent', name: 'code-reviewer', phase: 'end', owner: 'a1b2' }],
      provider,
      NODES,
    );
    assert.deepEqual(resolved.activity, [
      { nodePath: '.claude/agents/reviewer.md', phase: 'end', owner: 'a1b2' },
    ]);
  });

  it('passes ownerScope through on owner-scoped ends (and only then)', () => {
    const resolved = resolveSignalsAgainstNodes(
      [
        { kind: 'agent', name: 'code-reviewer', phase: 'end', owner: 'a1b2', ownerScope: true },
        // ownerScope without an owner is meaningless: stripped.
        { kind: 'skill', name: 'deploy', phase: 'end', ownerScope: true },
        // ownerScope on a start is meaningless: stripped.
        { kind: 'skill', name: 'deploy', phase: 'start', owner: 'a1b2', ownerScope: true },
      ],
      provider,
      NODES,
    );
    assert.deepEqual(resolved.activity, [
      { nodePath: '.claude/agents/reviewer.md', phase: 'end', owner: 'a1b2', ownerScope: true },
      { nodePath: '.claude/skills/deploy/SKILL.md', phase: 'end' },
      { nodePath: '.claude/skills/deploy/SKILL.md', phase: 'start', owner: 'a1b2' },
    ]);
  });

  it('passes sticky through on starts (and strips it from ends)', () => {
    const resolved = resolveSignalsAgainstNodes(
      [
        { kind: 'agent', name: 'code-reviewer', phase: 'start', owner: 'a1b2', sticky: true },
        { kind: 'agent', name: 'code-reviewer', phase: 'end', owner: 'a1b2', sticky: true },
      ],
      provider,
      NODES,
    );
    assert.deepEqual(resolved.activity, [
      { nodePath: '.claude/agents/reviewer.md', phase: 'start', owner: 'a1b2', sticky: true },
      { nodePath: '.claude/agents/reviewer.md', phase: 'end', owner: 'a1b2' },
    ]);
  });

  it('normalises keepAlive onto starts only (stripped from ends)', () => {
    const resolved = resolveSignalsAgainstNodes(
      [
        {
          kind: 'agent',
          name: 'code-reviewer',
          phase: 'start',
          owner: 'spawn:t1',
          sticky: true,
          keepAlive: true,
        },
        { kind: 'agent', name: 'code-reviewer', phase: 'end', owner: 'spawn:t1', keepAlive: true },
      ],
      provider,
      NODES,
    );
    assert.deepEqual(resolved.activity, [
      {
        nodePath: '.claude/agents/reviewer.md',
        phase: 'start',
        owner: 'spawn:t1',
        sticky: true,
        keepAlive: true,
      },
      { nodePath: '.claude/agents/reviewer.md', phase: 'end', owner: 'spawn:t1' },
    ]);
  });

  it('normalises the signal name like link resolution does', () => {
    const resolved = resolveSignalsAgainstNodes(
      [{ kind: 'skill', name: 'Deploy', phase: 'start' }],
      provider,
      NODES,
    );
    assert.equal(resolved.activity.length, 1);
    assert.equal(resolved.activity[0]?.nodePath, '.claude/skills/deploy/SKILL.md');
    assert.equal(resolved.activity[0]?.owner, undefined);
  });

  it('never lights a phantom: unresolved signals and cross-provider matches drop', () => {
    const resolved = resolveSignalsAgainstNodes(
      [
        // No such skill scanned.
        { kind: 'skill', name: 'nonexistent', phase: 'start' },
        // Name exists on disk but under the markdown provider, not claude.
        { kind: 'markdown', name: 'deploy', phase: 'start' },
      ],
      provider,
      NODES,
    );
    assert.deepEqual(resolved.activity, []);
    assert.deepEqual(resolved.spawns, []);
  });

  it('PATH signals match by exact node.path, across providers and kinds', () => {
    const resolved = resolveSignalsAgainstNodes(
      [
        // A markdown node classified by the `markdown` provider still
        // resolves for a claude-tagged event: the path is unambiguous.
        { path: 'notes/deploy.md', phase: 'start', owner: 'main' },
        // A skill's SKILL.md read directly lights the skill node.
        { path: '.claude/skills/deploy/SKILL.md', phase: 'start' },
      ],
      provider,
      NODES,
    );
    assert.deepEqual(resolved.activity, [
      { nodePath: 'notes/deploy.md', phase: 'start', owner: 'main' },
      { nodePath: '.claude/skills/deploy/SKILL.md', phase: 'start' },
    ]);
  });

  it('node-less OWNER RELEASES forward without resolution (and require an owner)', () => {
    const resolved = resolveSignalsAgainstNodes(
      [
        // Antigravity Stop: release everything conversation X holds.
        { phase: 'end', owner: 'conv-1', ownerScope: true },
        // Without an owner the form is meaningless: dropped.
        { phase: 'end', ownerScope: true },
      ],
      provider,
      NODES,
    );
    assert.deepEqual(resolved.activity, [{ phase: 'end', owner: 'conv-1', ownerScope: true }]);
  });

  it('PATH signals drop when no scanned node carries that path', () => {
    const resolved = resolveSignalsAgainstNodes(
      [
        { path: 'src/index.ts', phase: 'start' },
        { path: '', phase: 'start' },
      ],
      provider,
      NODES,
    );
    assert.deepEqual(resolved.activity, []);
  });

  it('shared slash namespace: command + skill pair resolves only the kind that exists', () => {
    const resolved = resolveSignalsAgainstNodes(
      [
        { kind: 'command', name: 'ship', phase: 'start', owner: 'main' },
        { kind: 'skill', name: 'ship', phase: 'start', owner: 'main' },
      ],
      provider,
      NODES,
    );
    assert.deepEqual(resolved.activity, [
      { nodePath: '.claude/commands/ship.md', phase: 'start', owner: 'main' },
    ]);
  });

  it('a spawn block on a resolved node signal yields a spawn record with parentNodePath', () => {
    const resolved = resolveSignalsAgainstNodes(
      [
        {
          kind: 'agent',
          name: 'code-reviewer',
          phase: 'start',
          owner: 'spawn:t1',
          sticky: true,
          keepAlive: true,
          spawn: {
            spawnId: 't1',
            phase: 'start',
            parentOwner: 'a1b2',
            childKind: 'agent',
            childName: 'worker',
            prompt: 'do the work',
          },
        },
      ],
      provider,
      NODES,
    );
    assert.equal(resolved.activity.length, 1);
    // The child resolves through the same identifiers contract (here
    // by filename-basename); prompt rides the INTERNAL record only.
    assert.deepEqual(resolved.spawns, [
      {
        spawnId: 't1',
        phase: 'start',
        parentOwner: 'a1b2',
        parentNodePath: '.claude/agents/reviewer.md',
        childKind: 'agent',
        childName: 'worker',
        childNodePath: '.claude/agents/worker.md',
        prompt: 'do the work',
      },
    ]);
  });

  it('an unresolved child keeps the spawn record with childName only', () => {
    const resolved = resolveSignalsAgainstNodes(
      [
        {
          kind: 'agent',
          name: 'code-reviewer',
          phase: 'end',
          owner: 'spawn:t2',
          ownerScope: true,
          spawn: {
            spawnId: 't2',
            phase: 'end',
            parentOwner: 'a1b2',
            childKind: 'agent',
            childName: 'unscanned-helper',
            response: 'done',
          },
        },
      ],
      provider,
      NODES,
    );
    assert.deepEqual(resolved.spawns, [
      {
        spawnId: 't2',
        phase: 'end',
        parentOwner: 'a1b2',
        parentNodePath: '.claude/agents/reviewer.md',
        childKind: 'agent',
        childName: 'unscanned-helper',
        response: 'done',
      },
    ]);
  });

  it('RELATION-ONLY signals emit a spawn record and no activity payload', () => {
    const resolved = resolveSignalsAgainstNodes(
      [
        {
          phase: 'start',
          owner: 'main:sid-1',
          spawn: {
            spawnId: 't3',
            phase: 'start',
            parentOwner: 'main:sid-1',
            childKind: 'agent',
            childName: 'worker',
            prompt: 'go',
          },
        },
      ],
      provider,
      NODES,
    );
    assert.deepEqual(resolved.activity, []);
    // No parentNodePath: the ABSENT field is the structural
    // session-parent discriminator (owner strings are never parsed).
    assert.deepEqual(resolved.spawns, [
      {
        spawnId: 't3',
        phase: 'start',
        parentOwner: 'main:sid-1',
        childKind: 'agent',
        childName: 'worker',
        childNodePath: '.claude/agents/worker.md',
        prompt: 'go',
      },
    ]);
  });

  it('a spawn block on an UNRESOLVED node signal drops with its signal', () => {
    const resolved = resolveSignalsAgainstNodes(
      [
        {
          kind: 'agent',
          name: 'unscanned-parent',
          phase: 'start',
          owner: 'spawn:t4',
          spawn: { spawnId: 't4', phase: 'start', parentOwner: 'x1' },
        },
      ],
      provider,
      NODES,
    );
    assert.deepEqual(resolved.activity, []);
    assert.deepEqual(resolved.spawns, []);
  });
});

describe('resolveActivityEvent (DB-free short circuits)', () => {
  it('unknown provider id yields the empty pair', async () => {
    const resolved = await resolveActivityEvent({
      providers: [makeProvider(() => [])],
      dbPath: '/nonexistent/skill-map.db',
      providerId: 'codex',
      raw: {},
    });
    assert.deepEqual(resolved, { activity: [], spawns: [], reports: [] });
  });

  it('provider without an activity capability yields the empty pair', async () => {
    const resolved = await resolveActivityEvent({
      providers: [makeProvider()],
      dbPath: '/nonexistent/skill-map.db',
      providerId: 'claude',
      raw: {},
    });
    assert.deepEqual(resolved, { activity: [], spawns: [], reports: [] });
  });

  it('an end signal report rides the reports channel, never the wire payload', () => {
    const resolved = resolveSignalsAgainstNodes(
      [
        {
          kind: 'agent',
          name: 'code-reviewer',
          phase: 'end',
          owner: 'a1',
          ownerScope: true,
          report: 'final text',
        },
        // An UNSCANNED agent's stop still reports: the report completes
        // a spawn record by childOwner match, node resolution is moot.
        {
          kind: 'agent',
          name: 'ghost-agent',
          phase: 'end',
          owner: 'a2',
          ownerScope: true,
          report: 'ghost report',
        },
      ],
      makeProvider(),
      NODES,
    );
    assert.deepEqual(resolved.reports, [
      { owner: 'a1', report: 'final text' },
      { owner: 'a2', report: 'ghost report' },
    ]);
    // Only the scanned agent produced a wire payload, and it carries
    // no content field.
    assert.equal(resolved.activity.length, 1);
    assert.equal('report' in resolved.activity[0]!, false);
  });

  it('a throwing mapEvent is a disclaim, never an error', async () => {
    const resolved = await resolveActivityEvent({
      providers: [
        makeProvider(() => {
          throw new Error('hostile payload');
        }),
      ],
      dbPath: '/nonexistent/skill-map.db',
      providerId: 'claude',
      raw: { anything: true },
    });
    assert.deepEqual(resolved, { activity: [], spawns: [], reports: [] });
  });
});
