/**
 * Guards the `sm list` flag surface end-to-end through the real binary.
 *
 * `--tag-source author|user` was removed when the tag system reverted to
 * single-source (tags live only in the `.sm` sidecar). This pins that
 * the flag is gone so a refactor cannot silently bring the dual-source
 * surface back, while `--tag` stays a known flag.
 *
 * Each test isolates HOME and cwd so the host's `~/.skill-map/` is never
 * touched.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', '..', '..', 'bin', 'sm.js');

let root: string;
let counter = 0;

interface IScope {
  cwd: string;
  home: string;
}

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
  root = mkdtempSync(join(tmpdir(), 'skill-map-list-cli-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sm list flag surface', () => {
  it('--tag-source is rejected as an unknown option (tags are single-source now)', () => {
    const scope = freshScope('tag-source-gone');
    sm(['init', '--no-scan'], scope);
    const r = sm(['list', '--tag-source', 'author'], scope);
    // Clipanion exits 2 ("usage error") on an unknown option.
    assert.equal(r.status, 2, `expected unknown-option exit 2; stderr: ${r.stderr}`);
  });

  it('--tag is still a known option', () => {
    const scope = freshScope('tag-ok');
    sm(['init', '--no-scan'], scope);
    const r = sm(['list', '--tag', 'whatever'], scope);
    // Whatever the command outcome, a known flag must NOT trip the
    // clipanion usage error (exit 2).
    assert.notEqual(r.status, 2, `--tag should be a known flag; stderr: ${r.stderr}`);
  });
});
