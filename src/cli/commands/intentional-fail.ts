/**
 * Hidden self-test command for the Sentry error surface
 * (`sm intentional-fail`).
 *
 * NOT part of the CLI contract and intentionally invisible: it declares no
 * `static usage`, which alone keeps it out of `sm help`, `sm -h`, the
 * generated `cli-reference.md`, and the "did you mean" suggestions (every help
 * surface is driven from Clipanion command definitions, which omit a command
 * with no usage). It exists only so a maintainer can verify end to end that
 * opt-in error reporting reaches Sentry.
 *
 * It triggers a GENUINE uncaught exception rather than throwing inside
 * `run()`: Clipanion swallows a per-verb throw into a non-zero exit code, so
 * it would never reach Sentry's `onUncaughtException` integration (see
 * `telemetry/sentry-init.ts`). Deferring the throw to the next macrotask makes
 * it a real `uncaughtException` that the integration captures, scrubs,
 * flushes, and reports. When telemetry is inactive (dormant DSN, no consent,
 * or the kill switch) it simply crashes locally and sends nothing.
 */

import { SmCommand } from '../util/sm-command.js';
import { INTENTIONAL_FAIL_TEXTS } from '../i18n/intentional-fail.texts.js';

export class IntentionalFailCommand extends SmCommand {
  static override paths = [['intentional-fail']];

  // No `static usage` on purpose: that is what keeps the verb out of every
  // help / reference surface Clipanion drives from command definitions.

  // A self-test crash has no meaningful "done in <...>" line.
  protected override emitElapsed = false;

  protected async run(): Promise<number> {
    this.printer!.warn(INTENTIONAL_FAIL_TEXTS.triggering);
    // Defer the throw so it escapes Clipanion's per-verb catch and surfaces as
    // a real `uncaughtException`. Sentry's integration then captures + flushes
    // + terminates the process.
    setTimeout(() => {
      throw new Error(INTENTIONAL_FAIL_TEXTS.errorMessage);
    }, 0);
    // Keep the process alive until the deferred throw fires (immediate). The
    // uncaught handler ends the process well before this bounded wait elapses;
    // the wait is bounded (not a never-resolving promise) so the CLI can never
    // hang if the throw were ever swallowed.
    await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
    // Unreachable in practice; non-zero so a swallowed throw still "fails".
    return 1;
  }
}
