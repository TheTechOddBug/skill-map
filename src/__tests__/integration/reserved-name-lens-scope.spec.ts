/**
 * End-to-end coverage for the LENS SCOPE of reserved-name detection
 * (spec/architecture.md §Provider · reservedNames), exercised through
 * `runScan` so the full pipeline participates: `agent-skills` classifies
 * `.agents/skills/<name>/SKILL.md` as `skill` → the orchestrator's
 * `buildReservedNodePaths` lends the active lens's catalog to those
 * universal skill nodes → `core/name-reserved` projects a warn.
 *
 * The Antigravity Provider classifies nothing itself (metadata-only) and
 * reserves `agy`'s built-in slash commands under `skill`. Self scope alone
 * would never reach the skill nodes (they are `provider: 'agent-skills'`,
 * not `provider: 'antigravity'`); only the lens scope, active when
 * `activeProvider === 'antigravity'`, catches the collision. The negative
 * cases pin the gating: a non-colliding skill is never flagged, and the
 * SAME colliding skill is silent under a non-Antigravity lens.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createKernel, runScan } from '../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../plugins/built-ins.js';

let fixture: string;

const skill = (name: string, description: string): string =>
  ['---', `name: ${name}`, `description: ${description}`, '---', 'Body.'].join('\n');

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-reserved-lens-e2e-'));
  const write = (rel: string, content: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };

  // `goal` shadows Antigravity's built-in `/goal` slash command (declared
  // in the antigravity Provider's `reservedNames.skill`).
  write('.agents/skills/goal/SKILL.md', skill('goal', 'User skill that shadows /goal.'));
  // `deploy` is not a built-in, negative control that must never flag.
  write('.agents/skills/deploy/SKILL.md', skill('deploy', 'Deploy to staging or prod.'));
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

const scan = (activeProvider: string | null) => {
  const kernel = createKernel();
  for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
  return runScan(kernel, {
    roots: [fixture],
    extensions: builtIns(),
    ...(activeProvider === null ? {} : { activeProvider }),
  });
};

const reservedFor = (issues: readonly { analyzerId: string; nodeIds: readonly string[] }[], path: string) =>
  issues.filter((i) => i.analyzerId === 'name-reserved' && i.nodeIds.includes(path));

describe('core/name-reserved (lens scope, end-to-end through runScan)', () => {
  it('flags an agent-skills skill that shadows an Antigravity built-in when the lens is antigravity', async () => {
    const result = await scan('antigravity');

    const goalIssues = reservedFor(result.issues, '.agents/skills/goal/SKILL.md');
    assert.equal(goalIssues.length, 1, 'expected one reserved-name warn on the goal skill');
    const issue = goalIssues[0] as unknown as {
      severity: string;
      data: Record<string, unknown>;
    };
    assert.equal(issue.severity, 'warn');
    // The issue is attached to the agent-skills skill node it shadows; the
    // lens (antigravity) is what reserved the name, but the node keeps its
    // own provider/kind in the issue payload.
    assert.equal(issue.data['surface'], 'target');
    assert.equal(issue.data['provider'], 'agent-skills');
    assert.equal(issue.data['kind'], 'skill');
  });

  it('does NOT flag a non-colliding skill under the antigravity lens', async () => {
    const result = await scan('antigravity');
    assert.equal(reservedFor(result.issues, '.agents/skills/deploy/SKILL.md').length, 0);
  });

  it('does NOT flag the colliding skill under a non-Antigravity lens (no lens resolved)', async () => {
    // No explicit lens. `agent-skills` is coming-soon, so `.agents/`
    // no longer auto-detects a lens and the scan runs unlensed; either
    // way the Antigravity catalog only reserves names when antigravity
    // IS the lens, so the collision is not flagged.
    const result = await scan(null);
    assert.equal(reservedFor(result.issues, '.agents/skills/goal/SKILL.md').length, 0);
  });
});
