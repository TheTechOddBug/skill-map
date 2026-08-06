/**
 * Regression: the active-provider auto-detect line must ride the SAME
 * stream as the scan summary so the two never interleave on a tty.
 *
 * The bootstrap used to print `Auto-detected activeProvider = ...` to
 * stderr (`printer.info`) while `sm scan` prints its summary to stdout
 * (`printer.data`). On a real tty those two independent streams
 * interleaved, gluing the auto-detect line to the summary line with no
 * newline between them. The bootstrap now stays silent and the CLI
 * announces the auto-detect next to the summary, on stdout, in order.
 *
 * Each test isolates HOME and cwd so the host's `~/.skill-map/` is
 * never touched and telemetry stays dormant.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

function sm(
  args: string[],
  scope: IScope,
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    env: {
      ...process.env,
      HOME: scope.home,
      USERPROFILE: scope.home,
      NO_COLOR: '1',
      SKILL_MAP_TELEMETRY: '0',
    },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-scan-autodetect-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sm scan, active-provider auto-detect stream', () => {
  it('announces the auto-detect on stdout with the summary, not stderr', () => {
    const scope = freshScope('detect');
    mkdirSync(join(scope.cwd, '.claude', 'agents'), { recursive: true });
    writeFileSync(
      join(scope.cwd, '.claude', 'agents', 'a.md'),
      '---\nname: a\ntools: [Read]\n---\n\n# a\n\nbody\n',
    );
    // `--no-scan` defers detection, so the FIRST `sm scan` is what
    // auto-detects the lens and prints the line.
    assert.equal(sm(['init', '--no-scan'], scope).status, 0);

    const r = sm(['scan'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);

    // The line rides stdout (same stream as the summary), never stderr.
    assert.match(r.stdout, /Auto-detected activeProvider = claude/);
    assert.doesNotMatch(r.stderr, /Auto-detected activeProvider/);
    // And it ends in a newline so the summary lands on its own line
    // (the bug was a missing newline gluing the two together).
    assert.match(r.stdout, /settings\.json\.\n/);
  });

  /**
   * A dry run reports what a scan WOULD do and must leave the project
   * byte-identical. The auto-detect persist ignored `--dry-run`, so a dry
   * run against a project with no `settings.json` CREATED one, which is a
   * mutation no dry run is allowed to perform (found while dry-scanning a
   * fixture for comparison: it came back dirty).
   */
  it('--dry-run resolves the lens without writing settings.json', () => {
    const scope = freshScope('dry');
    mkdirSync(join(scope.cwd, '.claude', 'agents'), { recursive: true });
    writeFileSync(
      join(scope.cwd, '.claude', 'agents', 'a.md'),
      '---\nname: a\ntools: [Read]\n---\n\n# a\n\nbody\n',
    );
    assert.equal(sm(['init', '--no-scan'], scope).status, 0);

    const settings = join(scope.cwd, '.skill-map', 'settings.json');
    rmSync(settings, { force: true });

    const r = sm(['scan', '--dry-run'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(existsSync(settings), false, 'a dry run must not create settings.json');

    // The real scan still persists it, so nothing is lost, only deferred.
    assert.equal(sm(['scan'], scope).status, 0);
    assert.equal(existsSync(settings), true);
  });

  it('omits the auto-detect line when the lens is already in config', () => {
    const scope = freshScope('cached');
    mkdirSync(join(scope.cwd, '.claude', 'agents'), { recursive: true });
    writeFileSync(
      join(scope.cwd, '.claude', 'agents', 'a.md'),
      '---\nname: a\ntools: [Read]\n---\n\n# a\n\nbody\n',
    );
    assert.equal(sm(['init', '--no-scan'], scope).status, 0);
    // First scan persists the lens.
    assert.equal(sm(['scan'], scope).status, 0);

    // Second scan reads the lens from config, so it must NOT re-announce.
    const r = sm(['scan'], scope);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.doesNotMatch(r.stdout, /Auto-detected activeProvider/);
  });
});
