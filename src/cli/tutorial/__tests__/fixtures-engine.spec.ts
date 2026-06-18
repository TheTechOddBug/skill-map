/**
 * Unit tests for the shipped sm-tutorial fixture engine
 * (`.claude/skills/sm-tutorial/scripts/fixtures.js`).
 *
 * Like the state-engine spec, we spawn the zero-dep script the way the
 * agent does, against an isolated temp cwd, and read its stdout. The
 * script + `fixtures-data/` are read from the repo-root source, so no
 * build is needed. Today only the `prologue` set carries content; the
 * other sets land in a later step and get their own cases then.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_SCRIPT = resolve(
  HERE, '..', '..', '..', '..',
  '.claude', 'skills', 'sm-tutorial', 'scripts', 'fixtures.js',
);

interface Run {
  status: number | null;
  json: any;
  stdout: string;
  stderr: string;
}

function run(args: string[], cwd: string): Run {
  const r = spawnSync(process.execPath, [FIXTURES_SCRIPT, ...args], { cwd, encoding: 'utf8' });
  let json: any = {};
  try { json = JSON.parse(r.stdout.trim()); } catch { /* cat emits raw content */ }
  return { status: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

function freshCwd(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'sm-tut-fx-')));
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const full = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.push(full.slice(root.length + 1));
    }
  }
  return out.sort();
}

describe('sm-tutorial fixtures.js', () => {
  it('lay prologue (claude/en) writes the seven demo files', () => {
    const cwd = freshCwd();
    const r = run(['lay', 'prologue', '--provider', 'claude', '--lang', 'en'], cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.nodeCount, 7);
    assert.equal(r.json.needsProvision, true);
    assert.deepEqual(listFiles(cwd), [
      '.claude/agents/demo-agent.md',
      '.claude/commands/demo-command.md',
      '.claude/skills/demo-skill/SKILL.md',
      'notes/demo-guideline.md',
      'notes/demo-guideline2.md',
      'notes/private-credentials.md',
      'notes/todo.md',
    ]);
    assert.match(readFileSync(join(cwd, '.claude/agents/demo-agent.md'), 'utf8'), /name: demo-agent/);
  });

  it('lay prologue (es) lays Spanish content', () => {
    const cwd = freshCwd();
    run(['lay', 'prologue', '--lang', 'es'], cwd);
    assert.match(readFileSync(join(cwd, '.claude/agents/demo-agent.md'), 'utf8'), /Agente de ejemplo/);
  });

  it('lay prologue (agent-skills) skips agent + command, lands the skill at .agents/skills/<name>', () => {
    const cwd = freshCwd();
    const r = run(['lay', 'prologue', '--provider', 'agent-skills', '--lang', 'en'], cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.nodeCount, 5);
    assert.ok(existsSync(join(cwd, '.agents/skills/demo-skill/SKILL.md')), 'skill at .agents/skills/demo-skill');
    assert.ok(!existsSync(join(cwd, '.agents/skills/skills')), 'no double skills/ segment');
    assert.ok(!existsSync(join(cwd, '.agents/skills/demo-agent.md')));
    assert.deepEqual(
      (r.json.skipped as any[]).map((s) => s.kind).sort(),
      ['agent', 'command'],
    );
  });

  it('edit todo-connectors appends five bullets after a blank line (claude)', () => {
    const cwd = freshCwd();
    run(['lay', 'prologue', '--lang', 'en'], cwd);
    const r = run(['edit', 'todo-connectors', '--lang', 'en'], cwd);
    assert.equal(r.status, 0, r.stderr);
    const todo = readFileSync(join(cwd, 'notes/todo.md'), 'utf8');
    assert.match(todo, /# Pending\n\n- \[ \] Brief @demo-agent/);
    assert.equal((todo.match(/^- \[ \]/gm) ?? []).length, 5);
  });

  it('edit todo-connectors drops the agent + command bullets on agent-skills', () => {
    const cwd = freshCwd();
    run(['lay', 'prologue', '--provider', 'agent-skills', '--lang', 'en'], cwd);
    const r = run(['edit', 'todo-connectors', '--provider', 'agent-skills', '--lang', 'en'], cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.json.appended, ['todo-bullet-skill.md', 'todo-bullet-guideline.md', 'todo-bullet-guideline2.md']);
    const todo = readFileSync(join(cwd, 'notes/todo.md'), 'utf8');
    assert.ok(!todo.includes('@demo-agent'));
    assert.ok(todo.includes('/demo-skill'));
  });

  it('seed prologue-built lays six nodes (drops private-credentials) and wires the hub', () => {
    const cwd = freshCwd();
    const r = run(['seed', 'prologue-built', '--lang', 'en'], cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.nodeCount, 6);
    assert.ok(!existsSync(join(cwd, 'notes/private-credentials.md')), 'private-credentials dropped');
    assert.deepEqual(r.json.dropped, ['notes/private-credentials.md']);
    assert.match(readFileSync(join(cwd, 'notes/todo.md'), 'utf8'), /@demo-guideline2\.md/);
  });

  it('clear prologue deletes the footprint, spares user files, rmdirs empty parents', () => {
    const cwd = freshCwd();
    run(['lay', 'prologue', '--lang', 'en'], cwd);
    writeFileSync(join(cwd, 'notes', 'keepme.md'), 'mine');
    const r = run(['clear', 'prologue'], cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(join(cwd, '.claude/agents/demo-agent.md')));
    assert.ok(!existsSync(join(cwd, '.claude')), '.claude rmdir (skill dir not present in this temp)');
    assert.ok(existsSync(join(cwd, 'notes/keepme.md')), 'user file survives');
    assert.ok(existsSync(join(cwd, 'notes')), 'notes kept (non-empty)');
  });

  it('cat prints raw content to stdout without writing', () => {
    const cwd = freshCwd();
    const r = run(['cat', 'prologue', '--file', 'notes/demo-guideline.md', '--lang', 'es'], cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /name: demo-guideline/);
    assert.match(r.stdout, /Notas de referencia/);
    assert.equal(listFiles(cwd).length, 0, 'cat writes nothing');
  });

  it('an unknown language falls back to the default (en) content', () => {
    const cwd = freshCwd();
    run(['lay', 'prologue', '--lang', 'fr'], cwd);
    assert.match(readFileSync(join(cwd, '.claude/agents/demo-agent.md'), 'utf8'), /Example agent that handles/);
  });

  it('lay is deterministic (same bytes on a second run)', () => {
    const a = freshCwd();
    const b = freshCwd();
    run(['lay', 'prologue', '--lang', 'en'], a);
    run(['lay', 'prologue', '--lang', 'en'], b);
    for (const rel of listFiles(a)) {
      assert.deepEqual(readFileSync(join(b, rel)), readFileSync(join(a, rel)), `byte match: ${rel}`);
    }
  });

  it('lay portfolio writes the skeleton, handbook, content-editor and docs (5 nodes)', () => {
    const cwd = freshCwd();
    const r = run(['lay', 'portfolio', '--lang', 'en'], cwd);
    assert.equal(r.status, 0, r.stderr);
    for (const f of [
      'AGENTS.md', 'CLAUDE.md', 'server.js', 'package.json', 'public/index.html',
      'docs/STYLE.md', 'docs/DEPLOY.md', '.claude/agents/content-editor.md',
    ]) {
      assert.ok(existsSync(join(cwd, f)), `missing ${f}`);
    }
    assert.equal(r.json.nodeCount, 5);
  });

  it('seed harness-connected lays portfolio + harness and applies both edits', () => {
    const cwd = freshCwd();
    const r = run(['seed', 'harness-connected', '--lang', 'en'], cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(cwd, '.claude/skills/check-links/SKILL.md')));
    assert.ok(existsSync(join(cwd, '.claude/commands/publish.md')));
    assert.match(readFileSync(join(cwd, 'AGENTS.md'), 'utf8'), /run \/publish/);
    assert.match(
      readFileSync(join(cwd, '.claude/agents/content-editor.md'), 'utf8'),
      /\[style guide\]\(\.\.\/\.\.\/docs\/STYLE\.md\)/,
    );
  });

  it('content-editor-style edit is skipped on agent-skills (agent target unsupported)', () => {
    const cwd = freshCwd();
    run(['lay', 'portfolio', '--provider', 'agent-skills', '--lang', 'en'], cwd);
    assert.equal(run(['edit', 'content-editor-style', '--provider', 'agent-skills'], cwd).json.skipped, true);
  });

  it('lay master and cli-external write their fixtures', () => {
    const cwd = freshCwd();
    run(['lay', 'master', '--lang', 'es'], cwd);
    assert.ok(existsSync(join(cwd, '.claude/agents/master-agent.md')));
    assert.ok(existsSync(join(cwd, '.claude/skills/master-skill/SKILL.md')));
    assert.ok(existsSync(join(cwd, 'notes/ideas.md')));
    run(['lay', 'cli-external', '--lang', 'en'], cwd);
    assert.ok(existsSync(join(cwd, 'link-validation/hijoA/note-with-external-link.md')));
    assert.ok(existsSync(join(cwd, 'link-validation/hijoB/spec.md')));
  });

  it('unknown set / seed / edit / footprint fail with an error envelope', () => {
    const cwd = freshCwd();
    assert.equal(run(['lay', 'ghost'], cwd).json.code, 'unknown-set');
    assert.equal(run(['seed', 'ghost'], cwd).json.code, 'unknown-seed');
    assert.equal(run(['edit', 'ghost'], cwd).json.code, 'unknown-edit');
    assert.equal(run(['clear', 'ghost'], cwd).json.code, 'unknown-footprint');
    assert.equal(run(['frobnicate'], cwd).json.code, 'unknown-verb');
  });
});
