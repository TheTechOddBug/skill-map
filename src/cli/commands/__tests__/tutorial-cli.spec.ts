/**
 * `sm tutorial` end-to-end through the real binary. Each test isolates
 * cwd so the host's working directory is never touched.
 *
 * Spec contract under test (spec/cli-contract.md § `sm tutorial`):
 *
 *   - `sm tutorial`                  → writes <cwd>/.claude/skills/sm-tutorial/, exit 0.
 *   - `sm tutorial` (clobber)        → exits 2, does NOT overwrite.
 *   - `sm tutorial --force`          → overwrites existing dir, exit 0.
 *   - `sm tutorial master`           → writes <cwd>/.claude/skills/sm-master/, exit 0.
 *   - `sm tutorial master`           → also ships the references/ sub-folder.
 *   - `sm tutorial master` (clobber) → exits 2, does NOT overwrite.
 *   - `sm tutorial master --force`   → overwrites existing dir, exit 0.
 *   - `sm tutorial garbage`          → exits 2, emits `invalidVariant`.
 *   - SKILL.md and references/* match the canonical sources byte-for-byte.
 *   - No `.skill-map/` is required (verb runs in a virgin dir).
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', '..', '..', 'bin', 'sm.js');

// Repo root → .claude/skills/<slug>/ are the source-of-truth folders
// the verb materializes. From src/test/ that's three levels up.
const SKILL_SOURCE_TUTORIAL = resolve(
  HERE,
  '..', '..', '..',
  '..',
  '.claude',
  'skills',
  'sm-tutorial',
);
const SKILL_SOURCE_MASTER = resolve(
  HERE,
  '..', '..', '..',
  '..',
  '.claude',
  'skills',
  'sm-master',
);

let root: string;
let counter = 0;

interface IScope {
  cwd: string;
}

function freshScope(label: string): IScope {
  counter += 1;
  const cwd = join(root, `${label}-${counter}`);
  mkdirSync(cwd, { recursive: true });
  return { cwd };
}

function sm(
  args: string[],
  scope: IScope,
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/**
 * Walk both `expectedDir` and `actualDir` and assert every file matches
 * byte-for-byte, with the same relative tree. Used by the byte-match
 * tests to lock the entire skill payload (SKILL.md + references/*).
 */
function assertDirsEqual(expectedDir: string, actualDir: string): void {
  const walk = (root: string): string[] => {
    const out: string[] = [];
    const stack: string[] = [root];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const entry of readdirSync(cur)) {
        const full = join(cur, entry);
        const st = statSync(full);
        if (st.isDirectory()) stack.push(full);
        else out.push(relative(root, full));
      }
    }
    return out.sort();
  };
  const expected = walk(expectedDir);
  const actual = walk(actualDir);
  assert.deepEqual(actual, expected, 'file inventory differs');
  for (const rel of expected) {
    const e = readFileSync(join(expectedDir, rel));
    const a = readFileSync(join(actualDir, rel));
    assert.deepEqual(a, e, `byte mismatch: ${rel}`);
  }
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-tutorial-'));
  // Sanity: the source dirs must exist for these tests to be
  // meaningful. If they do not, the verb's bundled-loader fallback
  // would still resolve them from dist/, but the byte-for-byte
  // assertions below would lose their anchor, so fail fast here
  // instead.
  assert.ok(
    existsSync(SKILL_SOURCE_TUTORIAL) && statSync(SKILL_SOURCE_TUTORIAL).isDirectory(),
    `sm-tutorial source missing at ${SKILL_SOURCE_TUTORIAL}`,
  );
  assert.ok(
    existsSync(SKILL_SOURCE_MASTER) && statSync(SKILL_SOURCE_MASTER).isDirectory(),
    `sm-master source missing at ${SKILL_SOURCE_MASTER}`,
  );
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sm tutorial, happy path', () => {
  it('writes .claude/skills/sm-tutorial/ in cwd with exit 0 and the success line', () => {
    const scope = freshScope('basic');
    const r = sm(['tutorial'], scope);

    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const target = join(scope.cwd, '.claude', 'skills', 'sm-tutorial');
    assert.ok(existsSync(target), 'skill directory must be written');
    assert.ok(statSync(target).isDirectory(), 'target must be a directory');
    assert.ok(existsSync(join(target, 'SKILL.md')), 'SKILL.md must be inside');

    // Success message mentions the skill slug and the relative path.
    assert.match(r.stdout, /Skill `sm-tutorial`/);
    assert.match(r.stdout, /\.claude\/skills\/sm-tutorial\//);
    assert.match(r.stdout, /Open Claude Code/);
  });

  it('content matches the canonical sm-tutorial folder byte-for-byte', () => {
    const scope = freshScope('byte-match');
    const r = sm(['tutorial'], scope);
    assert.equal(r.status, 0);

    const target = join(scope.cwd, '.claude', 'skills', 'sm-tutorial');
    assertDirsEqual(SKILL_SOURCE_TUTORIAL, target);
  });

  it('runs in a virgin directory (no .skill-map/ required)', () => {
    const scope = freshScope('virgin');
    // Sanity: confirm there's no .skill-map/ in the scope.
    assert.equal(existsSync(join(scope.cwd, '.skill-map')), false);

    const r = sm(['tutorial'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(existsSync(join(scope.cwd, '.claude', 'skills', 'sm-tutorial', 'SKILL.md')));
    // And still no .skill-map/, the verb must not bootstrap one.
    assert.equal(existsSync(join(scope.cwd, '.skill-map')), false);
  });

  it('creates `.claude/skills/<slug>/` (no other files at cwd top level)', () => {
    const scope = freshScope('top-level');
    const r = sm(['tutorial'], scope);
    assert.equal(r.status, 0);

    // No legacy single-file artifact.
    assert.equal(existsSync(join(scope.cwd, 'sm-tutorial.md')), false);
    assert.equal(existsSync(join(scope.cwd, '.sm-tutorial')), false);
    // The skill directory IS created.
    assert.ok(existsSync(join(scope.cwd, '.claude', 'skills', 'sm-tutorial')));
  });

  it('explicit `sm tutorial tutorial` behaves the same as no positional', () => {
    const scope = freshScope('explicit-default');
    const r = sm(['tutorial', 'tutorial'], scope);

    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const target = join(scope.cwd, '.claude', 'skills', 'sm-tutorial');
    assert.ok(existsSync(target), 'skill directory must be written');
    assertDirsEqual(SKILL_SOURCE_TUTORIAL, target);
  });
});

describe('sm tutorial, clobber protection', () => {
  it('exits 2 when the skill directory already exists and --force is not passed', () => {
    const scope = freshScope('clobber-blocked');
    const target = join(scope.cwd, '.claude', 'skills', 'sm-tutorial');
    mkdirSync(target, { recursive: true });
    const sentinel = join(target, 'SKILL.md');
    const sentinelBody = '# pre-existing content, must NOT be overwritten\n';
    writeFileSync(sentinel, sentinelBody);

    const r = sm(['tutorial'], scope);

    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /already exists/);
    assert.match(r.stderr, /--force/);

    // File untouched.
    assert.equal(readFileSync(sentinel, 'utf8'), sentinelBody);
  });

  it('--force overwrites an existing skill directory and exits 0', () => {
    const scope = freshScope('clobber-force');
    const target = join(scope.cwd, '.claude', 'skills', 'sm-tutorial');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'SKILL.md'), '# stale content\n');
    // Also drop a sentinel file that's NOT part of the canonical skill;
    // it must be wiped by --force so the result matches the source
    // folder byte-for-byte (no leftovers from the previous payload).
    writeFileSync(join(target, 'stale-leftover.md'), '# stale\n');

    const r = sm(['tutorial', '--force'], scope);

    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assertDirsEqual(SKILL_SOURCE_TUTORIAL, target);
    assert.equal(
      existsSync(join(target, 'stale-leftover.md')),
      false,
      '--force must wipe leftovers from the prior payload',
    );
  });
});

describe('sm tutorial master, happy path', () => {
  it('writes .claude/skills/sm-master/ in cwd with exit 0 and the success line', () => {
    const scope = freshScope('master-basic');
    const r = sm(['tutorial', 'master'], scope);

    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const target = join(scope.cwd, '.claude', 'skills', 'sm-master');
    assert.ok(existsSync(target), 'sm-master skill directory must be written');
    assert.ok(existsSync(join(target, 'SKILL.md')), 'SKILL.md must be inside');

    // The basic variant's directory is NOT written by this variant.
    assert.equal(existsSync(join(scope.cwd, '.claude', 'skills', 'sm-tutorial')), false);

    // Success message points the tester at the master skill.
    assert.match(r.stdout, /Skill `sm-master`/);
    assert.match(r.stdout, /\.claude\/skills\/sm-master\//);
    assert.match(r.stdout, /Open Claude Code/);
  });

  it('ships the references/ sub-folder (the core of this fix)', () => {
    const scope = freshScope('master-references');
    const r = sm(['tutorial', 'master'], scope);
    assert.equal(r.status, 0);

    const refsDir = join(scope.cwd, '.claude', 'skills', 'sm-master', 'references');
    assert.ok(existsSync(refsDir), 'references/ folder must be materialized');
    assert.ok(statSync(refsDir).isDirectory(), 'references/ must be a directory');
    // At least one reference file must be present (the count depends
    // on the canonical sm-master payload at runtime).
    const refs = readdirSync(refsDir);
    assert.ok(refs.length > 0, 'references/ must not be empty');
  });

  it('content matches the canonical sm-master folder byte-for-byte', () => {
    const scope = freshScope('master-byte-match');
    const r = sm(['tutorial', 'master'], scope);
    assert.equal(r.status, 0);

    const target = join(scope.cwd, '.claude', 'skills', 'sm-master');
    assertDirsEqual(SKILL_SOURCE_MASTER, target);
  });
});

describe('sm tutorial master, clobber protection', () => {
  it('exits 2 when the sm-master directory already exists and --force is not passed', () => {
    const scope = freshScope('master-clobber-blocked');
    const target = join(scope.cwd, '.claude', 'skills', 'sm-master');
    mkdirSync(target, { recursive: true });
    const sentinel = join(target, 'SKILL.md');
    const sentinelBody = '# pre-existing content, must NOT be overwritten\n';
    writeFileSync(sentinel, sentinelBody);

    const r = sm(['tutorial', 'master'], scope);

    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /already exists/);
    assert.match(r.stderr, /--force/);

    // File untouched.
    assert.equal(readFileSync(sentinel, 'utf8'), sentinelBody);
  });

  it('--force overwrites an existing sm-master directory and exits 0', () => {
    const scope = freshScope('master-clobber-force');
    const target = join(scope.cwd, '.claude', 'skills', 'sm-master');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'SKILL.md'), '# stale master content\n');

    const r = sm(['tutorial', 'master', '--force'], scope);

    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assertDirsEqual(SKILL_SOURCE_MASTER, target);
  });
});

describe('sm tutorial, invalid variant', () => {
  it('exits 2 and emits the invalidVariant error for an unknown variant', () => {
    const scope = freshScope('invalid-variant');
    const r = sm(['tutorial', 'garbage'], scope);

    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /unknown variant 'garbage'/);
    assert.match(r.stderr, /Valid values: tutorial \(default\), master\./);

    // Defensive: nothing should have been written to cwd.
    assert.equal(existsSync(join(scope.cwd, '.claude')), false);
    assert.equal(existsSync(join(scope.cwd, 'sm-tutorial.md')), false);
    assert.equal(existsSync(join(scope.cwd, 'sm-master.md')), false);
  });
});
