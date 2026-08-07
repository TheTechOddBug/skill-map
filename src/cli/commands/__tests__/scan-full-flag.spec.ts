/**
 * Flag-gate tests for `sm scan --full` (spec `cli-contract.md` §Scan,
 * incremental-by-default flip). The mutex gates run before
 * `runScanForCommand`, so the invalid combos short-circuit at the CLI
 * seam (no DB, no filesystem walk). Same in-process Clipanion harness
 * as `scan-flags.spec.ts`.
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

describe('sm scan --full flag gates', () => {
  it('rejects --full --changed with exit 2 and the mutex message', async () => {
    const cap = captureContext();
    const exit = await buildCli().run(['scan', '--full', '--changed'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /--full and --changed cannot be combined/);
  });

  it('rejects --watch --full with exit 2 and the watch-conflict message', async () => {
    const cap = captureContext();
    const exit = await buildCli().run(['scan', '--watch', '--full'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /--watch cannot be combined with --full/);
  });
});
