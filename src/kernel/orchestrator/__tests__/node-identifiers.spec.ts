/**
 * Unit tests for `collectNameCollisions` and `collectNameMismatches`,
 * the kernel-side detections that `core/name-collision` and
 * `core/name-mismatch` project. Verifies what the analyzers no longer
 * own: kind eligibility (only kinds whose `identifiers` include
 * `frontmatter.name` participate), normalisation (case / separator
 * variants of one name collide / never mismatch), the >= 2
 * distinct-paths threshold, the two-tier claim sourcing (declared vs
 * path-derived), and the per-kind `identifierMismatch` knob.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { collectNameCollisions, collectNameMismatches } from '../node-identifiers.js';
import type { IProviderKind } from '../../extensions/index.js';
import type { Node } from '../../types.js';

function node(
  path: string,
  kind: string,
  name: string | undefined,
  provider = 'claude',
  virtual = false,
): Node {
  return {
    path,
    kind,
    provider,
    frontmatter: name === undefined ? {} : { name },
    ...(virtual ? { virtual: true } : {}),
  } as unknown as Node;
}

// `command` resolves by declared name + filename (with the info-tier
// mismatch knob), `agent` by declared name only, `markdown` by filename
// only (participation-gate exclusion), `skill` mirrors the open-standard
// declaration (dirname + warn knob), `plain` declares dual identifiers
// but NO mismatch knob.
const REGISTRY: ReadonlyMap<string, IProviderKind> = new Map<string, IProviderKind>([
  [
    'claude/command',
    {
      identifiers: ['frontmatter.name', 'filename-basename'],
      identifierMismatch: 'info',
    } as unknown as IProviderKind,
  ],
  ['claude/agent', { identifiers: ['frontmatter.name'] } as unknown as IProviderKind],
  ['core/markdown', { identifiers: ['filename-basename'] } as unknown as IProviderKind],
  [
    'agent-skills/skill',
    {
      identifiers: ['frontmatter.name', 'dirname'],
      identifierMismatch: 'warn',
    } as unknown as IProviderKind,
  ],
  [
    'codex/agent',
    {
      identifiers: ['frontmatter.name', 'filename-basename'],
      identifierMismatch: 'info',
    } as unknown as IProviderKind,
  ],
  [
    'x/plain',
    { identifiers: ['frontmatter.name', 'filename-basename'] } as unknown as IProviderKind,
  ],
]);

describe('collectNameCollisions', () => {
  it('flags two name-resolvable nodes that declare the same name', () => {
    const collisions = collectNameCollisions(
      [node('a/deploy.md', 'command', 'deploy'), node('b/deploy.md', 'command', 'deploy')],
      REGISTRY,
    );
    assert.equal(collisions.size, 1);
    const claims = collisions.get('deploy');
    assert.ok(claims);
    assert.equal(claims!.length, 2);
    // Sorted by path for determinism.
    assert.deepEqual(claims!.map((c) => c.path), ['a/deploy.md', 'b/deploy.md']);
  });

  it('collides across case / separator variants (normalised)', () => {
    const collisions = collectNameCollisions(
      [node('a.md', 'command', 'Deploy'), node('b.md', 'agent', 'deploy')],
      REGISTRY,
    );
    assert.equal(collisions.size, 1);
    assert.ok(collisions.has('deploy'));
    // Cross-kind claim carries each node's own kind.
    assert.deepEqual(collisions.get('deploy')!.map((c) => c.kind).sort(), ['agent', 'command']);
  });

  it('ignores kinds that do not declare frontmatter.name (plain markdown)', () => {
    const collisions = collectNameCollisions(
      [node('a.md', 'markdown', 'deploy'), node('b.md', 'markdown', 'deploy')],
      REGISTRY,
    );
    assert.equal(collisions.size, 0);
  });

  it('stays silent for a single claimant or an empty / missing name', () => {
    assert.equal(collectNameCollisions([node('a.md', 'command', 'deploy')], REGISTRY).size, 0);
    assert.equal(
      collectNameCollisions(
        [node('a.md', 'command', undefined), node('b.md', 'command', '')],
        REGISTRY,
      ).size,
      0,
    );
  });

  it('mixed bucket: a declared name colliding with another node filename carries both sources', () => {
    const collisions = collectNameCollisions(
      [
        node('cmds/reviewer.md', 'command', 'architect'),
        node('cmds/architect.md', 'command', 'architect2'),
      ],
      REGISTRY,
    );
    // `architect` mixes reviewer.md's declared name with architect.md's
    // filename claim. `architect2` has a single claimant, dropped.
    assert.equal(collisions.size, 1);
    const claims = collisions.get('architect');
    assert.ok(claims);
    assert.deepEqual(
      claims!.map((c) => ({ path: c.path, source: c.source })),
      [
        { path: 'cmds/architect.md', source: 'filename-basename' },
        { path: 'cmds/reviewer.md', source: 'frontmatter.name' },
      ],
    );
  });

  it('regression: name==filename nodes keep their DECLARED claim through the dedup', () => {
    // Each node claims `deploy` twice (declared + filename). If the
    // per-path dedup kept the last-emitted claim, both survivors would
    // read `filename-basename` and the analyzer would degrade the error
    // tier to warn, flipping the scan exit code.
    const collisions = collectNameCollisions(
      [node('a/deploy.md', 'command', 'deploy'), node('b/deploy.md', 'command', 'deploy')],
      REGISTRY,
    );
    const claims = collisions.get('deploy');
    assert.ok(claims);
    assert.deepEqual(
      claims!.map((c) => c.source),
      ['frontmatter.name', 'frontmatter.name'],
    );
  });

  it('single node claiming one name via two sources never self-collides', () => {
    const collisions = collectNameCollisions(
      [node('cmds/deploy.md', 'command', 'deploy')],
      REGISTRY,
    );
    assert.equal(collisions.size, 0);
  });

  it('path-only buckets are dropped (two same-named files with different declared names)', () => {
    const collisions = collectNameCollisions(
      [node('frontend/deploy.md', 'command', 'front'), node('backend/deploy.md', 'command', 'back')],
      REGISTRY,
    );
    // The `deploy` bucket holds two filename claims and no declared one.
    assert.equal(collisions.size, 0);
  });

  it('virtual nodes contribute no path-derived claims', () => {
    // Without the virtual guard, posix-basename of `mcp://beta` is
    // `beta` and would mix with the declared claim below.
    const collisions = collectNameCollisions(
      [node('mcp://beta', 'command', 'alpha', 'claude', true), node('x.md', 'command', 'beta')],
      REGISTRY,
    );
    assert.equal(collisions.size, 0);
  });
});

describe('collectNameMismatches', () => {
  it('flags name != dirname on a warn-knob kind (open-standard skill)', () => {
    const mismatches = collectNameMismatches(
      [node('.agents/skills/deploy/SKILL.md', 'skill', 'deploy-tool', 'agent-skills')],
      REGISTRY,
    );
    assert.deepEqual(mismatches, [
      {
        path: '.agents/skills/deploy/SKILL.md',
        kind: 'skill',
        severity: 'warn',
        declaredName: 'deploy-tool',
        derivedName: 'deploy',
        derivedSource: 'dirname',
      },
    ]);
  });

  it('flags name != filename stem on an info-knob kind, .toml stem included', () => {
    const mismatches = collectNameMismatches(
      [
        node('cmds/reviewer.md', 'command', 'architect'),
        node('.codex/agents/foo.toml', 'agent', 'reviewer', 'codex'),
      ],
      REGISTRY,
    );
    assert.equal(mismatches.length, 2);
    assert.deepEqual(
      mismatches.map((m) => ({ severity: m.severity, derived: m.derivedName })),
      [
        { severity: 'info', derived: 'reviewer' },
        { severity: 'info', derived: 'foo' },
      ],
    );
  });

  it('normalization collapse is NOT a mismatch (case / separator variants)', () => {
    const mismatches = collectNameMismatches(
      [
        node('cmds/deploy.md', 'command', 'Deploy'),
        node('.agents/skills/my-skill/SKILL.md', 'skill', 'my_skill', 'agent-skills'),
      ],
      REGISTRY,
    );
    assert.equal(mismatches.length, 0);
  });

  it('absent / empty / whitespace / non-string names never mismatch', () => {
    const numericName = {
      path: 'cmds/x.md',
      kind: 'command',
      provider: 'claude',
      frontmatter: { name: 123 },
    } as unknown as Node;
    const mismatches = collectNameMismatches(
      [
        node('cmds/a.md', 'command', undefined),
        node('cmds/b.md', 'command', ''),
        node('cmds/c.md', 'command', '   '),
        numericName,
      ],
      REGISTRY,
    );
    assert.equal(mismatches.length, 0);
  });

  it('kind without the knob and kind missing from the registry are skipped', () => {
    const mismatches = collectNameMismatches(
      [
        node('cmds/reviewer.md', 'plain', 'architect', 'x'),
        node('cmds/other.md', 'unknown-kind', 'whatever'),
      ],
      REGISTRY,
    );
    assert.equal(mismatches.length, 0);
  });

  it('root-level file yields no dirname source, so no mismatch', () => {
    const mismatches = collectNameMismatches(
      [node('SKILL.md', 'skill', 'anything', 'agent-skills')],
      REGISTRY,
    );
    // The only divergence candidate would be the dirname, and there is
    // none at the root; declared-vs-nothing is not a mismatch.
    assert.equal(mismatches.length, 0);
  });

  it('virtual nodes never mismatch (no path-derived identity)', () => {
    const mismatches = collectNameMismatches(
      [node('mcp://github', 'command', 'tools', 'claude', true)],
      REGISTRY,
    );
    assert.equal(mismatches.length, 0);
  });
});
