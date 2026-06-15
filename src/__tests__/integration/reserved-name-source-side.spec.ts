/**
 * End-to-end coverage for the `core/name-reserved` analyzer's
 * source-side surface, exercised through `runScan` so the full
 * orchestrator pipeline participates: discovery (claude provider) →
 * slash extractor (target=/help) → kernel 1.0 baseline + post-walk lift
 * (resolves `/help` against the planted `.claude/commands/help.md`,
 * records the resolved path; the orchestrator confirms it is in
 * `ctx.reservedNodePaths`) → `core/name-reserved` score phase (applies
 * `delta -RESERVED_PENALTY`, folding the kernel baseline 1.0 down to 0.1)
 * + reserved-name analyzer (emits target-side + source-side warns).
 *
 * Why a dedicated integration test (companion to the unit test in
 * `plugins/core/analyzers/reserved-name/__tests__/reserved-name.spec.ts`):
 * the unit test exercises `evaluate()` with a hand-built ctx whose
 * `reservedNodePaths` is preloaded and whose links are synthesised. A
 * regression in any of the upstream pieces (provider's `reservedNames`
 * catalog, orchestrator's `buildReservedNodePaths` intersection, the
 * lift transform's resolved-target write) would leave the unit test green
 * while the operator-visible behaviour silently disappears. This file
 * pins the WIRING end-to-end, including the final folded confidence
 * (`RESERVED_TARGET = 1.0 - RESERVED_PENALTY = 0.1`).
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createKernel, runScan } from '../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../plugins/built-ins.js';
import {
  BROKEN_PENALTY,
  RESERVED_PENALTY,
} from '../../kernel/orchestrator/confidence-constants.js';

// Final folded confidences: every link starts at the kernel's 1.0
// baseline and a built-in score-phase detector subtracts its penalty.
const RESERVED_CONFIDENCE = 1.0 - RESERVED_PENALTY; // 0.1
const BROKEN_CONFIDENCE = 1.0 - BROKEN_PENALTY; // 0.5

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
  // `plugins/claude/providers/claude/index.ts`), so `core/name-reserved`
  // subtracts `RESERVED_PENALTY` from the kernel's 1.0 baseline, folding
  // the resolved edge down to 0.1.
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

    // Sanity: the score phase folded the slash link down to the reserved
    // confidence. If this fails the reserved-name analyzer would still
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
      RESERVED_CONFIDENCE,
      '/help must fold to 0.1 (kernel 1.0 baseline minus RESERVED_PENALTY) because help.md is reserved',
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
    assert.match(sourceSide.message, /Reserved name; resolves to the claude built-in/);
    assert.match(sourceSide.message, /the built-in shadows this edge/);
  });

  it('emits no source-side warn for a slash link that does NOT resolve to a reserved name', async () => {
    // Negative guard: a separate fixture invokes `/no-such-command`,
    // which has no on-disk target and is not in `reservedNames`.
    // `core/reference-broken` subtracts BROKEN_PENALTY, folding the
    // genuinely-broken link to the broken floor (0.5, not the reserved
    // 0.1); the reserved-name analyzer must NOT synthesise a source-side
    // issue on this confidence value. Without the resolved-target check
    // the rule would over-fire on every broken slash trigger.
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
        BROKEN_CONFIDENCE,
        '/no-such-command is genuinely broken: kernel 1.0 baseline minus BROKEN_PENALTY → 0.5',
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

// The decomposition's headline capability: each rule's confidence op
// follows its detector, so DISABLING the detector also drops its score
// effect (the link falls back to the kernel's 1.0 baseline, no penalty),
// symmetric for reserved and broken. These pin "off = baseline"
// end-to-end through `runScan`, the only place the toggle-out is
// observable.

/** The built-in extension set with one analyzer removed (the toggle-out). */
function withoutAnalyzer(id: string): ReturnType<typeof builtIns> {
  const exts = builtIns();
  return { ...exts, analyzers: exts.analyzers.filter((a) => a.id !== id) };
}

describe('symmetric disable: confidence follows the detector', () => {
  it('name-reserved disabled → the reserved link is NOT downgraded (keeps the kernel baseline)', async () => {
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
    const result = await runScan(kernel, {
      roots: [fixture],
      extensions: withoutAnalyzer('name-reserved'),
    });
    const slashLink = result.links.find(
      (l) => l.source === '.claude/agents/operator.md' && l.target === '/help',
    );
    assert.ok(slashLink, 'expected the /help slash link');
    // name-reserved owns the -RESERVED_PENALTY delta now. With it off,
    // nothing subtracts from the kernel's 1.0 baseline, so the resolved
    // (but reserved) edge stays at 1.0, not 0.1.
    assert.notEqual(slashLink.confidence, RESERVED_CONFIDENCE);
    assert.equal(slashLink.confidence, 1.0);
    // ...and the warn is gone too (the rule no longer runs).
    const reservedWarns = result.issues.filter((i) => i.analyzerId === 'name-reserved');
    assert.equal(reservedWarns.length, 0, 'no reserved warn when the detector is off');
  });

  it('reference-broken disabled → the broken link is NOT penalised (keeps the kernel baseline)', async () => {
    const local = mkdtempSync(join(tmpdir(), 'skill-map-broken-disable-'));
    try {
      const abs = join(local, '.claude/agents/op.md');
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(
        abs,
        ['---', 'name: op', 'description: op.', '---', 'Run /no-such-command.'].join('\n'),
      );
      const kernel = createKernel();
      for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
      const result = await runScan(kernel, {
        roots: [local],
        extensions: withoutAnalyzer('reference-broken'),
      });
      const brokenLink = result.links.find((l) => l.target === '/no-such-command');
      assert.ok(brokenLink, 'expected the /no-such-command slash link');
      // reference-broken owns the -BROKEN_PENALTY delta now. With it off,
      // nothing subtracts from the kernel's 1.0 baseline, so the broken
      // edge stays at 1.0, not 0.5.
      assert.notEqual(brokenLink.confidence, BROKEN_CONFIDENCE);
      assert.equal(brokenLink.confidence, 1.0);
      // ...and no broken error either.
      const brokenErrors = result.issues.filter((i) => i.analyzerId === 'reference-broken');
      assert.equal(brokenErrors.length, 0, 'no broken error when the detector is off');
    } finally {
      rmSync(local, { recursive: true, force: true });
    }
  });
});
