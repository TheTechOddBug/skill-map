/**
 * Channel-discipline tests for `sm help`.
 *
 * `HelpCommand` / `RootHelpCommand` extend Clipanion's `Command`
 * directly (not `SmCommand`), so they carry an explicit exemption from
 * the printer-discipline lint rule in `src/eslint.config.js` (the rule
 * that bans direct `this.context.std{out,err}.write` everywhere else).
 * That makes the help renderer the one verb whose stdout/stderr routing
 * is NOT structurally enforced, exactly the seam where the pre-M4
 * regression ("a verb landed JSON output on stderr and nobody noticed
 * for two releases") could recur unobserved.
 *
 * These tests pin the contract with an executable check instead of
 * reviewer vigilance:
 *   - every rendered surface (json / md / human / single-verb) lands on
 *     stdout, never stderr;
 *   - `--format json` produces a parseable JSON document on stdout;
 *   - the error paths (invalid format, unknown verb) land on stderr,
 *     never stdout, with the documented exit codes.
 *
 * Harness mirrors `scan-flags.spec.ts`: drive the verb through
 * Clipanion's `Cli.run` with a captured `BaseContext`.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Cli } from 'clipanion';
import type { BaseContext } from 'clipanion';

import { HelpCommand } from '../help.js';
import { ScanCommand } from '../scan.js';
import { ExitCode } from '../../util/exit-codes.js';

interface ICapture {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapture {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const context = {
    stdin: process.stdin,
    stdout: { write: (s: string) => { stdoutChunks.push(s); return true; } },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
  } as unknown as BaseContext;
  return {
    context,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

function buildCli(): Cli {
  const cli = new Cli({ binaryName: 'sm', binaryLabel: 'skill-map', binaryVersion: '0.0.0' });
  cli.register(HelpCommand);
  cli.register(ScanCommand);
  return cli;
}

describe('sm help, channel discipline', () => {
  it('--format json writes the document to stdout, nothing to stderr', async () => {
    const cap = captureContext();
    const exit = await buildCli().run(['help', '--format', 'json'], cap.context);
    assert.equal(exit, ExitCode.Ok);
    assert.equal(cap.stderr(), '', `stderr must stay empty, got: ${cap.stderr()}`);
    // The JSON document is on stdout and round-trips through JSON.parse.
    const parsed = JSON.parse(cap.stdout()) as { verbs: unknown[] };
    assert.ok(Array.isArray(parsed.verbs), 'stdout JSON carries the verbs array');
  });

  it('--format md writes markdown to stdout, nothing to stderr', async () => {
    const cap = captureContext();
    const exit = await buildCli().run(['help', '--format', 'md'], cap.context);
    assert.equal(exit, ExitCode.Ok);
    assert.equal(cap.stderr(), '', `stderr must stay empty, got: ${cap.stderr()}`);
    assert.ok(cap.stdout().length > 0, 'markdown lands on stdout');
  });

  it('human overview (default format) writes to stdout, nothing to stderr', async () => {
    const cap = captureContext();
    const exit = await buildCli().run(['help'], cap.context);
    assert.equal(exit, ExitCode.Ok);
    assert.equal(cap.stderr(), '', `stderr must stay empty, got: ${cap.stderr()}`);
    assert.ok(cap.stdout().length > 0, 'overview lands on stdout');
  });

  it('single-verb detail writes to stdout, nothing to stderr', async () => {
    const cap = captureContext();
    const exit = await buildCli().run(['help', 'scan'], cap.context);
    assert.equal(exit, ExitCode.Ok);
    assert.equal(cap.stderr(), '', `stderr must stay empty, got: ${cap.stderr()}`);
    assert.match(cap.stdout(), /scan/, cap.stdout());
  });

  it('invalid --format writes the error to stderr, nothing to stdout', async () => {
    const cap = captureContext();
    const exit = await buildCli().run(['help', '--format', 'bogus'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.equal(cap.stdout(), '', `stdout must stay empty, got: ${cap.stdout()}`);
    assert.match(cap.stderr(), /bogus/, cap.stderr());
  });

  it('unknown verb writes the error to stderr, nothing to stdout', async () => {
    const cap = captureContext();
    const exit = await buildCli().run(['help', 'definitely-not-a-verb'], cap.context);
    assert.equal(exit, ExitCode.NotFound);
    assert.equal(cap.stdout(), '', `stdout must stay empty, got: ${cap.stdout()}`);
    assert.match(cap.stderr(), /definitely-not-a-verb/, cap.stderr());
  });
});
