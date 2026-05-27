/**
 * Flag-validation tests for `sm watch --max-nodes <N>`.
 *
 * `parseMaxNodesLimit()` runs before `runWatchLoop`, so invalid values
 * short-circuit at the CLI seam and never reach the chokidar wiring.
 * The harness drives the verb through Clipanion's `Cli.run` with a
 * captured `BaseContext` to assert the exit code + stderr block,
 * mirroring `serve-flags.spec.ts`.
 *
 * Note: `parseMaxNodesLimit` writes the rejection block straight to
 * `context.stderr` (no `printer` indirection), so the captured stderr
 * carries the literal `WATCH_TEXTS.maxNodesInvalid` template output.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Builtins, Cli } from 'clipanion';
import type { BaseContext } from 'clipanion';

import { WatchCommand } from '../watch.js';
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
  cli.register(Builtins.HelpCommand);
  cli.register(WatchCommand);
  return cli;
}

describe('sm watch, --max-nodes validation', () => {
  it('rejects --max-nodes 0 with exit 2 and a clear hint', async () => {
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['watch', '--max-nodes', '0'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(
      cap.stderr(),
      /sm watch: --max-nodes must be an integer >= 1 \(got 0\)/,
      cap.stderr(),
    );
    assert.match(cap.stderr(), /Pass a positive integer/, cap.stderr());
  });

  it('rejects --max-nodes=-1 (negative) with exit 2', async () => {
    // Clipanion reads a bare `-1` as a separate short option, so the
    // `=` form is the only shape that hands a negative number to the
    // parser unchanged.
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['watch', '--max-nodes=-1'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(
      cap.stderr(),
      /sm watch: --max-nodes must be an integer >= 1 \(got -1\)/,
      cap.stderr(),
    );
  });

  it('rejects --max-nodes 3.14 (non-integer) with exit 2', async () => {
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['watch', '--max-nodes', '3.14'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(
      cap.stderr(),
      /sm watch: --max-nodes must be an integer >= 1 \(got 3\.14\)/,
      cap.stderr(),
    );
  });

  it('rejects --max-nodes nope (non-numeric) with exit 2', async () => {
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['watch', '--max-nodes', 'nope'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(
      cap.stderr(),
      /sm watch: --max-nodes must be an integer >= 1 \(got nope\)/,
      cap.stderr(),
    );
  });
});
