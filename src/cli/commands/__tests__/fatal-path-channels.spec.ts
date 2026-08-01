/**
 * Regression coverage for review finding M1 (2026-07-05): fatal-path
 * messages must reach stderr even under `--json` / `-q`. Before the
 * fix, 44 sites across 9 verbs emitted the `✕` error block via
 * `printer.info()`, which `SmCommand.execute()` silences when
 * `quietInfo: quiet || json` is set, so the verbs exited non-zero
 * with zero bytes of explanation exactly when a machine consumer was
 * watching. Per spec/cli-contract.md §Exit codes, operational errors
 * are "accompanied by an error message on stderr", and `-q`
 * suppresses only non-error stderr.
 *
 * The static guard is the `no-restricted-syntax` adjacent-sibling
 * selector in `eslint.config.js` (cli/commands block); these tests
 * pin the runtime semantics through Clipanion's `Cli.run` for two
 * cheap early-validation gates that need no DB / FS fixture:
 *
 *   - `sm serve --port abc` (portInvalid, ExitCode.Error)
 *   - `sm enrich <node> --stale` / bare `sm enrich` (argument
 *     gates, ExitCode.Error)
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Builtins, Cli } from 'clipanion';
import type { BaseContext } from 'clipanion';

import { ServeCommand } from '../serve.js';
import { EnrichCommand } from '../enrich.js';
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
  cli.register(ServeCommand);
  cli.register(EnrichCommand);
  return cli;
}

describe('fatal-path channel discipline (--json / -q keep errors visible)', () => {
  it('sm serve --port abc --json: exit 2, error on stderr, stdout untouched', async () => {
    const cap = captureContext();
    const exit = await buildCli().run(['serve', '--port', 'abc', '--json'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /--port must be a non-negative integer/, cap.stderr());
    assert.equal(cap.stdout(), '', 'stdout must stay clean for the JSON contract');
  });

  it('sm serve --port abc -q: exit 2, error still on stderr', async () => {
    const cap = captureContext();
    const exit = await buildCli().run(['serve', '--port', 'abc', '-q'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /--port must be a non-negative integer/, cap.stderr());
  });

  it('sm enrich <node> --stale --json: exit 2, mutex error on stderr, stdout untouched', async () => {
    const cap = captureContext();
    const exit = await buildCli().run(['enrich', 'a.md', '--stale', '--json'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /--stale cannot be combined with a positional/, cap.stderr());
    assert.equal(cap.stdout(), '', 'stdout must stay clean for the JSON contract');
  });

  it('sm enrich (no target) -q: exit 2, error still on stderr', async () => {
    const cap = captureContext();
    const exit = await buildCli().run(['enrich', '-q'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /Pass <node\.path> for a single-node refresh/, cap.stderr());
  });
});
