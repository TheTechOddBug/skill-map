/**
 * End-to-end coverage for the `core/name-reserved` analyzer's
 * source-side surface, exercised through `runScan` so the full
 * orchestrator pipeline participates: discovery (claude provider) →
 * slash extractor (target=/help, confidence 0.8) → post-walk lift
 * (resolves `/help` against the planted `.claude/commands/help.md`,
 * confirms the resolved path is in `ctx.reservedNodePaths`, downgrades
 * to RESERVED_TARGET_CONFIDENCE 0.1) → reserved-name analyzer (emits
 * target-side + source-side warns).
 *
 * Why a dedicated integration test (companion to the unit test in
 * `plugins/core/analyzers/reserved-name/__tests__/reserved-name.spec.ts`):
 * the unit test exercises `evaluate()` with a hand-built ctx whose
 * `reservedNodePaths` is preloaded and whose links are synthesised at
 * exactly `RESERVED_TARGET_CONFIDENCE`. A regression in any of the
 * upstream pieces (provider's `reservedNames` catalog, orchestrator's
 * `buildReservedNodePaths` intersection, the lift transform's sentinel
 * write) would leave the unit test green while the operator-visible
 * behaviour silently disappears. This file pins the WIRING end-to-end.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createKernel, runScan } from '../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../plugins/built-ins.js';
import { RESERVED_TARGET_CONFIDENCE } from '../../kernel/orchestrator/confidence-constants.js';

let fixture: string;

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-reserved-name-e2e-'));
  const write = (rel: string, content: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };

  // Author file invokes a Claude-reserved slash command. The claude
  // provider lists `help` in `reservedNames.command` (see
  // `plugins/claude/providers/claude/index.ts`), so the lift transform
  // downgrades the resolved edge to `RESERVED_TARGET_CONFIDENCE`.
  write(
    '.claude/agents/operator.md',
    [
      '---',
      'name: operator',
      'description: The operator.',
      '---',
      'Run /help for guidance.',
    ].join('\n'),
  );
  // Plant the reserved-name target on disk so the orchestrator
  // intersects it with the provider catalog and adds the path to
  // `ctx.reservedNodePaths`. Without this file there is no node to
  // resolve against, the slash link stays unresolved at 0.8, and no
  // reserved-name issue (target side or source side) is emitted.
  write(
    '.claude/commands/help.md',
    [
      '---',
      'name: help',
      'description: User shadow of the built-in /help.',
      '---',
      'Body.',
    ].join('\n'),
  );
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('core/name-reserved (source side, end-to-end through runScan)', () => {
  it('emits both target-side and source-side warns when a slash link resolves to a reserved name', async () => {
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);

    const result = await runScan(kernel, {
      roots: [fixture],
      extensions: builtIns(),
    });

    // Sanity: the lift transform downgraded the slash link to the
    // sentinel. If this fails the reserved-name analyzer would still
    // see an empty trigger set and emit no source-side issue, which
    // would mask the real regression behind a confusing failure.
    const slashLink = result.links.find(
      (l) =>
        l.source === '.claude/agents/operator.md' &&
        l.kind === 'invokes' &&
        l.target === '/help',
    );
    assert.ok(slashLink, 'expected the /help slash link from operator.md');
    assert.equal(
      slashLink.confidence,
      RESERVED_TARGET_CONFIDENCE,
      '/help must lift to RESERVED_TARGET_CONFIDENCE because help.md is reserved',
    );
    assert.equal(
      slashLink.resolvedTarget,
      '.claude/commands/help.md',
      'lift transform must record the resolved reserved path',
    );

    // Filter to reserved-name issues only; other built-in analyzers
    // (broken-ref, superseded, redundant-target-reference, ...) may
    // also emit on this fixture and are out of scope here.
    const reservedNameIssues = result.issues.filter((i) => i.analyzerId === 'name-reserved');
    assert.equal(
      reservedNameIssues.length,
      2,
      'expected exactly one target-side and one source-side reserved-name issue',
    );

    const targetSide = reservedNameIssues.find(
      (i) => (i.data as Record<string, unknown> | undefined)?.['surface'] === 'target',
    );
    assert.ok(targetSide, 'expected a target-side reserved-name issue');
    assert.equal(targetSide.severity, 'warn');
    assert.deepEqual(targetSide.nodeIds, ['.claude/commands/help.md']);
    assert.deepEqual(targetSide.data, {
      provider: 'claude',
      kind: 'command',
      surface: 'target',
    });

    const sourceSide = reservedNameIssues.find(
      (i) => (i.data as Record<string, unknown> | undefined)?.['surface'] === 'source',
    );
    assert.ok(sourceSide, 'expected a source-side reserved-name issue');
    assert.equal(sourceSide.severity, 'warn');
    assert.deepEqual(
      sourceSide.nodeIds,
      ['.claude/agents/operator.md'],
      'source-side issue is attached to the link source',
    );
    const data = sourceSide.data as Record<string, unknown>;
    assert.equal(data['surface'], 'source');
    assert.equal(data['target'], '/help', 'data.target mirrors the literal link target');
    assert.equal(data['kind'], 'invokes', 'data.kind mirrors the link kind');
    assert.equal(
      data['reservedPath'],
      '.claude/commands/help.md',
      'data.reservedPath points at the node the runtime shadows',
    );
    assert.equal(data['reservedProvider'], 'claude');
    assert.equal(data['reservedKind'], 'command');
    assert.match(sourceSide.message, /Name collision: resolves to a claude built-in/);
    assert.match(sourceSide.message, /confidence 0\.10/);
  });

  it('emits no source-side warn for a slash link that does NOT resolve to a reserved name', async () => {
    // Negative guard: a separate fixture invokes `/no-such-command`,
    // which has no on-disk target and is not in `reservedNames`. The
    // lift transform demotes the genuinely-broken link to the broken
    // floor (0.5, not the reserved 0.1), the reserved-name analyzer must
    // NOT synthesise a source-side issue on this confidence value.
    // Without the sentinel check the rule would over-fire on every
    // broken slash trigger.
    const localFixture = mkdtempSync(join(tmpdir(), 'skill-map-reserved-name-neg-'));
    try {
      const write = (rel: string, content: string): void => {
        const abs = join(localFixture, rel);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, content);
      };
      write(
        '.claude/agents/operator.md',
        [
          '---',
          'name: operator',
          'description: The operator.',
          '---',
          'Run /no-such-command sometimes.',
        ].join('\n'),
      );
      // Plant a reserved-name file (help.md) so the orchestrator's
      // reserved set is non-empty; the slash link still does not
      // resolve to it (different stripped trigger), so the analyzer
      // must stay silent on the source side. The target-side issue
      // for help.md still fires (the file exists and collides).
      write(
        '.claude/commands/help.md',
        [
          '---',
          'name: help',
          'description: User shadow of the built-in /help.',
          '---',
          'Body.',
        ].join('\n'),
      );

      const kernel = createKernel();
      for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
      const result = await runScan(kernel, {
        roots: [localFixture],
        extensions: builtIns(),
      });

      const slashLink = result.links.find(
        (l) =>
          l.source === '.claude/agents/operator.md' &&
          l.kind === 'invokes' &&
          l.target === '/no-such-command',
      );
      assert.ok(slashLink, 'expected the /no-such-command slash link');
      assert.equal(
        slashLink.confidence,
        0.5,
        '/no-such-command is genuinely broken: demoted from the 0.8 slash emit to the broken floor (0.5)',
      );

      const reservedNameIssues = result.issues.filter((i) => i.analyzerId === 'name-reserved');
      const sourceSideIssues = reservedNameIssues.filter(
        (i) => (i.data as Record<string, unknown> | undefined)?.['surface'] === 'source',
      );
      assert.equal(
        sourceSideIssues.length,
        0,
        'no source-side reserved-name issue when the link did not resolve to a reserved target',
      );
      // Sanity: the target-side issue still fires on the planted
      // help.md so the fixture is not silently dropping every
      // reserved-name signal.
      const targetSideIssues = reservedNameIssues.filter(
        (i) => (i.data as Record<string, unknown> | undefined)?.['surface'] === 'target',
      );
      assert.equal(targetSideIssues.length, 1);
      assert.deepEqual(targetSideIssues[0]?.nodeIds, ['.claude/commands/help.md']);
    } finally {
      rmSync(localFixture, { recursive: true, force: true });
    }
  });
});
