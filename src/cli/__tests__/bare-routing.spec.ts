/**
 * Bare-invocation routing tests. Verifies the behaviour added in
 * `d3c47b22`: when the user types `sm --flag <value>` (no verb, first
 * token is a flag), the entry-level dispatcher rewrites the argv to
 * `sm serve --flag <value>` so server-level flags like `--max-nodes`
 * work without typing `serve` explicitly.
 *
 * The fixture plants an empty `.skill-map/skill-map.db` file inside a
 * tmpdir so the `existsSync` gate in `resolveBareInvocation` passes
 * (the file just needs to exist; the `sm serve` validation we
 * exercise rejects the flag value BEFORE any DB open, so a zero-byte
 * placeholder is enough).
 *
 * Test oracle: the rewritten argv reaches `ServeCommand`, which prints
 * the `sm serve: --max-nodes …` block on rejection. A bare invocation
 * that did NOT route would surface either the bare-no-project hint
 * (when no DB) or a Clipanion parse error (no command match).
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', '..', 'bin', 'sm.js');

interface IRun {
  status: number;
  stdout: string;
  stderr: string;
}

function smIn(cwd: string, args: string[]): IRun {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

let tmpProject: string;

before(() => {
  tmpProject = mkdtempSync(join(tmpdir(), 'skill-map-bare-routing-'));
  // Plant a fake project DB. Routing only checks `existsSync`, so a
  // zero-byte file is enough; the validation we trigger below exits
  // before any sqlite open would happen.
  mkdirSync(join(tmpProject, '.skill-map'), { recursive: true });
  writeFileSync(join(tmpProject, '.skill-map', 'skill-map.db'), '');
});

after(() => {
  rmSync(tmpProject, { recursive: true, force: true });
});

describe('bare `sm`, flag-first invocation', () => {
  it('routes `sm --max-nodes 0` to `sm serve --max-nodes 0`', () => {
    // `--max-nodes 0` rejects in `ServeCommand` with the "sm serve:"
    // prefix. Seeing that prefix proves the routing rewrote the argv
    // and dispatched the serve verb.
    const r = smIn(tmpProject, ['--max-nodes', '0']);
    assert.equal(r.status, 2);
    assert.match(
      r.stderr,
      /sm serve: --max-nodes must be an integer >= 1 \(got 0\)/,
      r.stderr,
    );
  });

  it('routes `sm --max-nodes=abc` to serve and surfaces the validation block', () => {
    const r = smIn(tmpProject, ['--max-nodes=abc']);
    assert.equal(r.status, 2);
    assert.match(
      r.stderr,
      /sm serve: --max-nodes must be an integer >= 1 \(got abc\)/,
      r.stderr,
    );
  });

  it('does NOT route `sm --help` (passthrough flag)', () => {
    // `--help` is on the passthrough allowlist, so it reaches the
    // root help command. Root help prints to stdout with the binary
    // banner; serve's validation never fires.
    const r = smIn(tmpProject, ['--help']);
    assert.equal(r.status, 0);
    // No serve-rejection block in stderr.
    assert.doesNotMatch(r.stderr, /sm serve:/, r.stderr);
    // Help output reaches stdout.
    const combined = r.stdout + r.stderr;
    assert.match(combined, /sm/, combined);
  });

  it('does NOT route `sm --version` (passthrough flag)', () => {
    const r = smIn(tmpProject, ['--version']);
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stderr, /sm serve:/, r.stderr);
  });

  it('does NOT route `sm scan` (first token is a verb, not a flag)', () => {
    // `scan` is a verb; the bare-routing analyzer requires the first
    // token to start with `-`. ScanCommand handles the invocation
    // directly. We do not assert success/failure of the scan itself
    // (the tmpdir has no scannable content beyond `.skill-map/`), only
    // that the serve-rejection block does not appear, which would only
    // happen if routing had hijacked the argv.
    const r = smIn(tmpProject, ['scan', '--no-built-ins', '--no-plugins', '--allow-empty']);
    assert.doesNotMatch(r.stderr, /sm serve:/, r.stderr);
  });
});

describe('bare `sm`, no project DB', () => {
  let emptyDir: string;
  before(() => {
    emptyDir = mkdtempSync(join(tmpdir(), 'skill-map-bare-routing-noproj-'));
  });
  after(() => {
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('rejects `sm --max-nodes 5` with the no-project hint when no DB exists', () => {
    // Same flag-first invocation, but the cwd has no `.skill-map/`
    // directory, so the routing falls through to `resolveBareDefault`
    // which exits with the bare-no-project hint. Serve is never
    // reached, so the stderr does NOT carry the serve-rejection block.
    const r = smIn(emptyDir, ['--max-nodes', '5']);
    assert.equal(r.status, 2);
    assert.doesNotMatch(r.stderr, /sm serve:/, r.stderr);
    // The no-project hint mentions the cwd. Match loosely so tests do
    // not couple to the exact wording of `ENTRY_TEXTS.bareNoProject`.
    assert.ok(r.stderr.length > 0, 'expected a non-empty stderr hint');
  });
});
