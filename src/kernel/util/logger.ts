/**
 * Module-level singleton `LoggerPort`. The kernel emits warnings /
 * info / debug through `log.*`; the active implementation defaults to
 * `SilentLogger` (no output) and is swapped by the driving adapter at
 * boot time via `configureLogger(...)`.
 *
 * Why a singleton (vs. per-call injection):
 *   - Logging crosses every layer; threading a `logger` argument
 *     through every kernel function costs a lot of plumbing for a
 *     side-channel concern.
 *   - The active impl is a pointer; the exported `log` is a stable
 *     proxy. Imports made before `configureLogger` runs still see the
 *     new impl on every call, no "captured stale logger" bugs.
 *
 * Tradeoffs accepted:
 *   - Tests must call `resetLogger()` (or replace the active impl) in
 *     teardown to avoid cross-test bleed.
 *   - Concurrent scans share the same logger; per-scan logging requires
 *     reintroducing an explicit `logger` argument on the call path.
 */

import { SilentLogger } from '../adapters/silent-logger.js';
import { logLevelRank } from '../ports/logger.js';
import type { LoggerPort, TLogMethodLevel } from '../ports/logger.js';

let active: LoggerPort = new SilentLogger();

/** Stable proxy. Methods always delegate to the current `active` impl. */
export const log: LoggerPort = {
  trace: (message, context) => active.trace(message, context),
  debug: (message, context) => active.debug(message, context),
  info: (message, context) => active.info(message, context),
  warn: (message, context) => active.warn(message, context),
  error: (message, context) => active.error(message, context),
};

/** Install a logger as the active implementation. Idempotent. */
export function configureLogger(impl: LoggerPort): void {
  active = impl;
}

/** Restore the default `SilentLogger`. Call from test teardown. */
export function resetLogger(): void {
  active = new SilentLogger();
}

/** Inspect the active logger. Test-only, production code uses `log`. */
export function getActiveLogger(): LoggerPort {
  return active;
}

/**
 * True when a message at `level` would actually be emitted.
 *
 * For HOT PATHS only: a per-node or per-link `log.trace(...)` evaluates
 * its template argument before the adapter gets to drop it, so on a
 * 5k-node corpus the silenced call still builds 5k strings per phase.
 * Guarding turns that into one integer comparison:
 *
 *     if (logEnabled('trace')) log.trace(`node ${path} -> ${kind}`);
 *
 * One-shot lines (a phase summary, an error path) do NOT need this;
 * the guard would cost more reading than it saves running.
 *
 * An adapter that does not implement the optional `level()` answers
 * `false`: it opts out of hot-path diagnostics rather than paying for
 * strings that may go nowhere. `SilentLogger` reports `'silent'`, which
 * lands on the same answer for the right reason.
 */
export function logEnabled(level: TLogMethodLevel): boolean {
  if (typeof active.level !== 'function') return false;
  return logLevelRank(level) >= logLevelRank(active.level());
}
