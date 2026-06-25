/**
 * End-to-end coverage for SELF-scope reserved-name detection
 * (spec/architecture.md §Provider · reservedNames), exercised through
 * `runScan` so the full pipeline participates.
 *
 * A runtime that adopts the open `.agents/skills/` standard reuses the
 * `agent-skills` classifier in its OWN manifest (manifest composition,
 * not a kernel rule), so under its lens the skills are classified with ITS
 * provider id and self scope catches collisions with its reserved
 * built-ins. Antigravity is exactly this shape: it reuses the open-standard
 * classifier and reserves `agy`'s built-in slash commands under `skill`.
 * Under the antigravity lens, `.agents/skills/goal/SKILL.md` classifies as
 * `antigravity`/`skill`, so self scope flags it (`/goal` is built-in).
 *
 * The negative cases pin the gating: a non-colliding skill is never
 * flagged, and the SAME colliding skill is silent under another lens
 * (antigravity is gated off, so the file falls through to `core/markdown`
 * and there is no `antigravity/skill` node to flag).
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
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-reserved-self-e2e-'));
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
  // `help` is a UNIVERSAL slash command in the open-standard base catalog
  // (`COMMONS_RESERVED_NAMES`, owned by agent-skills), so it flags under
  // any standard lens, including the neutral agent-skills lens.
  write('.agents/skills/help/SKILL.md', skill('help', 'User skill that shadows the universal /help.'));
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

describe('core/name-reserved (self scope, end-to-end through runScan)', () => {
  it('flags a skill that shadows an Antigravity built-in under the antigravity lens', async () => {
    const result = await scan('antigravity');

    const goalIssues = reservedFor(result.issues, '.agents/skills/goal/SKILL.md');
    assert.equal(goalIssues.length, 1, 'expected one reserved-name warn on the goal skill');
    const issue = goalIssues[0] as unknown as {
      severity: string;
      data: Record<string, unknown>;
    };
    assert.equal(issue.severity, 'warn');
    // The antigravity lens classifies the skill itself (inherited
    // open-standard classifier), so the node carries provider 'antigravity'
    // and self scope flags it.
    assert.equal(issue.data['surface'], 'target');
    assert.equal(issue.data['provider'], 'antigravity');
    assert.equal(issue.data['kind'], 'skill');
  });

  it('does NOT flag a non-colliding skill under the antigravity lens', async () => {
    const result = await scan('antigravity');
    assert.equal(reservedFor(result.issues, '.agents/skills/deploy/SKILL.md').length, 0);
  });

  it('does NOT flag the colliding skill under another lens', async () => {
    // No explicit lens. Both agent-skills and antigravity are experimental
    // (ships disabled) and gated, so nothing auto-detects and the scan runs
    // unlensed: `.agents/skills/goal/SKILL.md` falls through to
    // `core/markdown`, so there is no `antigravity/skill` node to flag.
    const result = await scan(null);
    assert.equal(reservedFor(result.issues, '.agents/skills/goal/SKILL.md').length, 0);
  });
});

describe('core/name-reserved (open-standard base, under the agent-skills lens)', () => {
  it('flags a skill shadowing a UNIVERSAL base verb under the agent-skills lens', async () => {
    const result = await scan('agent-skills');

    const helpIssues = reservedFor(result.issues, '.agents/skills/help/SKILL.md');
    assert.equal(helpIssues.length, 1, 'expected one reserved-name warn on the help skill');
    const issue = helpIssues[0] as unknown as {
      severity: string;
      data: Record<string, unknown>;
    };
    assert.equal(issue.severity, 'warn');
    // The agent-skills lens classifies the skill itself (open-standard
    // classifier), so the node carries provider 'agent-skills' and self
    // scope flags it against the base catalog it owns.
    assert.equal(issue.data['surface'], 'target');
    assert.equal(issue.data['provider'], 'agent-skills');
    assert.equal(issue.data['kind'], 'skill');
  });

  it('does NOT flag a VENDOR-specific verb (goal) under the agent-skills lens', async () => {
    // `goal` is Antigravity-specific, not part of the open-standard base,
    // so the neutral agent-skills lens leaves it alone (only antigravity reserves it).
    const result = await scan('agent-skills');
    assert.equal(reservedFor(result.issues, '.agents/skills/goal/SKILL.md').length, 0);
  });
});
