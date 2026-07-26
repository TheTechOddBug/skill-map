/**
 * Unit tests for the shipped sm-tutorial state engine
 * (`.claude/skills/sm-tutorial/scripts/state.js`).
 *
 * The script ships inside the skill tree (copied verbatim by
 * `copySkillFolder`), is zero-dep plain Node, and is never imported by
 * `src/`. We exercise it by spawning it the way the agent does, against
 * an isolated temp cwd, and parsing its single-line JSON stdout. The
 * script + its `_manifest.json` are read from the repo-root source, so
 * these tests do NOT need a build (unlike the byte-for-byte payload
 * test in `cli/commands/__tests__/tutorial-cli.spec.ts`).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// src/cli/tutorial/__tests__ -> repo root
const STATE_SCRIPT = resolve(
  HERE, '..', '..', '..', '..',
  '.claude', 'skills', 'sm-tutorial', 'scripts', 'state.js',
);

interface Run {
  status: number | null;
  // Spawned-process JSON varies per verb; spec files are eslint-exempt
  // so `any` keeps the per-verb assertions readable.
  json: any;
  stdout: string;
  stderr: string;
}

function run(args: string[], cwd: string): Run {
  const r = spawnSync(process.execPath, [STATE_SCRIPT, ...args], { cwd, encoding: 'utf8' });
  let json: any = {};
  try {
    json = JSON.parse(r.stdout.trim());
  } catch {
    /* leave json empty; assertions on r.stdout still apply */
  }
  return { status: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

function freshCwd(): string {
  // realpath so process.cwd() inside the spawned script matches the
  // `--cwd` string we store (mkdtemp can return a symlinked path).
  return realpathSync(mkdtempSync(join(tmpdir(), 'sm-tut-state-')));
}

function init(cwd: string, extra: string[] = []): Run {
  return run(['init', '--cwd', cwd, '--sm-version', '0.60.4', '--provider', 'claude', '--lang', 'es', ...extra], cwd);
}

describe('sm-tutorial state.js', () => {
  it('init creates tutorial-state.json with the version-2 shape', () => {
    const cwd = freshCwd();
    const r = init(cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.ok, true);
    assert.ok(existsSync(join(cwd, 'tutorial-state.json')));
    const state = r.json.state as any;
    assert.equal(state.tutorial.version, 2);
    assert.equal(state.tutorial.provider, 'claude');
    assert.equal(state.tutorial.lang, 'es');
    assert.equal(state.tutorial.sm_version, '0.60.4');
    assert.equal(state.tutorial.cwd, cwd);
    assert.deepEqual(state.parts, {});
    assert.match(state.tutorial.started_at, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('init refuses a second run without --force, accepts it with --force', () => {
    const cwd = freshCwd();
    assert.equal(init(cwd).status, 0);
    const second = init(cwd);
    assert.equal(second.status, 1);
    assert.equal(second.json.ok, false);
    assert.equal(second.json.code, 'exists');
    assert.equal(init(cwd, ['--force']).status, 0);
  });

  it('pick seeds chapters from the manifest and is idempotent', () => {
    const cwd = freshCwd();
    init(cwd);
    const r = run(['pick', 'fundamentals'], cwd);
    assert.equal(r.status, 0, r.stderr);
    const part = r.json.part as any;
    assert.equal(part.status, 'in_progress');
    assert.deepEqual(
      Object.keys(part.chapters),
      ['init', 'kinds', 'first-edit', 'connectors', 'inspector', 'edit-link', 'workspace', 'ignore'],
    );
    assert.equal(part.chapters.init.status, 'pending');
    // extend spans three files / 11 chapters.
    const ext = run(['pick', 'extend'], cwd).json.part as any;
    assert.equal(Object.keys(ext.chapters).length, 11);
    // Idempotent: re-pick after a mark must not reset progress.
    run(['mark', 'fundamentals', 'init', 'done'], cwd);
    const again = run(['pick', 'fundamentals'], cwd).json.part as any;
    assert.equal(again.chapters.init.status, 'done');
  });

  it('mark sets status + timestamp and auto-promotes the part when all chapters are terminal', () => {
    const cwd = freshCwd();
    init(cwd);
    run(['pick', 'project-kickoff'], cwd);
    const chapters = [
      'kickoff', 'manual', 'first-agent', 'real-kinds',
      'check-links', 'publish', 'links', 'confidence',
    ];
    let last: Run | undefined;
    for (const ch of chapters) last = run(['mark', 'project-kickoff', ch, 'done'], cwd);
    assert.equal(last!.json.allDone, true);
    const part = last!.json.part as any;
    assert.equal(part.status, 'done');
    assert.match(part.chapters.kickoff.at, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('a failed chapter reports allDone but leaves the part in_progress', () => {
    const cwd = freshCwd();
    init(cwd);
    run(['pick', 'project-kickoff'], cwd);
    run(['mark', 'project-kickoff', 'kickoff', 'done'], cwd);
    run(['mark', 'project-kickoff', 'manual', 'done'], cwd);
    run(['mark', 'project-kickoff', 'first-agent', 'failed'], cwd);
    run(['mark', 'project-kickoff', 'real-kinds', 'done'], cwd);
    run(['mark', 'project-kickoff', 'check-links', 'done'], cwd);
    run(['mark', 'project-kickoff', 'publish', 'done'], cwd);
    run(['mark', 'project-kickoff', 'links', 'done'], cwd);
    const r = run(['mark', 'project-kickoff', 'confidence', 'done'], cwd);
    assert.equal(r.json.allDone, true);
    assert.equal((r.json.part as any).status, 'in_progress');
  });

  it('mark rejects a bad status, unknown chapter, and an unpicked part', () => {
    const cwd = freshCwd();
    init(cwd);
    assert.equal(run(['mark', 'fundamentals', 'init', 'bogus'], cwd).json.code, 'bad-status');
    assert.equal(run(['mark', 'fundamentals', 'init', 'done'], cwd).json.code, 'not-picked');
    run(['pick', 'fundamentals'], cwd);
    assert.equal(run(['mark', 'fundamentals', 'nope', 'done'], cwd).json.code, 'unknown-chapter');
  });

  it('set-part seeds an unpicked part then sets its status (predecessor skipped on seed)', () => {
    const cwd = freshCwd();
    init(cwd);
    const r = run(['set-part', 'project-kickoff', 'skipped'], cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.equal((r.json.part as any).status, 'skipped');
    assert.equal(run(['set-part', 'project-kickoff', 'bogus'], cwd).json.code, 'bad-status');
  });

  it('set-identity persists a tagline with a colon and quotes (the JSON justification)', () => {
    const cwd = freshCwd();
    init(cwd);
    const tagline = 'Small, sturdy things: "on the web"';
    const r = run(['set-identity', '--name', 'Acme', '--tagline', tagline], cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.json.site_identity, { name: 'Acme', tagline });
  });

  it('status returns active parts ordered, joins titles', () => {
    const cwd = freshCwd();
    init(cwd);
    run(['pick', 'fundamentals'], cwd);
    run(['mark', 'fundamentals', 'init', 'done'], cwd);
    const r = run(['status'], cwd);
    const parts = r.json.parts as any[];
    assert.deepEqual(parts.map((p) => p.id), ['fundamentals', 'project-kickoff', 'daily-loop', 'realtime', 'ai-layer', 'cli', 'extend']);
    const fund = parts[0];
    assert.equal(fund.status, 'in_progress');
    assert.equal(fund.chapters[0].status, 'done');
    assert.equal(fund.title, 'The live map (prologue)');
    assert.equal(parts[1].status, 'not_started');
  });

  it('wipe-list previews paths and deletes nothing; wipe --confirm deletes them but spares user files', () => {
    const cwd = freshCwd();
    init(cwd);
    run(['pick', 'fundamentals'], cwd);
    run(['pick', 'project-kickoff'], cwd);
    run(['pick', 'realtime'], cwd);
    run(['pick', 'ai-layer'], cwd);
    // Plant the tutorial fixtures the wipe should remove.
    mkdirSync(join(cwd, '.claude', 'agents'), { recursive: true });
    mkdirSync(join(cwd, 'notes'), { recursive: true });
    mkdirSync(join(cwd, '.skill-map'), { recursive: true });
    mkdirSync(join(cwd, 'docs'), { recursive: true });
    writeFileSync(join(cwd, '.claude', 'agents', 'demo-agent.md'), 'x');
    // The realtime part's `sm activity install` wires the hook config.
    writeFileSync(join(cwd, '.claude', 'settings.json'), '{"hooks":{}}');
    // The ai-layer part's seed lays the planted-flaw docs; its tagger
    // chapter writes a sidecar next to a portfolio doc.
    writeFileSync(join(cwd, 'docs', 'OPS.md'), 'x');
    writeFileSync(join(cwd, 'docs', 'STYLE.sm'), 'x');
    writeFileSync(join(cwd, 'notes', 'todo.md'), 'x');
    writeFileSync(join(cwd, 'AGENTS.md'), 'x');
    writeFileSync(join(cwd, 'export.json'), 'x');
    // Plant a user file the wipe must NOT touch.
    writeFileSync(join(cwd, 'notes', 'keepme.md'), 'mine');

    const list = run(['wipe-list'], cwd);
    assert.equal(list.status, 0, list.stderr);
    const paths = list.json.paths as string[];
    assert.ok(paths.includes('AGENTS.md'));
    assert.ok(paths.includes('notes/todo.md'));
    assert.ok(paths.includes('export.json'));
    // The realtime-hook footprint rides the wipe (all four provider configs listed).
    assert.ok(paths.includes('.claude/settings.json'));
    assert.ok(paths.includes('.opencode/plugin/skill-map-activity.js'));
    // The ai-flaws footprint rides too: laid docs + chapter-written sidecars.
    assert.ok(paths.includes('docs/OPS.md'));
    assert.ok(paths.includes('docs/STYLE.sm'));
    assert.ok(!paths.includes('notes/keepme.md'));
    // wipe-list is read-only.
    assert.ok(existsSync(join(cwd, 'AGENTS.md')));

    assert.equal(run(['wipe'], cwd).json.code, 'confirm-required');
    const wiped = run(['wipe', '--confirm'], cwd);
    assert.equal(wiped.status, 0, wiped.stderr);
    assert.ok(!existsSync(join(cwd, 'AGENTS.md')));
    assert.ok(!existsSync(join(cwd, 'notes', 'todo.md')));
    assert.ok(!existsSync(join(cwd, '.skill-map')));
    assert.ok(!existsSync(join(cwd, '.claude', 'settings.json')));
    assert.ok(!existsSync(join(cwd, 'docs', 'OPS.md')));
    assert.ok(!existsSync(join(cwd, 'docs', 'STYLE.sm')));
    // User file + its now-non-empty parent survive.
    assert.ok(existsSync(join(cwd, 'notes', 'keepme.md')));
  });

  it('wipe refuses when the stored cwd does not match the current dir', () => {
    const cwd = freshCwd();
    init(cwd, []);
    // Re-init with a bogus stored cwd to force the mismatch.
    init(cwd, ['--force']);
    const bogus = run(['init', '--cwd', '/nonexistent/elsewhere', '--provider', 'claude', '--force'], cwd);
    assert.equal(bogus.status, 0);
    assert.equal(run(['wipe-list'], cwd).json.code, 'cwd-mismatch');
    assert.equal(run(['wipe', '--confirm'], cwd).json.code, 'cwd-mismatch');
  });

  it('an unknown verb and unknown part fail with an error envelope', () => {
    const cwd = freshCwd();
    init(cwd);
    const bad = run(['frobnicate'], cwd);
    assert.equal(bad.status, 1);
    assert.equal(bad.json.code, 'unknown-verb');
    assert.equal(run(['pick', 'ghost-part'], cwd).json.code, 'unknown-part');
  });
});
