/**
 * Hidden self-test command for the Sentry error surface
 * (`sm intentional-fail`).
 *
 * NOT part of the CLI contract and intentionally invisible: it declares no
 * `static usage`, which alone keeps it out of `sm help`, `sm -h`, the
 * generated `cli-reference.md`, and the "did you mean" suggestions (every help
 * surface is driven from Clipanion command definitions, which omit a command
 * with no usage). It exists only so a maintainer can verify end to end that
 * the per-incident crash-report flow reaches Sentry.
 *
 * It triggers a GENUINE uncaught exception rather than throwing inside
 * `run()`: `SmCommand.execute()`'s global boundary turns a per-verb throw
 * into a rendered error + exit 2, so the throw is deferred to the next
 * macrotask to surface as a real `uncaughtException` and exercise the fatal
 * handlers (`telemetry/fatal-crash-handler.ts`): stack render, consent
 * prompt (or the non-promptable fallback), send, exit 1.
 *
 * The crash is only triggered when the surface could actually send: with
 * the kill switch set or a dormant DSN the run is refused with an
 * explanation and exit `Error`, because crashing then would look identical
 * to a successful self-test while proving nothing. Missing consent is NOT a
 * refusal reason anymore: under per-incident consent the prompt itself is
 * the consent, so the self-test runs and the maintainer answers it.
 */

import { SmCommand } from '../util/sm-command.js';
import { ExitCode } from '../util/exit-codes.js';
import { ansiFor } from '../util/ansi.js';
import { INTENTIONAL_FAIL_TEXTS } from '../i18n/intentional-fail.texts.js';
import { telemetryInactiveReason } from '../telemetry/sentry-init.js';
import { SENTRY_DSN_NODE } from '../../public-config.js';

export class IntentionalFailCommand extends SmCommand {
  static override paths = [['intentional-fail']];
  // Never publishes (no `static usage`, see below) and never succeeds: the
  // deferred throw kills the process through the fatal crash handlers
  // (exit 1, which is also `Issues`); a hard-gated run is refused with
  // `Error`, which is also the SmCommand boundary code.
  static override exitCodes = [ExitCode.Issues, ExitCode.Error];

  // No `static usage` on purpose: that is what keeps the verb out of every
  // help / reference surface Clipanion drives from command definitions.

  // A self-test crash has no meaningful "done in <...>" line.
  protected override emitElapsed = false;

  protected async run(): Promise<number> {
    const stderr = this.context.stderr as NodeJS.WriteStream;
    const ansi = ansiFor({ isTTY: stderr.isTTY === true, noColorFlag: this.noColor });

    // Hard gates only (`kill-switch` / `dsn-dormant`): with either closed,
    // nothing could ever be sent, so crashing would prove nothing. The
    // consent gate is deliberately NOT checked, the crash-report prompt is
    // the consent.
    const reason = telemetryInactiveReason(SENTRY_DSN_NODE);
    if (reason === 'kill-switch' || reason === 'dsn-dormant') {
      const text =
        reason === 'kill-switch'
          ? INTENTIONAL_FAIL_TEXTS.refusedKillSwitch
          : INTENTIONAL_FAIL_TEXTS.refusedDsnDormant;
      this.printer!.warn(`  ${ansi.yellow('⚠')}  ${text}`);
      return ExitCode.Error;
    }

    this.printer!.warn(`  ${ansi.yellow('⚠')}  ${INTENTIONAL_FAIL_TEXTS.triggering}`);
    // Defer the throw so it escapes Clipanion's per-verb catch and surfaces
    // as a real `uncaughtException` handled by the fatal crash handlers.
    setTimeout(() => {
      throw new Error(INTENTIONAL_FAIL_TEXTS.errorMessage);
    }, 0);
    // Keep the process alive until the deferred throw fires (immediate). The
    // fatal handler ends the process well before this bounded wait elapses;
    // the wait is bounded (not a never-resolving promise) so the CLI can
    // never hang if the throw were ever swallowed.
    await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
    // Unreachable in practice; non-zero so a swallowed throw still "fails".
    return ExitCode.Issues;
  }
}
