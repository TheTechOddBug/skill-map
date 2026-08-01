/**
 * Coverage for the global unhandled-error boundary in
 * `SmCommand.execute()` (review finding H1, 2026-07-28): an error
 * escaping a verb's `run()` must exit `Error` (2) with a §3.1b block on
 * stderr, never Clipanion's generic exit 1, which would collide with
 * the public `1 = issues found` contract (spec/cli-contract.md §Exit
 * codes). `--log debug` additionally surfaces the stack trace.
 */

import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { Cli } from 'clipanion';
import type { BaseContext } from 'clipanion';

import { SmCommand } from '../sm-command.js';
import { ExitCode } from '../exit-codes.js';
import { configureLogger, resetLogger } from '../../../kernel/util/logger.js';
import { Logger } from '../logger.js';

const CRASH_MESSAGE = 'boundary-probe-crash';

class CrashCommand extends SmCommand {
  static override paths = [['crash']];
  protected override emitElapsed = false;

  protected async run(): Promise<number> {
    throw new Error(CRASH_MESSAGE);
  }
}

interface ICapture {
  context: BaseContext;
  stderr: () => string;
  stdout: () => string;
}

function captureContext(): ICapture {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const context = {
    stdin: process.stdin,
    stdout: { write: (s: string) => { stdoutChunks.push(s); return true; } },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
  } as unknown as BaseContext;
  return { context, stderr: () => stderrChunks.join(''), stdout: () => stdoutChunks.join('') };
}

function buildCli(): Cli {
  const cli = new Cli({ binaryName: 'sm', binaryLabel: 'skill-map', binaryVersion: '0.0.0' });
  cli.register(CrashCommand);
  return cli;
}

describe('SmCommand unhandled-error boundary', () => {
  // The debug-level spec reconfigures the process-global kernel logger
  // onto the captured stream; restore the default so no other spec
  // inherits it.
  afterEach(() => resetLogger());

  it('a throw escaping run() exits Error (2), not Clipanion generic 1', async () => {
    const cap = captureContext();
    const exit = await buildCli().run(['crash'], cap.context);
    assert.equal(exit, ExitCode.Error);
  });

  it('renders the §3.1b block on stderr and keeps stdout clean', async () => {
    const cap = captureContext();
    await buildCli().run(['crash'], cap.context);
    assert.ok(cap.stderr().includes('✕'), cap.stderr());
    assert.ok(cap.stderr().includes(CRASH_MESSAGE), cap.stderr());
    assert.equal(cap.stdout(), '');
  });

  it('hides the stack by default, surfaces it at debug level', async () => {
    // Keyed on the RESOLVED log level, not a `-v` counter: `-v` is the
    // `--version` alias, and verbosity is the named `--log` /
    // `--log-level` parameter resolved at process boot. The level is
    // installed directly here because `run()` bypasses that boot step.
    const quiet = captureContext();
    await buildCli().run(['crash'], quiet.context);
    assert.ok(!quiet.stderr().includes('at '), quiet.stderr());

    configureLogger(new Logger({ level: 'debug', stream: captureContext().context.stderr }));
    try {
      const verbose = captureContext();
      await buildCli().run(['crash'], verbose.context);
      assert.ok(verbose.stderr().includes('at '), verbose.stderr());
    } finally {
      resetLogger();
    }
  });
});
