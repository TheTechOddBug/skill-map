/**
 * `ctx.log`, the diagnostic channel handed to every extension.
 *
 * Why this exists as a wrapper instead of exposing the kernel `log`
 * singleton directly: a plugin already runs arbitrary in-process code
 * once it clears the import gate (trust + enable), so handing it a
 * logger grants NO new capability. What the wrapper buys is the three
 * properties a raw `console.log` inside a plugin does not have:
 *
 *   1. **Channel discipline.** The kernel logger writes to stderr. A
 *      plugin reaching for `console.log` lands on STDOUT and corrupts
 *      every `--json` payload (`spec/cli-contract.md` §Machine-readable
 *      output rules). Routing through here makes the safe channel the
 *      easy one.
 *   2. **Terminal safety.** `Logger` writes its message verbatim, so an
 *      extension-authored string carries ANSI escapes and C0 controls
 *      straight to the operator's terminal. Every message crossing this
 *      boundary goes through `sanitizeForTerminal` first, the same
 *      defence already applied to extension-sourced ids and failure
 *      reasons elsewhere in the kernel.
 *   3. **Attribution.** Each line is prefixed with the qualified
 *      extension id, so operator output names its author and a plugin
 *      cannot forge a line that reads as kernel output.
 *
 * Level semantics are the port's (`kernel/ports/logger.ts`): the CLI
 * boots at `warn`, so extension `info` / `debug` / `trace` stay silent
 * until the operator asks for them with `--log` / `--log-level`. A chatty extension costs nothing in normal runs.
 *
 * Deliberately NARROWER than `LoggerPort`: no `context` bag (its values
 * would need the same sanitisation and buy an extension nothing a
 * formatted message does not), no `setLevel` (the operator owns the
 * level, not the plugin), no `level()` read.
 *
 * Secrets are the author's responsibility, not the kernel's: an
 * extension holding a token can log it, exactly as it could before this
 * channel existed. `spec/plugin-author-guide.md` carries the warning.
 */

import { log, logEnabled } from './logger.js';
import type { TLogMethodLevel } from '../ports/logger.js';
import { sanitizeForTerminal } from './safe-text.js';

/**
 * The logging surface an extension sees on `ctx.log`. One method per
 * level, message-only.
 */
export interface IExtensionLogger {
  trace(message: string): void;
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /**
   * True when a message at `level` would actually be emitted. For HOT
   * LOOPS only (per node, per link): the argument to `log.trace(...)` is
   * evaluated before anything can drop it, so an unguarded template
   * inside a loop over the graph is built on every scan even at the
   * default level. Guard those:
   *
   *     if (ctx.log.enabled('trace')) ctx.log.trace(`…${x}…`);
   *
   * A one-shot line never needs this.
   */
  enabled(level: 'trace' | 'debug' | 'info' | 'warn' | 'error'): boolean;
}

/**
 * Build the `ctx.log` an extension receives.
 *
 * `qualifiedId` is the `<plugin>/<extension>` id (see
 * `qualifiedExtensionId`); it is sanitised too, since a disk plugin
 * authors its own manifest ids.
 */
export function makeExtensionLogger(qualifiedId: string): IExtensionLogger {
  const prefix = `[${sanitizeForTerminal(qualifiedId)}]`;
  const emit = (
    level: TLogMethodLevel,
    message: string,
  ): void => {
    // `message` is extension-authored: coerce before sanitising so a
    // non-string slipping past an untyped JS plugin cannot throw inside
    // the kernel's own call stack.
    //
    // EVERY line gets the prefix, not just the first. `sanitizeForTerminal`
    // keeps newlines (they are legitimate content, unlike escapes and
    // other C0 bytes), so a single call carrying an embedded `\n` would
    // otherwise print a second, unattributed line, which is exactly the
    // forged-kernel-output shape the prefix exists to prevent.
    const body = sanitizeForTerminal(String(message));
    log[level](
      body
        .split('\n')
        .map((line) => `${prefix} ${line}`)
        .join('\n'),
    );
  };
  return {
    trace: (message: string): void => emit('trace', message),
    debug: (message: string): void => emit('debug', message),
    info: (message: string): void => emit('info', message),
    warn: (message: string): void => emit('warn', message),
    error: (message: string): void => emit('error', message),
    enabled: (level): boolean => logEnabled(level),
  };
}
