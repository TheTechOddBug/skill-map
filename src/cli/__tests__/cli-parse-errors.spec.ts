/**
 * Verifies the entry-level parse-error handler that replaces Clipanion's
 * default full-catalog dump with a concise one-screen diagnostic.
 *
 * Coverage:
 *   - exit code is `2` (operational error per spec/cli-contract.md)
 *   - diagnostic goes to stderr, NOT stdout (Clipanion's default leaks
 *     errors to stdout, which breaks `sm <verb> | jq` pipelines)
 *   - single-dash long flag → `--` suggestion (`-version` → `--version`)
 *   - typo on a known verb → edit-distance suggestion (`sacn` → `scan`)
 *   - unknown flag on a known verb → message scoped to the verb
 *   - incomplete namespace (`sm db`) → list of subcommands
 *   - happy paths (`--version`, `help`) still work
 *   - `-v` IS the `--version` alias, and a global flag placed before the
 *     verb is not swallowed into `sm serve`
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', '..', 'bin', 'sm.js');

interface IRun {
  status: number;
  stdout: string;
  stderr: string;
}

// Isolate HOME so the spawned binary reads an empty
// `~/.skill-map/settings.json` (no telemetry opt-in → the usage surface
// stays dormant), so running this spec never emits a PostHog event.
let homeDir: string;

// Isolate the CWD too, and for a sharper reason: several cases here
// assert what a VERB-LESS argv does, and `sm` with no verb fans out to
// `sm serve` when the current directory holds a project. Inheriting the
// runner's cwd made that a coin flip on whether a stray `.skill-map/`
// existed, and when it did the spawned process became a SERVER that
// never exits, hanging the whole file instead of failing. An empty temp
// directory makes "no project here" a property of the test rather than
// of the machine it runs on.
let cwdDir: string;

before(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'skill-map-parse-errors-home-'));
  cwdDir = mkdtempSync(join(tmpdir(), 'skill-map-parse-errors-cwd-'));
});

after(() => {
  rmSync(homeDir, { recursive: true, force: true });
  rmSync(cwdDir, { recursive: true, force: true });
});

function sm(args: string[]): IRun {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: cwdDir,
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, NO_COLOR: '1' },
    // Belt and braces: if a future case ever does spawn something
    // long-running, fail the assertion instead of hanging the suite.
    timeout: 30_000,
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('CLI parse-error handler', () => {
  it('rejects single-dash long option with --version suggestion', () => {
    const r = sm(['-version']);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /unknown option '-version'/);
    assert.match(r.stderr, /Did you mean '--version'\?/);
    assert.match(r.stderr, /Run 'sm help'/);
  });

  it('rejects single-dash -help with --help suggestion', () => {
    const r = sm(['-help']);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /unknown option '-help'/);
    assert.match(r.stderr, /Did you mean '--help'\?/);
  });

  it('caps the diagnostic to a few lines (no full-catalog dump)', () => {
    const r = sm(['-version']);
    const lines = r.stderr.trim().split('\n');
    assert.ok(lines.length <= 5, `expected at most 5 stderr lines, got ${lines.length}: ${r.stderr}`);
  });

  it('suggests the closest verb on a typo', () => {
    const r = sm(['sacn']);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /unknown command 'sacn'/);
    assert.match(r.stderr, /Did you mean 'scan'/);
  });

  it('emits no suggestion when no verb is close enough', () => {
    const r = sm(['fooooo']);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /unknown command 'fooooo'/);
    assert.doesNotMatch(r.stderr, /Did you mean/);
    assert.match(r.stderr, /Run 'sm help'/);
  });

  it('scopes the diagnostic to the verb when the verb is valid but the flag is not', () => {
    const r = sm(['scan', '--definitely-not-a-flag']);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /scan: unknown option '--definitely-not-a-flag'/);
  });

  it('rewrites Clipanion\'s "Not enough positional arguments" with the missing positional names', () => {
    // `sm show` requires <nodePath>; running it bare should surface the
    // missing positional name explicitly, not just the cryptic
    // "Not enough positional arguments" which leaves users guessing.
    const r = sm(['show']);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /show: missing required positional argument\(s\) <nodePath>/);
    assert.match(r.stderr, /Run 'sm help show' for usage/);
    // The redundant Clipanion usage hint line ("$ sm show [...]") must
    // be stripped, `sm help show` is the single point of truth.
    assert.doesNotMatch(r.stderr, /\$ sm show \[/);
  });

  it('lists subcommands on an incomplete namespace invocation', () => {
    const r = sm(['db']);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /incomplete command 'db'/);
    assert.match(r.stderr, /Available subcommands: 'db backup'/);
    // Footer points at the namespace overview (full subcommand list),
    // not the generic full-command-list pointer.
    assert.match(r.stderr, /Run 'sm help db' to see all subcommands\./);
  });

  it('a namespace with more than three subcommands reports the remainder count', () => {
    // `jobs` registers nine subcommands; the sample shows three and the
    // line must not read as exhaustive (observed live: "Available
    // subcommands: 'jobs cancel', 'jobs claim', or 'jobs fail'." implied
    // that was all of them).
    const r = sm(['jobs']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /incomplete command 'jobs'/);
    assert.match(
      r.stderr,
      /Available subcommands: 'jobs cancel', 'jobs claim', 'jobs fail', and \d+ more\./,
    );
    assert.match(r.stderr, /Run 'sm help jobs' to see all subcommands\./);
  });

  it('still serves --version (Clipanion built-in)', () => {
    const r = sm(['--version']);
    assert.equal(r.status, 0);
    assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  // `-v` is the `--version` alias, the meaning every other CLI gives it.
  // A verbosity counter briefly took the path; it cost `sm -v` its
  // universal behaviour and, with no verb to run, sent it into the bare
  // `sm serve` fan-out where it HUNG. Verbosity is `--log` / `--log-level`.
  it('serves -v as the version alias', () => {
    const r = sm(['-v']);
    assert.equal(r.status, 0);
    assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  it('accepts a global flag placed BEFORE the verb', () => {
    const r = sm(['--no-color', 'version']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^\s*sm\s+\d+\.\d+\.\d+/m);
  });

  it('answers a verb-less global flag instead of launching serve', () => {
    // The bare-`sm <flags>` fan-out exists for server flags
    // (`sm --max-nodes 5`). A lone `-q` carries no such intent, and
    // routing it to `serve` would start a long-running process for what
    // reads like a question.
    const r = sm(['-q']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /is a global flag, not a command/);
  });

  it('does not swallow --json into serve when a verb follows', () => {
    const r = sm(['--json', 'version']);
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stderr, /Extraneous positional argument/);
    assert.match(r.stdout.trim(), /^\{/);
  });
});
