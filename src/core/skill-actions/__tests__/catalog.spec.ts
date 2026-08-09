/**
 * Unit tests for the skill-action catalog discovery
 * (`core/skill-actions/catalog.ts`, `spec/skill-actions.md` §Discovery):
 * the one-level walk of `<cwd>/.skill-map/.agents/skills/`, the five
 * admission rules (each rejected candidate warns ONCE and never blocks
 * the rest), the version fallback chain, the silent-empty missing
 * folder, the real-directories-only rule (symlinks / stray files
 * ignored), and the name-sorted output.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  assembleSkillActionCatalog,
  emptySkillActionCatalog,
  isSkillActionId,
  SKILL_ACTION_ID_PREFIX,
  skillActionIdFor,
} from '../catalog.js';

let tmpRoot: string;
let counter = 0;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-skill-catalog-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** A fresh project root with its own catalog folder. */
function freshRoot(): string {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  mkdirSync(join(root, '.skill-map', '.agents', 'skills'), { recursive: true });
  return root;
}

/** Write `<root>/.skill-map/.agents/skills/<name>/SKILL.md` verbatim. */
function installSkill(root: string, name: string, content: string): string {
  const dir = join(root, '.skill-map', '.agents', 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), content);
  return dir;
}

function skillMd(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

const VALID_FM = 'name: demo-skill\ndescription: Reviews the target file.';

describe('skill-action id helpers', () => {
  it('prefix, predicate and composer agree', () => {
    assert.equal(SKILL_ACTION_ID_PREFIX, 'skill:');
    assert.equal(skillActionIdFor('review'), 'skill:review');
    assert.equal(isSkillActionId('skill:review'), true);
    assert.equal(isSkillActionId('core/ai-summarizer-action'), false);
    assert.equal(isSkillActionId('action:core/x'), false);
  });
});

describe('assembleSkillActionCatalog', () => {
  it('admits a valid skill: id, name, description, version, verbatim body, dir', () => {
    const root = freshRoot();
    const dir = installSkill(
      root,
      'review',
      skillMd(`${VALID_FM}\nversion: 2.1.0`, 'Review the file.\n\nBe thorough.\n'),
    );
    const warns: string[] = [];
    const catalog = assembleSkillActionCatalog(root, (m) => warns.push(m));
    assert.deepEqual(warns, []);
    assert.equal(catalog.entries.length, 1);
    const entry = catalog.entries[0]!;
    assert.equal(entry.id, 'skill:review');
    assert.equal(entry.name, 'demo-skill');
    assert.equal(entry.description, 'Reviews the target file.');
    assert.equal(entry.version, '2.1.0');
    // Body verbatim: content after the frontmatter fence, untrimmed.
    assert.equal(entry.body, 'Review the file.\n\nBe thorough.\n');
    assert.equal(entry.dir, dir);
    assert.equal(catalog.byId.get('skill:review'), entry);
  });

  it('skips (one warn each) every admission-rule defect without blocking siblings', () => {
    const root = freshRoot();
    installSkill(root, 'no-name', skillMd('description: d', 'Body.\n'));
    installSkill(root, 'no-description', skillMd('name: n', 'Body.\n'));
    installSkill(root, 'empty-body', skillMd(VALID_FM, '   \n\n'));
    installSkill(root, 'delimiter', skillMd(VALID_FM, 'Do X. <USER-CONTENT id="x">\n'));
    installSkill(root, 'placeholder', skillMd(VALID_FM, 'Insert {{userContent}} here.\n'));
    installSkill(root, 'ok', skillMd(VALID_FM, 'Body.\n'));
    const warns: string[] = [];
    const catalog = assembleSkillActionCatalog(root, (m) => warns.push(m));
    // The defective five each warned exactly once; the valid one landed.
    assert.equal(warns.length, 5);
    assert.deepEqual(
      catalog.entries.map((e) => e.id),
      ['skill:ok'],
    );
    const warnFor = (dir: string): string | undefined => warns.find((w) => w.includes(dir));
    assert.match(warnFor('no-name') ?? '', /name/);
    assert.match(warnFor('no-description') ?? '', /description/);
    assert.match(warnFor('empty-body') ?? '', /body is empty/);
    assert.match(warnFor('delimiter') ?? '', /<user-content/);
    assert.match(warnFor('placeholder') ?? '', /placeholder/);
  });

  it('version fallback chain: version string, then metadata.version, then 0.0.0', () => {
    const root = freshRoot();
    installSkill(root, 'direct', skillMd(`${VALID_FM}\nversion: 1.2.3`, 'B\n'));
    installSkill(
      root,
      'nested',
      skillMd(`${VALID_FM}\nmetadata:\n  version: 4.5.6`, 'B\n'),
    );
    installSkill(root, 'neither', skillMd(VALID_FM, 'B\n'));
    // A non-string `version` falls through to the string `metadata.version`.
    installSkill(
      root,
      'non-string',
      skillMd(`${VALID_FM}\nversion: 7\nmetadata:\n  version: 8.9.0`, 'B\n'),
    );
    const catalog = assembleSkillActionCatalog(root, () => {});
    const version = (name: string): string | undefined =>
      catalog.byId.get(`skill:${name}`)?.version;
    assert.equal(version('direct'), '1.2.3');
    assert.equal(version('nested'), '4.5.6');
    assert.equal(version('neither'), '0.0.0');
    assert.equal(version('non-string'), '8.9.0');
  });

  it('missing catalog folder: empty catalog, silently', () => {
    counter += 1;
    const bare = join(tmpRoot, `bare-${counter}`);
    mkdirSync(bare, { recursive: true });
    const warns: string[] = [];
    const catalog = assembleSkillActionCatalog(bare, (m) => warns.push(m));
    assert.deepEqual(warns, []);
    assert.deepEqual(catalog.entries, []);
    assert.equal(catalog.byId.size, 0);
  });

  it('ignores non-directory children, symlinked dirs, and SKILL.md-less dirs, silently', () => {
    const root = freshRoot();
    const store = join(root, '.skill-map', '.agents', 'skills');
    installSkill(root, 'real', skillMd(VALID_FM, 'B\n'));
    // Installer side artifacts: a stray lock file and a symlink mirror to
    // the real skill (following it would surface the skill twice).
    writeFileSync(join(store, 'skills-lock.json'), '{}');
    symlinkSync(join(store, 'real'), join(store, 'mirror'));
    // A directory with no SKILL.md is not a candidate at all (§Discovery),
    // so it never warns.
    mkdirSync(join(store, 'not-a-skill'));
    const warns: string[] = [];
    const catalog = assembleSkillActionCatalog(root, (m) => warns.push(m));
    assert.deepEqual(warns, []);
    assert.deepEqual(
      catalog.entries.map((e) => e.id),
      ['skill:real'],
    );
  });

  it('sorts entries by name for stable output', () => {
    const root = freshRoot();
    installSkill(root, 'dir-z', skillMd('name: alpha\ndescription: d', 'B\n'));
    installSkill(root, 'dir-a', skillMd('name: zulu\ndescription: d', 'B\n'));
    installSkill(root, 'dir-m', skillMd('name: mike\ndescription: d', 'B\n'));
    const catalog = assembleSkillActionCatalog(root, () => {});
    assert.deepEqual(
      catalog.entries.map((e) => e.name),
      ['alpha', 'mike', 'zulu'],
    );
  });
});

describe('emptySkillActionCatalog', () => {
  it('returns a catalog with no entries and an empty index', () => {
    const empty = emptySkillActionCatalog();
    assert.deepEqual(empty.entries, []);
    assert.equal(empty.byId.size, 0);
  });
});
