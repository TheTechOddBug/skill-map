/**
 * No-op `LoggerPort`. Default when the kernel is invoked without a
 * logger (tests, embedded usage). Equivalent in spirit to
 * `InMemoryProgressEmitter`: callers that don't care get a working
 * implementation that does nothing.
 *
 * Every method is intentionally empty, that IS the contract of this
 * class. We disable `no-empty-function` for the whole file because
 * adding `// eslint-disable-next-line` to each method would be noise.
 */

/* eslint-disable @typescript-eslint/no-empty-function */

import type { LoggerPort, TLogLevel } from '../ports/logger.js';
import type { IExtensionLogger } from '../util/extension-logger.js';

export class SilentLogger implements LoggerPort {
  trace(): void {}
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  /** Nothing is ever emitted, so `logEnabled()` short-circuits every
   *  hot-path diagnostic instead of building strings for a sink that
   *  discards them. */
  level(): TLogLevel {
    return 'silent';
  }
}

/**
 * The `ctx.log` counterpart: an extension logger that discards
 * everything. For callers that compose an extension context with no
 * operator watching (unit tests, in-memory harnesses), so the required
 * `log` field never has to be faked inline. Lives here rather than
 * beside `makeExtensionLogger` to reuse this file's documented
 * `no-empty-function` exemption instead of opening a second one.
 */
export const SILENT_EXTENSION_LOGGER: IExtensionLogger = {
  trace(): void {},
  debug(): void {},
  info(): void {},
  warn(): void {},
  error(): void {},
  enabled(): boolean {
    return false;
  },
};
