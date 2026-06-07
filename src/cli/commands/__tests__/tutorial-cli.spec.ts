/**
 * `sm tutorial` end-to-end through the real binary. Each test isolates
 * cwd so the host's working directory is never touched.
 *
 * Spec contract under test (spec/cli-contract.md § `sm tutorial`):
 *
 *   - `sm tutorial`                  → writes <cwd>/.claude/skills/sm-tutorial/, exit 0.
 *                                      (empty cwd; non-interactive stdin → default provider: claude.)
 *   - `sm tutorial` (non-empty cwd)  → exits 2, writes nothing.
 *   - `sm tutorial --force` (non-empty) → seeds anyway, exit 0, leaves unrelated content.
 *   - `sm tutorial`                  → ships the references/ sub-folder.
 *   - `sm tutorial master`/`garbage` → exits 2, emits `legacyPositional`.
 *   - `sm tutorial --for agent-skills` → writes <cwd>/.agents/skills/sm-tutorial/, exit 0.
 *   - `sm tutorial --for garbage`    → exits 2, emits `forUnknown`.
 *   - `sm tutorial` (empty cwd, no marker) → defaults to Claude.
 *   - SKILL.md and references/* match the canonical source byte-for-byte.
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

// Repo root → .claude/skills/sm-tutorial/ is the source-of-truth folder
// the verb materializes. From src/test/ that's four levels up.
const SKILL_SOURCE_TUTORIAL = resolve(
  HERE,
  '..', '..', '..',
  '..',
  '.claude',
  'skills',
  'sm-tutorial',
);

let root: string;
let counter = 0;

interface IScope {
  cwd: string;
  home: string;
}

// `cwd` and `home` are siblings under a per-test parent so the cwd stays
// empty (the verb requires it) while `home` isolates the spawned binary
// from the developer's real `~/.skill-map/settings.json`. Without the
// isolation the binary reads the developer's telemetry opt-in and the
// entry point fires a PostHog usage event per invocation, matching the
// other CLI spawn-specs (init / list / config).
function freshScope(label: string): IScope {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  const cwd = join(dir, 'cwd');
  const home = join(dir, 'home');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { cwd, home };
}

function sm(
  args: string[],
  scope: IScope,
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    // Isolate HOME so the spawned binary reads an empty
    // `~/.skill-map/settings.json` (no telemetry opt-in → the usage
    // surface stays dormant), regardless of how the spec is invoked.
    env: { ...process.env, HOME: scope.home, USERPROFILE: scope.home, NO_COLOR: '1' },
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
    assert.match(r.stdout, /Open your coding agent/);
  });

  it('content matches the canonical sm-tutorial folder byte-for-byte', () => {
    const scope = freshScope('byte-match');
    const r = sm(['tutorial'], scope);
    assert.equal(r.status, 0);

    const target = join(scope.cwd, '.claude', 'skills', 'sm-tutorial');
    assertDirsEqual(SKILL_SOURCE_TUTORIAL, target);
  });

  it('always ships the references/ sub-folder', () => {
    const scope = freshScope('references');
    const r = sm(['tutorial'], scope);
    assert.equal(r.status, 0);

    const refsDir = join(scope.cwd, '.claude', 'skills', 'sm-tutorial', 'references');
    assert.ok(existsSync(refsDir), 'references/ folder must be materialized');
    assert.ok(statSync(refsDir).isDirectory(), 'references/ must be a directory');
    // At least one reference file must be present (the count depends
    // on the canonical sm-tutorial payload at runtime).
    const refs = readdirSync(refsDir);
    assert.ok(refs.length > 0, 'references/ must not be empty');
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
});

describe('sm tutorial, empty-directory guard', () => {
  it('exits 2 and writes nothing when the cwd holds unrelated user content', () => {
    const scope = freshScope('not-empty-blocked');
    const userFile = join(scope.cwd, 'my-notes.md');
    const userBody = '# my own work, must NOT be touched\n';
    writeFileSync(userFile, userBody);

    const r = sm(['tutorial'], scope);

    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /not empty/);
    assert.match(r.stderr, /--force/);

    // Nothing scaffolded, user content untouched.
    assert.equal(existsSync(join(scope.cwd, '.claude')), false);
    assert.equal(readFileSync(userFile, 'utf8'), userBody);
  });

  it('exits 2 when the skill directory already exists (subsumed by the empty guard)', () => {
    const scope = freshScope('clobber-blocked');
    const target = join(scope.cwd, '.claude', 'skills', 'sm-tutorial');
    mkdirSync(target, { recursive: true });
    const sentinel = join(target, 'SKILL.md');
    const sentinelBody = '# pre-existing content, must NOT be overwritten\n';
    writeFileSync(sentinel, sentinelBody);

    const r = sm(['tutorial'], scope);

    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /not empty/);
    assert.match(r.stderr, /--force/);

    // File untouched (the guard fires before any write).
    assert.equal(readFileSync(sentinel, 'utf8'), sentinelBody);
  });

  it('--force seeds into a non-empty cwd, overwrites the target, leaves other content', () => {
    const scope = freshScope('clobber-force');
    const target = join(scope.cwd, '.claude', 'skills', 'sm-tutorial');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'SKILL.md'), '# stale content\n');
    // A sentinel NOT part of the canonical skill: --force must wipe it so
    // the target matches the source byte-for-byte (no payload leftovers).
    writeFileSync(join(target, 'stale-leftover.md'), '# stale\n');
    // Unrelated user content at the cwd top level: --force must NOT touch it.
    const userFile = join(scope.cwd, 'my-notes.md');
    writeFileSync(userFile, '# keep me\n');

    const r = sm(['tutorial', '--force'], scope);

    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assertDirsEqual(SKILL_SOURCE_TUTORIAL, target);
    assert.equal(
      existsSync(join(target, 'stale-leftover.md')),
      false,
      '--force must wipe leftovers from the prior payload',
    );
    // Unrelated content survives: --force only wipes the target skill dir.
    assert.equal(readFileSync(userFile, 'utf8'), '# keep me\n');
  });
});

describe('sm tutorial, legacy positional argument', () => {
  it('exits 2 and emits the legacyPositional error for the retired `master` arg', () => {
    const scope = freshScope('legacy-master');
    const r = sm(['tutorial', 'master'], scope);

    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /unexpected argument 'master'/);
    assert.match(r.stderr, /no positional argument/);
    assert.match(r.stderr, /in-skill menu/);

    // Defensive: nothing should have been written to cwd.
    assert.equal(existsSync(join(scope.cwd, '.claude')), false);
  });

  it('exits 2 and emits the legacyPositional error for any other positional', () => {
    const scope = freshScope('legacy-garbage');
    const r = sm(['tutorial', 'garbage'], scope);

    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /unexpected argument 'garbage'/);
    assert.match(r.stderr, /no positional argument/);

    // Defensive: nothing should have been written to cwd.
    assert.equal(existsSync(join(scope.cwd, '.claude')), false);
    assert.equal(existsSync(join(scope.cwd, 'sm-tutorial.md')), false);
  });
});

describe('sm tutorial, --for provider selection', () => {
  it('writes under the open-standard territory with --for agent-skills', () => {
    const scope = freshScope('for-agent-skills');
    const r = sm(['tutorial', '--for', 'agent-skills'], scope);

    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const target = join(scope.cwd, '.agents', 'skills', 'sm-tutorial');
    assert.ok(existsSync(join(target, 'SKILL.md')), 'skill must land under .agents/skills/');
    assertDirsEqual(SKILL_SOURCE_TUTORIAL, target);
    // The claude territory must NOT be touched when another provider is picked.
    assert.equal(existsSync(join(scope.cwd, '.claude')), false);
    // Success line names the relative path and the provider.
    assert.match(r.stdout, /\.agents\/skills\/sm-tutorial\//);
  });

  it('--for claude is explicit and matches the default', () => {
    const scope = freshScope('for-claude');
    const r = sm(['tutorial', '--for', 'claude'], scope);

    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assertDirsEqual(SKILL_SOURCE_TUTORIAL, join(scope.cwd, '.claude', 'skills', 'sm-tutorial'));
  });

  it('exits 2 and emits forUnknown for a provider that does not scaffold', () => {
    const scope = freshScope('for-unknown');
    const r = sm(['tutorial', '--for', 'garbage'], scope);

    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /unknown provider 'garbage' for --for/);
    assert.match(r.stderr, /Valid providers:/);
    // Defensive: nothing written.
    assert.equal(existsSync(join(scope.cwd, '.claude')), false);
    assert.equal(existsSync(join(scope.cwd, '.agents')), false);
  });

  it('exits 2 for a provider that exists but declares no scaffold (openai)', () => {
    const scope = freshScope('for-no-scaffold');
    const r = sm(['tutorial', '--for', 'openai'], scope);

    assert.equal(r.status, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /unknown provider 'openai' for --for/);
    assert.equal(existsSync(join(scope.cwd, '.codex')), false);
  });
});

describe('sm tutorial, default provider (no --for, non-interactive)', () => {
  it('defaults to Claude in an empty cwd (no marker detection)', () => {
    const scope = freshScope('default-claude');
    const r = sm(['tutorial'], scope);

    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(existsSync(join(scope.cwd, '.claude', 'skills', 'sm-tutorial', 'SKILL.md')));
    assert.equal(existsSync(join(scope.cwd, '.agents')), false);
  });

  it('--force in a dir whose only content is .agents/ still targets the default (Claude)', () => {
    const scope = freshScope('force-no-detect');
    // A bare `.agents/` no longer pre-selects agent-skills: detection is
    // gone, and a non-empty cwd needs --force. The destination is still
    // the default (Claude), not the marker's provider.
    mkdirSync(join(scope.cwd, '.agents'), { recursive: true });

    const r = sm(['tutorial', '--force'], scope);

    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(existsSync(join(scope.cwd, '.claude', 'skills', 'sm-tutorial', 'SKILL.md')));
  });
});
