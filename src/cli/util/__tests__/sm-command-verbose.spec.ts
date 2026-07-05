/**
 * Regression coverage for review finding m1 (2026-07-05):
 * `SmCommand.applyVerboseLogger()` must build the `-v` kernel logger
 * on `this.context.stderr`, not `process.stderr` (context/kernel.md
 * rule 6: commands take streams from the Clipanion context). Before
 * the fix, `-v`-elevated log lines bypassed captured streams
 * entirely, so any harness (tests, embedding drivers) lost the
 * verbose channel.
 */

import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { Cli } from 'clipanion';
import type { BaseContext } from 'clipanion';

import { SmCommand } from '../sm-command.js';
import { ExitCode } from '../exit-codes.js';
import { log, resetLogger } from '../../../kernel/util/logger.js';

const PROBE_LINE = 'verbose-probe-line';

class ProbeCommand extends SmCommand {
  static override paths = [['probe']];
  protected override emitElapsed = false;

  protected async run(): Promise<number> {
    log.info(PROBE_LINE);
    return ExitCode.Ok;
  }
}

interface ICapture {
  context: BaseContext;
  stderr: () => string;
}

function captureContext(): ICapture {
  const stderrChunks: string[] = [];
  const context = {
    stdin: process.stdin,
    stdout: { write: (): boolean => true },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
  } as unknown as BaseContext;
  return { context, stderr: () => stderrChunks.join('') };
}

function buildCli(): Cli {
  const cli = new Cli({ binaryName: 'sm', binaryLabel: 'skill-map', binaryVersion: '0.0.0' });
  cli.register(ProbeCommand);
  return cli;
}

describe('SmCommand -v verbose logger stream', () => {
  // The kernel logger is a process-global singleton; restore the
  // default SilentLogger so no other spec inherits the probe wiring.
  afterEach(() => resetLogger());

  it('without -v the info-level line stays silent (SilentLogger default)', async () => {
    resetLogger();
    const cap = captureContext();
    const exit = await buildCli().run(['probe'], cap.context);
    assert.equal(exit, ExitCode.Ok);
    assert.ok(!cap.stderr().includes(PROBE_LINE), cap.stderr());
  });

  it('with -v the info-level line lands on the CONTEXT stderr, not process.stderr', async () => {
    const cap = captureContext();
    const exit = await buildCli().run(['probe', '-v'], cap.context);
    assert.equal(exit, ExitCode.Ok);
    assert.ok(cap.stderr().includes(PROBE_LINE), cap.stderr());
  });
});
