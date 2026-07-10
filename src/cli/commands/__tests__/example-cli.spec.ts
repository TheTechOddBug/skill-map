/**
 * `sm example` end-to-end through the real binary. Each test isolates
 * cwd so the host's working directory is never touched.
 *
 * The spawned binary (`src/bin/sm.js`) loads the BUILT `dist/cli.js`, so
 * the verb resolves the example payload from `dist/cli/example/`
 * (populated by tsup `onSuccess` from `fixtures/demo/`). Run
 * `pnpm --filter @skill-map/cli build` before this spec, as with the
 * tutorial spec.
 *
 * Spec contract under test (spec/cli-contract.md § `sm example`):
 *
 *   - `sm example`                  → writes the harness into <cwd>, exit 0.
 *   - `sm example`                  → never writes `.skill-map/` (ships unscanned).
 *   - `sm example` (non-empty cwd)  → exits 2, writes nothing.
 *   - `sm example --force` (non-empty) → seeds anyway, exit 0, leaves unrelated content.
 *   - `sm example foo`              → exits 2, emits `unexpectedArg`.
 *   - No `.skill-map/` is required (verb runs in a virgin dir).
 *
 * Assertions are structural (key files present, scan state absent), not
 * byte-for-byte: the payload is the demo fixture, whose content evolves
 * with the demo and should not pin this spec.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', '..', '..', 'bin', 'sm.js');

// Repo root → fixtures/demo/ is the source-of-truth payload the
// verb materializes. From src/cli/commands/__tests__/ that's four levels up.
const EXAMPLE_SOURCE = resolve(HERE, '..', '..', '..', '..', 'fixtures', 'demo');

let root: string;
let counter = 0;

interface IScope {
  cwd: string;
  home: string;
}

// `cwd` and `home` are siblings under a per-test parent so the cwd stays
// empty (the verb requires it) while `home` isolates the spawned binary
// from the developer's real `~/.skill-map/settings.json` (telemetry
// opt-in), matching the other CLI spawn-specs.
function freshScope(label: string): IScope {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  const cwd = join(dir, 'cwd');
  const home = join(dir, 'home');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { cwd, home };
}

function sm(args: string[], scope: IScope): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    env: { ...process.env, HOME: scope.home, USERPROFILE: scope.home, NO_COLOR: '1' },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-example-'));
  // Sanity: the source payload must exist for these tests to be
  // meaningful. The verb's bundled-loader fallback resolves it from
  // dist/ at runtime, but this anchor keeps the structural assertions
  // honest, so fail fast here instead.
  assert.ok(
    existsSync(EXAMPLE_SOURCE) && statSync(EXAMPLE_SOURCE).isDirectory(),
    `example payload source missing at ${EXAMPLE_SOURCE}`,
  );
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sm example, happy path', () => {
  it('writes the harness into cwd with exit 0 and the next-steps message', () => {
    const scope = freshScope('basic');
    const r = sm(['example'], scope);

    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    // Representative wired nodes from the harness scenario.
    assert.ok(existsSync(join(scope.cwd, 'AGENTS.md')), 'AGENTS.md must be written');
    assert.ok(
      existsSync(join(scope.cwd, '.claude', 'agents', 'content-editor.md')),
      'content-editor agent must be written',
    );
    assert.ok(
      existsSync(join(scope.cwd, '.claude', 'skills', 'check-links', 'SKILL.md')),
      'check-links skill must be written',
    );
    assert.ok(existsSync(join(scope.cwd, 'docs', 'STYLE.md')), 'docs must be written');
    assert.ok(existsSync(join(scope.cwd, 'package.json')), 'package.json must be written');

    // Success message orients the user toward the next two commands:
    // `sm scan`, then a bare `sm` (the serve alias, "serve" dropped from
    // the copy so the step reads `sm    open the interactive map...`).
    assert.match(r.stdout, /Example project created/);
    assert.match(r.stdout, /sm scan/);
    assert.match(r.stdout, /open the interactive map/);
    assert.doesNotMatch(r.stdout, /sm serve/);
  });

  it('ships unscanned: never writes .skill-map/', () => {
    const scope = freshScope('unscanned');
    const r = sm(['example'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(
      existsSync(join(scope.cwd, '.skill-map')),
      false,
      'example must not ship a .skill-map/ (the user scans fresh)',
    );
  });

  it('ships the .sm sidecars (annotations are part of the payload)', () => {
    const scope = freshScope('sidecars');
    const r = sm(['example'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(existsSync(join(scope.cwd, 'AGENTS.sm')), 'AGENTS.sm sidecar must be written');
  });

  it('runs in a virgin directory (no .skill-map/ required)', () => {
    const scope = freshScope('virgin');
    assert.equal(existsSync(join(scope.cwd, '.skill-map')), false);
    const r = sm(['example'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(existsSync(join(scope.cwd, 'AGENTS.md')));
  });
});

describe('sm example, empty-directory guard', () => {
  it('exits 2 and writes nothing when the cwd holds unrelated user content', () => {
    const scope = freshScope('non-empty');
    writeFileSync(join(scope.cwd, 'my-notes.md'), '# keep me\n');

    const r = sm(['example'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not empty/);
    // Nothing from the payload landed.
    assert.equal(existsSync(join(scope.cwd, 'AGENTS.md')), false);
    // The pre-existing file is untouched.
    assert.ok(existsSync(join(scope.cwd, 'my-notes.md')));
  });

  it('--force seeds into a non-empty cwd, exit 0, leaves other content', () => {
    const scope = freshScope('force');
    writeFileSync(join(scope.cwd, 'keep.txt'), 'hello\n');

    const r = sm(['example', '--force'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(existsSync(join(scope.cwd, 'AGENTS.md')), 'payload must be seeded');
    assert.ok(existsSync(join(scope.cwd, 'keep.txt')), 'unrelated content must survive');
  });
});

describe('sm example, positional argument', () => {
  it('exits 2 and emits unexpectedArg for a stray positional', () => {
    const scope = freshScope('positional');
    const r = sm(['example', 'foo'], scope);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unexpected argument/);
    assert.equal(existsSync(join(scope.cwd, 'AGENTS.md')), false);
  });
});
