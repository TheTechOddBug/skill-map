/**
 * Step 6.7, Frontmatter strict mode. Asserts that:
 *
 *   1. Files without a `---` fence run the per-kind AJV pass against the
 *      empty frontmatter: kinds with required fields flag the absent
 *      block; all-optional kinds stay silent.
 *   2. Files with a fence but missing required base fields produce a
 *      `frontmatter-invalid` issue with severity `warn` by default.
 *   3. `runScan({ strict: true })` promotes the same issue to `error`.
 *   4. The CLI surfaces the toggle through `--strict` and through
 *      `scan.strict: true` in `.skill-map/settings.json`. `--strict`
 *      overrides config when set.
 *   5. Incremental scans reuse the prior frontmatter-invalid issue for
 *      cached nodes; without this, a clean second scan would silently
 *      "lose" the warning.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { createKernel, runScan } from '../../kernel/index.js';
import { builtIns } from '../../plugins/built-ins.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', '..', 'bin', 'sm.js');

let root: string;
let counter = 0;

function freshScope(label: string): { cwd: string; home: string } {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  const cwd = join(dir, 'cwd');
  const home = join(dir, 'home');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { cwd, home };
}

function writeNode(scopeRoot: string, rel: string, body: string): void {
  const full = join(scopeRoot, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
}

function sm(args: string[], scope: { cwd: string; home: string }) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    env: { ...process.env, HOME: scope.home, USERPROFILE: scope.home },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-fmstrict-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------
// Kernel-level (runScan)
// -----------------------------------------------------------------------------

describe('frontmatter validation (kernel-level)', () => {
  it('a required-fields kind without ANY fence → frontmatter-invalid (absent block)', async () => {
    const scope = freshScope('no-fence');
    // A partial block (`name` only) already warned about the missing
    // `description`; a fully ABSENT block was silent. Same defect,
    // same signal now: the per-kind AJV pass runs against `{}`.
    writeNode(scope.cwd, '.claude/agents/raw.md', 'plain markdown body, no frontmatter\n');
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const fmIssues = result.issues.filter((i) => i.analyzerId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 1, `expected the absent block to flag; got: ${JSON.stringify(result.issues)}`);
    assert.equal(fmIssues[0]!.severity, 'warn');
    assert.match(fmIssues[0]!.message, /required property/);
  });

  it('an all-optional kind without a fence stays silent (markdown, command)', async () => {
    const scope = freshScope('no-fence-lax');
    writeNode(scope.cwd, 'notes/plain.md', 'plain markdown body, no frontmatter\n');
    writeNode(scope.cwd, '.claude/commands/bare.md', 'command body without frontmatter\n');
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const fmIssues = result.issues.filter((i) => i.analyzerId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 0, `expected silence; got: ${JSON.stringify(fmIssues)}`);
  });

  it('prose before the fence on a required-fields kind now surfaces via the absent-block pass', async () => {
    const scope = freshScope('mid-file-fence');
    // The fence is pushed off byte 0, so the parser sees body-only and
    // the metadata silently parsed as prose. The required fields give
    // the author a signal without a risky mid-file-fence heuristic.
    writeNode(
      scope.cwd,
      '.claude/agents/pushed.md',
      'some prose first\n---\nname: pushed\ndescription: lost metadata.\n---\nbody\n',
    );
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const fmIssues = result.issues.filter((i) => i.analyzerId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 1);
  });

  it('a malformed-fence heuristic wins over the absent-block pass (one issue per defect)', async () => {
    const scope = freshScope('malformed-wins');
    // Indented fence + YAML key: `frontmatter-malformed` names the exact
    // accident; the AJV absent-block pass must NOT double-flag.
    writeNode(scope.cwd, '.claude/agents/indent.md', '  ---\n  name: x\n  ---\nbody\n');
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const malformed = result.issues.filter((i) => i.analyzerId === 'frontmatter-malformed');
    const fmIssues = result.issues.filter((i) => i.analyzerId === 'frontmatter-invalid');
    assert.equal(malformed.length, 1);
    assert.equal(fmIssues.length, 0, 'malformed verdict must suppress the absent-block pass');
  });

  it('files with a fence but missing required fields → warn issue by default', async () => {
    const scope = freshScope('warn-default');
    // The claude agent schema requires name + description. Provide only name.
    writeNode(
      scope.cwd,
      '.claude/agents/incomplete.md',
      '---\nname: Inc\n---\nbody\n',
    );
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const fmIssues = result.issues.filter((i) => i.analyzerId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 1);
    assert.equal(fmIssues[0]!.severity, 'warn');
    assert.deepEqual(fmIssues[0]!.nodeIds, ['.claude/agents/incomplete.md']);
    assert.match(fmIssues[0]!.message, /description/);
  });

  // --- declared-but-empty fence (frontmatterDeclared flag) ------------------

  it('declared EMPTY fence (`---`, blank line, `---`) on a required-fields kind → frontmatter-invalid', async () => {
    const scope = freshScope('empty-fence');
    // The fence parses (frontmatterRaw is the empty string), so the
    // author DECLARED a frontmatter block; required name + description
    // are missing. Historically this fell through as "no frontmatter"
    // and skipped validation, asymmetric with the whitespace-only case.
    writeNode(scope.cwd, '.claude/agents/empty.md', '---\n\n---\nbody\n');
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const fmIssues = result.issues.filter((i) => i.analyzerId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 1, `expected frontmatter-invalid; got: ${JSON.stringify(result.issues)}`);
    assert.equal(fmIssues[0]!.severity, 'warn');
    assert.deepEqual(fmIssues[0]!.nodeIds, ['.claude/agents/empty.md']);
  });

  it('declared WHITESPACE-ONLY fence behaves identically to the empty one (symmetry pin)', async () => {
    const scope = freshScope('ws-fence');
    writeNode(scope.cwd, '.claude/agents/ws.md', '---\n   \n---\nbody\n');
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const fmIssues = result.issues.filter((i) => i.analyzerId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 1);
    assert.equal(fmIssues[0]!.severity, 'warn');
  });

  it('declared empty fence on a kind with NO required fields → no issue', async () => {
    const scope = freshScope('empty-fence-lax');
    // The claude command schema leaves name / description optional, so
    // an empty declared block validates clean.
    writeNode(scope.cwd, '.claude/commands/empty.md', '---\n\n---\nbody\n');
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const fmIssues = result.issues.filter((i) => i.analyzerId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 0, `expected clean; got: ${JSON.stringify(fmIssues)}`);
  });

  it('back-to-back `---` lines (no line between) are NOT a declared block; the absent-block pass owns the verdict', async () => {
    const scope = freshScope('back-to-back');
    // The parser regex needs at least one line between the fences, so
    // this is NOT a declared block: both `---` lines are body content
    // (thematic breaks) and no `frontmatter-malformed` heuristic fires.
    // On a required-fields kind the ABSENT-block AJV pass then flags the
    // missing fields, exactly like any other frontmatter-less agent.
    writeNode(scope.cwd, '.claude/agents/hr2.md', '---\n---\nbody\n');
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const malformed = result.issues.filter((i) => i.analyzerId === 'frontmatter-malformed');
    const fmIssues = result.issues.filter((i) => i.analyzerId === 'frontmatter-invalid');
    assert.equal(malformed.length, 0, 'not recognised as a fence, no malformed heuristic');
    assert.equal(fmIssues.length, 1, 'absent-block pass flags the required fields');
  });

  // --- parse error suppresses the misleading AJV pass -----------------------

  it('unquoted colon in a value → ONE parse-error issue with quoting hint, NO frontmatter-invalid', async () => {
    const scope = freshScope('colon-value');
    // `name` and `description` ARE present in the source; the whole
    // block fails to parse because of the unquoted `: ` in the value.
    // Reporting "missing required property" on top of the parse error
    // would point the author away from the real defect.
    writeNode(
      scope.cwd,
      '.claude/agents/colon.md',
      '---\nname: colon-agent\ndescription: use this agent when: the user asks for X\n---\nbody\n',
    );
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const parseErrors = result.issues.filter((i) => i.analyzerId === 'frontmatter-parse-error');
    const fmInvalid = result.issues.filter((i) => i.analyzerId === 'frontmatter-invalid');
    assert.equal(parseErrors.length, 1, `expected one parse-error; got: ${JSON.stringify(result.issues)}`);
    assert.equal(fmInvalid.length, 0, 'frontmatter-invalid must be suppressed after a parse error');
    assert.match(parseErrors[0]!.message, /wrap the value in quotes/);
  });

  it('a parse error also suppresses frontmatter-malformed (fence was found; content broke)', async () => {
    const scope = freshScope('parse-error-no-malformed');
    writeNode(
      scope.cwd,
      '.claude/agents/tab.md',
      '---\nname: foo\n\tbad: tab\n---\nbody\n',
    );
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const malformed = result.issues.filter((i) => i.analyzerId === 'frontmatter-malformed');
    const fmInvalid = result.issues.filter((i) => i.analyzerId === 'frontmatter-invalid');
    assert.equal(malformed.length, 0);
    assert.equal(fmInvalid.length, 0);
    assert.ok(result.issues.some((i) => i.analyzerId === 'frontmatter-parse-error'));
  });

  it('strict promotes the declared-empty-fence issue to error', async () => {
    const scope = freshScope('empty-fence-strict');
    writeNode(scope.cwd, '.claude/agents/empty.md', '---\n\n---\nbody\n');
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
      strict: true,
    });
    const fmIssues = result.issues.filter((i) => i.analyzerId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 1);
    assert.equal(fmIssues[0]!.severity, 'error');
  });

  it('strict: true promotes warn → error', async () => {
    const scope = freshScope('strict-error');
    writeNode(
      scope.cwd,
      '.claude/agents/incomplete.md',
      '---\nname: Inc\n---\nbody\n',
    );
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
      strict: true,
    });
    const fmIssues = result.issues.filter((i) => i.analyzerId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 1);
    assert.equal(fmIssues[0]!.severity, 'error');
  });

  it('valid frontmatter against the per-kind schema → no issue', async () => {
    const scope = freshScope('valid');
    writeNode(
      scope.cwd,
      '.claude/agents/full.md',
      [
        '---',
        'name: Full',
        'description: A complete agent.',
        'metadata:',
        '  version: 1.0.0',
        '---',
        'body',
      ].join('\n'),
    );
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const fmIssues = result.issues.filter((i) => i.analyzerId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 0);
  });

  it('incremental scan preserves the prior frontmatter-invalid for cached nodes', async () => {
    const scope = freshScope('incremental-preserve');
    writeNode(
      scope.cwd,
      '.claude/agents/incomplete.md',
      '---\nname: Inc\n---\nbody\n',
    );
    const kernel = await createKernel();
    const first = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    assert.equal(
      first.issues.filter((i) => i.analyzerId === 'frontmatter-invalid').length,
      1,
    );

    // Second incremental scan with the same fixture, node is cached
    // (same hashes), but the issue must reappear in the result.
    const second = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
      priorSnapshot: first,
      enableCache: true,
    });
    const fmIssues = second.issues.filter((i) => i.analyzerId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 1);
    assert.equal(fmIssues[0]!.severity, 'warn');
  });

  it('catches type-mismatch on a base field (name: 42 instead of string)', async () => {
    const scope = freshScope('type-mismatch');
    writeNode(
      scope.cwd,
      '.claude/agents/badtype.md',
      [
        '---',
        'name: 42',
        'description: A description',
        'metadata:',
        '  version: 1.0.0',
        '---',
        'body',
      ].join('\n'),
    );
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const fmIssues = result.issues.filter((i) => i.analyzerId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 1);
    assert.match(fmIssues[0]!.message, /name|string|type/);
  });

  it('per-kind required: only strict kinds flag a missing base field (skill/command/markdown relaxed)', async () => {
    const scope = freshScope('multi-kind');
    // Drop one minimal-but-incomplete file per kind, each missing the
    // `description` field. `required: [name, description]` no longer lives on
    // the universal base; it is declared per kind. Only `agent` mandates them
    // (Anthropic's documented subagent contract), so only the agent file
    // produces a frontmatter-invalid issue. Claude skill/command (merged
    // contract treats both as optional, with name/description defaulting to
    // the dir/file name and first paragraph) and the generic `markdown`
    // fallback (no normative Markdown standard mandates frontmatter) pass.
    writeNode(scope.cwd, '.claude/skills/s/SKILL.md', '---\nname: s\n---\nbody\n');
    writeNode(scope.cwd, '.claude/agents/a.md', '---\nname: a\n---\nbody\n');
    writeNode(scope.cwd, '.claude/commands/c.md', '---\nname: c\n---\nbody\n');
    writeNode(scope.cwd, 'notes/n.md', '---\nname: n\n---\nbody\n');
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const fmIssues = result.issues.filter((i) => i.analyzerId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 1);
    assert.equal((fmIssues[0]!.data as { kind?: string } | undefined)?.kind, 'agent');
  });

  it('incremental + strict promotes the cached issue to error', async () => {
    const scope = freshScope('incremental-strict');
    writeNode(
      scope.cwd,
      '.claude/agents/incomplete.md',
      '---\nname: Inc\n---\nbody\n',
    );
    const kernel = await createKernel();
    const first = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
    });
    const second = await runScan(kernel, {
      roots: [scope.cwd],
      extensions: builtIns(),
      priorSnapshot: first,
      enableCache: true,
      strict: true,
    });
    const fmIssues = second.issues.filter((i) => i.analyzerId === 'frontmatter-invalid');
    assert.equal(fmIssues.length, 1);
    assert.equal(fmIssues[0]!.severity, 'error');
  });
});

// -----------------------------------------------------------------------------
// CLI surface (sm scan --strict and scan.strict config)
// -----------------------------------------------------------------------------

describe('frontmatter strict, CLI', () => {
  it('default scan exits 0 even with frontmatter warnings', () => {
    const scope = freshScope('cli-default');
    sm(['init', '--no-scan'], scope);
    writeNode(scope.cwd, '.claude/agents/inc.md', '---\nname: Inc\n---\nbody\n');
    const r = sm(['scan'], scope);
    // exit 1 = "issues" but only when severity=error; warns are exit 0.
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  });

  it('--strict escalates to exit 1 on frontmatter warnings', () => {
    const scope = freshScope('cli-strict');
    sm(['init', '--no-scan'], scope);
    writeNode(scope.cwd, '.claude/agents/inc.md', '---\nname: Inc\n---\nbody\n');
    const r = sm(['scan', '--strict'], scope);
    assert.equal(r.status, 1);
  });

  it('scan.strict: true in settings.json acts the same as --strict', () => {
    const scope = freshScope('cli-config-strict');
    sm(['init', '--no-scan'], scope);
    sm(['config', 'set', 'scan.strict', 'true'], scope);
    writeNode(scope.cwd, '.claude/agents/inc.md', '---\nname: Inc\n---\nbody\n');
    const r = sm(['scan'], scope);
    assert.equal(r.status, 1);
  });

  it('--strict overrides scan.strict: false in config (CLI flag wins)', () => {
    const scope = freshScope('cli-flag-overrides');
    sm(['init', '--no-scan'], scope);
    sm(['config', 'set', 'scan.strict', 'false'], scope);
    writeNode(scope.cwd, '.claude/agents/inc.md', '---\nname: Inc\n---\nbody\n');
    const r = sm(['scan', '--strict'], scope);
    assert.equal(r.status, 1);
  });
});

describe('--strict unification (Step 6 follow-up)', () => {
  it('sm scan --strict also tightens the layered loader (bogus key kills the scan)', () => {
    const scope = freshScope('scan-strict-loader');
    sm(['init', '--no-scan'], scope);
    // Inject a bogus key into settings.json directly (sm config set
    // would refuse the schema violation).
    writeFileSync(
      join(scope.cwd, '.skill-map', 'settings.json'),
      JSON.stringify({ schemaVersion: 1, bogus_key: 'nope' }),
    );
    const lenient = sm(['scan'], scope);
    assert.equal(lenient.status, 0, `default scan should tolerate the warning, got: ${lenient.stderr}`);
    const strict = sm(['scan', '--strict'], scope);
    assert.equal(strict.status, 2);
    assert.match(strict.stderr, /sm scan: /m);
    assert.match(strict.stderr, /unknown key bogus_key/);
    assert.ok(!strict.stderr.includes('Internal Error'));
  });

  // The historic "init --strict surfaces a bogus user-layer
  // settings.json" test exercised a path that no longer exists
  // post the no-`$HOME`-reads cleanup: the loader does not read
  // `~/.skill-map/settings.json` anymore, so there is no user-layer
  // warning to surface. The project-layer equivalent is impossible
  // to exercise from `sm init` because `--force` rewrites the
  // project settings.json with a known-clean payload before the
  // first scan loads the config. Coverage of the strict-mode loader
  // path on a project-layer warning lives in `config-loader.test.ts`
  // (which calls `loadConfig` directly).
});
