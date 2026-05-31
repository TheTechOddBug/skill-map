/**
 * Flag-validation tests for the `sm serve` CLI verb (Step 14.1).
 *
 * These tests drive the verb through Clipanion's `Cli.run` so the flag
 * parsing + envelope + exit code mapping are exercised end-to-end,
 * exactly what `validateServerOptions` plus `ServeCommand.run` produce
 * when invoked from a real shell.
 *
 * For combinations that would actually bind a port (`--port 0`, etc.)
 * we reach for `--ui-dist <missing>` to short-circuit at the validation
 * layer, no listener is opened, so no cleanup is required.
 *
 * Boot-and-shut-down test for the legitimate path lives in
 * `server-boot.test.ts`; this file focuses on rejection.
 */

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { after, before, describe, it } from 'node:test';
import { Builtins, Cli } from 'clipanion';
import type { BaseContext } from 'clipanion';

import { ServeCommand } from '../serve.js';
import { ExitCode } from '../../util/exit-codes.js';

interface ICapture {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(stdin: NodeJS.ReadableStream = process.stdin): ICapture {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const context = {
    stdin,
    stdout: { write: (s: string) => { stdoutChunks.push(s); return true; } },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
  } as unknown as BaseContext;
  return {
    context,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

/** A readable that looks like a TTY and yields one answer line. */
function ttyStdin(answer: string): NodeJS.ReadableStream {
  const r = Readable.from([`${answer}\n`]) as Readable & { isTTY?: boolean };
  r.isTTY = true;
  return r;
}

/**
 * Build a stale DB (same major.minor, but a `scan_meta` row WITHOUT the
 * `schema_fingerprint` column = a pre-fingerprint DB) so the pre-boot
 * drift check trips on the schema axis.
 */
function makeStaleDb(dir: string): string {
  const p = join(dir, 'stale.db');
  const db = new DatabaseSync(p);
  db.exec('CREATE TABLE scan_meta (scanned_by_version TEXT NOT NULL)');
  db.prepare('INSERT INTO scan_meta (scanned_by_version) VALUES (?)').run('0.0.0');
  db.close();
  return p;
}

/** Minimal valid UI bundle so `serve` clears the ui-dist resolution. */
function makeUiBundle(dir: string): string {
  const distDir = join(dir, 'ui-bundle-drift');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><html></html>');
  return distDir;
}

function buildCli(): Cli {
  const cli = new Cli({ binaryName: 'sm', binaryLabel: 'skill-map', binaryVersion: '0.0.0' });
  cli.register(Builtins.HelpCommand);
  cli.register(ServeCommand);
  return cli;
}

let tmpRoot: string;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-server-flags-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('sm serve, flag validation', () => {
  it('rejects --host 0.0.0.0 + --dev-cors with exit 2 and a clear hint', async () => {
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['serve', '--host', '0.0.0.0', '--dev-cors'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(
      cap.stderr(),
      /--dev-cors requires a loopback --host \(got 0\.0\.0\.0\)/,
      cap.stderr(),
    );
  });

  it('rejects --port 99999 (out of range) with exit 2', async () => {
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['serve', '--port', '99999'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /--port must be an integer in \[0, 65535\]/, cap.stderr());
  });

  it('rejects --port abc (non-numeric) with exit 2', async () => {
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['serve', '--port', 'abc'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /--port must be a non-negative integer/, cap.stderr());
  });

  it('rejects --scope as unknown option (the flag was removed post-cleanup)', async () => {
    const cap = captureContext();
    const cli = buildCli();
    // Clipanion's unknown-option exit code through `cli.run()` is 1
    // (`sm` script translates to ExitCode.Error / 2 at the OS level).
    // Clipanion emits the "Unsupported option name" message via the
    // captured stdout/stderr depending on builtin wiring.
    const exit = await cli.run(['serve', '--scope', 'nonsense'], cap.context);
    assert.notEqual(exit, 0, 'expected a non-zero exit');
    const combined = cap.stdout() + cap.stderr();
    assert.match(combined, /Unsupported option name.*--scope/, combined);
  });

  it('rejects --ui-dist <missing> with exit 2 (explicit path requires existence)', async () => {
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(
      ['serve', '--ui-dist', join(tmpRoot, 'does-not-exist')],
      cap.context,
    );
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /does not exist/, cap.stderr());
  });

  it('emits a non-fatal warning when --no-ui is combined with the default --open', async () => {
    // Combining --no-ui with the default --open auto-opens the placeholder,
    // which is almost certainly not what the operator intended. The verb
    // emits a stderr hint suggesting --no-open but does NOT reject, the
    // request is honored. To avoid binding a real listener, we pair the
    // combo with a bailout (--host 0.0.0.0 + --dev-cors) that fails at
    // the post-warning validation step. Both messages should appear in
    // stderr; the warning fires BEFORE the rejection.
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(
      ['serve', '--no-ui', '--host', '0.0.0.0', '--dev-cors'],
      cap.context,
    );
    assert.equal(exit, ExitCode.Error);
    const stderr = cap.stderr();
    assert.match(
      stderr,
      /warning: --open with --no-ui will open the placeholder/,
      stderr,
    );
    // The bailout that drove the exit code:
    assert.match(stderr, /--dev-cors requires a loopback --host/, stderr);
    // Ordering invariant: warning appears before the rejection.
    const warnIdx = stderr.indexOf('warning: --open with --no-ui');
    const errIdx = stderr.indexOf('--dev-cors requires');
    assert.ok(warnIdx >= 0 && errIdx >= 0 && warnIdx < errIdx, stderr);
  });

  it('does NOT emit the --no-ui/--open warning when --no-open is set explicitly', async () => {
    // Counterpart to the warning test: a deliberate --no-open should
    // never trigger the hint. Use the same dev-cors bailout to avoid
    // binding.
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(
      ['serve', '--no-ui', '--no-open', '--host', '0.0.0.0', '--dev-cors'],
      cap.context,
    );
    assert.equal(exit, ExitCode.Error);
    assert.doesNotMatch(
      cap.stderr(),
      /warning: --open with --no-ui/,
      cap.stderr(),
    );
  });

  it('rejects --no-ui combined with --ui-dist <path> with exit 2', async () => {
    const distDir = join(tmpRoot, 'ui-bundle-conflict');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><html></html>');

    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(
      ['serve', '--no-ui', '--ui-dist', distDir],
      cap.context,
    );
    assert.equal(exit, ExitCode.Error);
    assert.match(
      cap.stderr(),
      /--no-ui and --ui-dist .* are mutually exclusive/,
      cap.stderr(),
    );
  });

  it('rejects --max-nodes 0 with exit 2 and a clear hint', async () => {
    // The `--max-nodes` cap is `>= 1`. Zero is the canonical degenerate
    // value: it would silently turn every scan into "drop everything",
    // so we exit at parse time with a hint pointing at the right shape.
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['serve', '--max-nodes', '0'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(
      cap.stderr(),
      /sm serve: --max-nodes must be an integer >= 1 \(got 0\)/,
      cap.stderr(),
    );
    assert.match(cap.stderr(), /Pass a positive integer/, cap.stderr());
  });

  it('rejects --max-nodes=-5 (negative integer) with exit 2', async () => {
    // Clipanion reads a bare `-5` after a flag as a new short option,
    // so the only way the user can deliver a negative value to the
    // parser is via the `=` form, which is exactly what we test here.
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['serve', '--max-nodes=-5'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(
      cap.stderr(),
      /sm serve: --max-nodes must be an integer >= 1 \(got -5\)/,
      cap.stderr(),
    );
  });

  it('rejects --max-nodes 1.5 (non-integer) with exit 2', async () => {
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['serve', '--max-nodes', '1.5'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(
      cap.stderr(),
      /sm serve: --max-nodes must be an integer >= 1 \(got 1\.5\)/,
      cap.stderr(),
    );
  });

  it('rejects --max-nodes abc (non-numeric) with exit 2', async () => {
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['serve', '--max-nodes', 'abc'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(
      cap.stderr(),
      /sm serve: --max-nodes must be an integer >= 1 \(got abc\)/,
      cap.stderr(),
    );
  });

  it('prompts on schema drift and aborts boot when the operator declines (exit 2)', async () => {
    // A stale DB (recorded version differs from the running CLI) trips
    // the pre-boot drift check. With a TTY stdin answering `n`, the verb
    // aborts BEFORE `createServer` (so no port is bound) and the DB file
    // is left untouched.
    const dir = mkdtempSync(join(tmpRoot, 'serve-drift-decline-'));
    const dbPath = makeStaleDb(dir);
    const uiDist = makeUiBundle(dir);

    const cap = captureContext(ttyStdin('n'));
    const cli = buildCli();
    const exit = await cli.run(
      ['serve', '--db', dbPath, '--ui-dist', uiDist, '--no-open', '--port', '0'],
      cap.context,
    );
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /cache rebuild declined/, cap.stderr());
    assert.ok(existsSync(dbPath), 'declining the rebuild never deletes the cache');
  });

  it('accepts --ui-dist when the directory contains index.html', async () => {
    // Build a minimal valid bundle so the validator + UI-dist resolver
    // both clear; we then immediately rely on flag-validation rejecting
    // an invalid combination so we never actually bind a listener.
    const distDir = join(tmpRoot, 'ui-bundle');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><html></html>');

    // Re-trigger a known-bad-combo (`--dev-cors` + `--host 0.0.0.0`)
    // AFTER the ui-dist check passes, proving the verb walked through
    // the bundle resolution without erroring there.
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(
      ['serve', '--ui-dist', distDir, '--host', '0.0.0.0', '--dev-cors'],
      cap.context,
    );
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /--dev-cors requires a loopback --host/, cap.stderr());
  });
});
