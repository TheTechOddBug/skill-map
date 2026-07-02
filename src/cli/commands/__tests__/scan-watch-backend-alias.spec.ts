/**
 * Flag-validation test for the `sm scan --watch` alias path: `--watch-backend`
 * must be wired on `ScanCommand.runWatchAlias` too, not only on `sm watch`
 * (`watch-flags.spec.ts`). An invalid value is rejected by `parseWatchBackend`
 * BEFORE `runWatchLoop`, so this exercises the alias seam without ever
 * starting a real watcher.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Builtins, Cli } from 'clipanion';
import type { BaseContext } from 'clipanion';

import { ScanCommand } from '../scan.js';
import { ExitCode } from '../../util/exit-codes.js';

function captureContext(): { context: BaseContext; stderr: () => string } {
  const stderrChunks: string[] = [];
  const context = {
    stdin: process.stdin,
    stdout: { write: (): boolean => true },
    stderr: {
      write: (s: string): boolean => {
        stderrChunks.push(s);
        return true;
      },
    },
  } as unknown as BaseContext;
  return { context, stderr: () => stderrChunks.join('') };
}

function buildCli(): Cli {
  const cli = new Cli({ binaryName: 'sm', binaryLabel: 'skill-map', binaryVersion: '0.0.0' });
  cli.register(Builtins.HelpCommand);
  cli.register(ScanCommand);
  return cli;
}

describe('sm scan --watch, --watch-backend validation (alias path)', () => {
  it('rejects an invalid --watch-backend with exit 2, before any watcher starts', async () => {
    const cap = captureContext();
    const exit = await buildCli().run(['scan', '--watch', '--watch-backend', 'nope'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(
      cap.stderr(),
      /--watch-backend must be "chokidar" or "parcel" \(got nope\)/,
      cap.stderr(),
    );
  });
});
