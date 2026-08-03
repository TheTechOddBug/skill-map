/**
 * `core/agent-skill/engine.ts`, the `sm agent install / uninstall /
 * status` filesystem engine.
 *
 * Focused on the generated-folder `.gitignore`
 * (`spec/cli-contract.md` §Scope ignore file → Materialised skill
 * folders), the part with the sharpest edges: it must appear on a fresh
 * install, must NOT come back on a refresh (deleting it is how an
 * operator opts into committing the folder), and must stay out of the
 * byte-exact staleness comparison, otherwise that opt-out would report
 * the skill as permanently outdated.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  agentSkillFile,
  agentSkillFolder,
  agentSkillStatus,
  installAgentSkill,
  uninstallAgentSkill,
} from '../engine.js';

const SKILL_DIR = '.claude/skills';

function freshCwd(): string {
  return mkdtempSync(join(tmpdir(), 'sm-agent-skill-'));
}

function ignorePath(cwd: string): string {
  return join(agentSkillFolder(cwd, SKILL_DIR), '.gitignore');
}

describe('installAgentSkill: generated-folder .gitignore', () => {
  it('drops it on a fresh install', () => {
    const cwd = freshCwd();

    assert.equal(installAgentSkill(cwd, SKILL_DIR), 'installed');

    const body = readFileSync(ignorePath(cwd), 'utf8');
    assert.match(body, /^\*$/m);
  });

  it('does not write it again on a refresh the operator opted out of', () => {
    const cwd = freshCwd();
    installAgentSkill(cwd, SKILL_DIR);
    // The operator wants the folder committed.
    rmSync(ignorePath(cwd));
    // Simulate an older / edited copy so the next install is an update.
    writeFileSync(agentSkillFile(cwd, SKILL_DIR), 'stale content', 'utf8');

    assert.equal(installAgentSkill(cwd, SKILL_DIR), 'updated');

    assert.equal(existsSync(ignorePath(cwd)), false);
  });

  it('leaves an operator-authored ignore file alone', () => {
    const cwd = freshCwd();
    installAgentSkill(cwd, SKILL_DIR);
    writeFileSync(ignorePath(cwd), '*.local\n', 'utf8');
    writeFileSync(agentSkillFile(cwd, SKILL_DIR), 'stale content', 'utf8');

    installAgentSkill(cwd, SKILL_DIR);

    assert.equal(readFileSync(ignorePath(cwd), 'utf8'), '*.local\n');
  });

  it('is not part of the staleness comparison', () => {
    const cwd = freshCwd();
    installAgentSkill(cwd, SKILL_DIR);

    rmSync(ignorePath(cwd));

    // Deleting it is a supported opt-out, not a broken install.
    assert.deepEqual(agentSkillStatus(cwd, SKILL_DIR), { installed: true, stale: false });
    assert.equal(installAgentSkill(cwd, SKILL_DIR), 'up-to-date');
  });

  it('goes away with the folder on uninstall', () => {
    const cwd = freshCwd();
    installAgentSkill(cwd, SKILL_DIR);

    assert.equal(uninstallAgentSkill(cwd, SKILL_DIR), true);

    assert.equal(existsSync(agentSkillFolder(cwd, SKILL_DIR)), false);
  });
});
