/**
 * Flag-validation tests for `sm scan --max-nodes <N>`.
 *
 * `parseMaxNodesFlag()` runs before `runScanForCommand`, so invalid
 * values short-circuit at the CLI seam and never reach the orchestrator
 * (no DB, no filesystem walk). The harness drives the verb through
 * Clipanion's `Cli.run` with a captured `BaseContext` to assert the
 * exit code + stderr block, mirroring the pattern in
 * `serve-flags.spec.ts`.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Builtins, Cli } from 'clipanion';
import type { BaseContext } from 'clipanion';

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
  cli.register(Builtins.HelpCommand);
  cli.register(ScanCommand);
  return cli;
}

describe('sm scan, --max-nodes validation', () => {
  it('rejects --max-nodes 0 with exit 2 and a clear hint', async () => {
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['scan', '--max-nodes', '0'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(
      cap.stderr(),
      /--max-nodes must be an integer >= 1 \(got `0`\)/,
      cap.stderr(),
    );
    assert.match(cap.stderr(), /Pass a positive integer/, cap.stderr());
  });

  it('rejects --max-nodes=-3 (negative) with exit 2', async () => {
    // Clipanion reads a bare `-3` as a separate short option, so the
    // `=` form is the only shape that hands a negative number to the
    // parser unchanged.
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['scan', '--max-nodes=-3'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(
      cap.stderr(),
      /--max-nodes must be an integer >= 1 \(got `-3`\)/,
      cap.stderr(),
    );
  });

  it('rejects --max-nodes 2.5 (non-integer) with exit 2', async () => {
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['scan', '--max-nodes', '2.5'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(
      cap.stderr(),
      /--max-nodes must be an integer >= 1 \(got `2\.5`\)/,
      cap.stderr(),
    );
  });

  it('rejects --max-nodes xyz (non-numeric) with exit 2', async () => {
    const cap = captureContext();
    const cli = buildCli();
    const exit = await cli.run(['scan', '--max-nodes', 'xyz'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(
      cap.stderr(),
      /--max-nodes must be an integer >= 1 \(got `xyz`\)/,
      cap.stderr(),
    );
  });
});
