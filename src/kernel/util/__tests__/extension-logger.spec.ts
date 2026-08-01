/**
 * `ctx.log` boundary guard.
 *
 * Two of the three properties this wrapper exists for (see
 * `kernel/util/extension-logger.ts`) are enforced HERE: terminal safety
 * and attribution. The third (channel) is structural, the wrapper only
 * ever calls the kernel logger, which is stderr-bound by construction.
 * Level filtering belongs to the `LoggerPort` implementation and is
 * covered by the logger's own spec, so the capture port below records
 * every level unconditionally.
 *
 * "A plugin could already do worse with `console.log`" is an argument
 * for this wrapper being SAFER than the alternative, not for leaving it
 * unchecked, hence the hostile-input cases.
 */

import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import type { LoggerPort, TLogMethodLevel } from '../../ports/logger.js';
import { configureLogger, resetLogger } from '../logger.js';
import { makeExtensionLogger } from '../extension-logger.js';

const ESC = '\u001b';

interface ICaptured {
  level: TLogMethodLevel;
  message: string;
}

/**
 * Install a `LoggerPort` that records instead of writing. Records every
 * level: this spec asserts what crosses the boundary, not what the CLI
 * adapter chooses to print.
 */
function captureLogger(): ICaptured[] {
  const seen: ICaptured[] = [];
  const push = (level: TLogMethodLevel) => (message: string): void => {
    seen.push({ level, message });
  };
  const port: LoggerPort = {
    trace: push('trace'),
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
  };
  configureLogger(port);
  return seen;
}

afterEach(() => {
  resetLogger();
});

describe('makeExtensionLogger', () => {
  it('prefixes every line with the qualified extension id', () => {
    const seen = captureLogger();
    makeExtensionLogger('acme/my-analyzer').warn('something happened');
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.level, 'warn');
    assert.equal(seen[0]!.message, '[acme/my-analyzer] something happened');
  });

  it('routes each method to its own level', () => {
    const seen = captureLogger();
    const log = makeExtensionLogger('acme/x');
    log.trace('t');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    assert.deepEqual(
      seen.map((s) => s.level),
      ['trace', 'debug', 'info', 'warn', 'error'],
    );
  });

  it('strips ANSI escapes and control bytes from the message', () => {
    const seen = captureLogger();
    // A hostile extension repainting the operator's terminal and forging
    // a line break. `Logger` writes its message verbatim, so the
    // stripping MUST happen at this boundary.
    makeExtensionLogger('acme/x').error(`${ESC}[31mRED${ESC}[0m\rboom`);
    assert.equal(seen.length, 1);
    assert.ok(!seen[0]!.message.includes(ESC), 'no escape byte survives');
    assert.ok(!seen[0]!.message.includes('\r'), 'no bare CR survives');
    assert.equal(seen[0]!.message, '[acme/x] REDboom');
  });

  it('prefixes EVERY line so a plugin cannot forge an unattributed one', () => {
    const seen = captureLogger();
    // Newlines are legitimate content and survive sanitisation, so
    // without a per-line prefix this second line would read as kernel
    // output.
    makeExtensionLogger('acme/x').warn('real line\n  scan completed, 0 issues');
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0]!.message.split('\n'), [
      '[acme/x] real line',
      '[acme/x]   scan completed, 0 issues',
    ]);
  });

  it('sanitises the qualified id too (a disk plugin authors its own)', () => {
    const seen = captureLogger();
    makeExtensionLogger(`acme/${ESC}[31mevil`).info('hi');
    assert.ok(!seen[0]!.message.includes(ESC));
    // The whole SGR sequence goes, not just the escape byte, so the
    // leftover cannot be re-assembled downstream.
    assert.equal(seen[0]!.message, '[acme/evil] hi');
  });

  it('survives a non-string message from an untyped JS plugin', () => {
    const seen = captureLogger();
    const log = makeExtensionLogger('acme/x') as unknown as {
      info(message: unknown): void;
    };
    log.info({ nested: true });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.message, '[acme/x] [object Object]');
  });
});
