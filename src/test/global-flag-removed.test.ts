/**
 * Regression: the `-g/--global` flag was removed in v0.27 (the
 * no-`$HOME`-reads cleanup, per `spec/cli-contract.md` §Scope is
 * always project-local). Every `sm` verb MUST now reject `-g` and
 * `--global` as Clipanion "unknown option" errors with exit code 2.
 *
 * This test pins the surface so a future regression that quietly
 * re-introduces the flag (or accepts it as an alias) fails CI.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'sm.js');

let tmpRoot: string;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'sm-no-global-flag-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function run(args: string[]): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: tmpRoot,
    env: { ...process.env, HOME: tmpRoot, USERPROFILE: tmpRoot, NO_COLOR: '1' },
  });
  return { status: r.status ?? 0, stderr: r.stderr ?? '' };
}

describe('-g / --global is removed (no global scope)', () => {
  it('rejects `sm scan -g` with Clipanion unknown-option (exit 2)', () => {
    const r = run(['scan', '-g']);
    assert.equal(r.status, 2);
    // Clipanion's wording for unknown options.
    assert.match(r.stderr, /-g/);
  });

  it('rejects `sm list --global`', () => {
    const r = run(['list', '--global']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--global/);
  });

  it('rejects `sm config list --global`', () => {
    const r = run(['config', 'list', '--global']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--global/);
  });
});
