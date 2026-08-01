/**
 * Process-fatal crash handling for the CLI (`spec/telemetry.md`
 * §Per-incident crash-report consent, covered class "process-fatal").
 *
 * The entry driver installs these handlers instead of Sentry's
 * `onUncaughtException` / `onUnhandledRejection` integrations: those
 * capture (and send) BEFORE any prompt could run, which is exactly the
 * consent violation the per-incident model exists to prevent. Owning the
 * handlers also keeps exit-code parity with Node: an uncaught error still
 * ends the process with exit `1` (both Node's default and Sentry's
 * `logAndExitProcess` exit `1`).
 *
 * Registering a handler suppresses Node's default crash print, so the
 * error is rendered to stderr FIRST, before the consent flow; the operator
 * sees the crash even in non-promptable contexts or if they never answer.
 * The handlers own their process tail (bounded Sentry close, stdio flush,
 * `process.exit(1)`); the entry's normal shutdown sequence never runs on
 * this path, same as before this module existed.
 */

import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { flushStdio } from '../util/flush-stdio.js';
import { maybeOfferCrashReport } from './crash-consent.js';
import { closeSentryCli } from './sentry-init.js';

/** The two prompt-suppressing flags the fatal path must respect. */
export interface IFatalPromptSignals {
  json: boolean;
  quiet: boolean;
}

/**
 * Derive `--json` / `-q` from raw argv (plus the `SKILL_MAP_JSON` env
 * equivalent, spec §Global flags): the fatal handler has no hydrated
 * Clipanion command to read the flags from. Pure, unit-testable.
 */
export function fatalPromptSignals(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): IFatalPromptSignals {
  const jsonEnv = env['SKILL_MAP_JSON'];
  return {
    json: argv.includes('--json') || (jsonEnv !== undefined && jsonEnv !== ''),
    quiet: argv.includes('-q') || argv.includes('--quiet'),
  };
}

/**
 * `true` while a fatal crash is being handled (from the moment the handler
 * fires until its own `process.exit(1)`). Module state, not closure state,
 * because the ENTRY TAIL must consult it: a verb whose `run()` promise
 * still resolves after the crash (the `intentional-fail` bounded fallback
 * timer is the canonical case; any verb with a detached timer can do it)
 * lets the normal shutdown sequence reach its `process.exit(exitCode)`
 * while the consent prompt is still waiting for the operator, killing the
 * process mid-question. Once this flag is up, the fatal handler owns the
 * process exit and the normal tail must never exit.
 */
let handlingFatalCrash = false;

/** Whether the fatal crash handler currently owns the process exit. */
export function isHandlingFatalCrash(): boolean {
  return handlingFatalCrash;
}

/**
 * Install the `uncaughtException` / `unhandledRejection` handlers for this
 * process. Re-entrant crashes (a second error while the first is being
 * handled, e.g. a timer that keeps firing) exit immediately instead of
 * recursing into a second prompt.
 */
export function installFatalCrashHandlers(opts: {
  argv: readonly string[];
  verb: string;
}): void {
  const onFatal = (err: unknown): void => {
    if (handlingFatalCrash) {
      process.exit(1);
    }
    handlingFatalCrash = true;
    void handleFatalCrash(err, opts).finally(() => {
      process.exit(1);
    });
  };
  process.on('uncaughtException', onFatal);
  process.on('unhandledRejection', onFatal);
}

/**
 * Render, offer, flush. Every step is best-effort: a crash inside the
 * crash handler must never block the exit (the `.finally` in the caller
 * exits regardless).
 */
async function handleFatalCrash(
  err: unknown,
  opts: { argv: readonly string[]; verb: string },
): Promise<void> {
  try {
    const stack =
      err instanceof Error && err.stack !== undefined
        ? err.stack
        : formatErrorMessage(err);
    process.stderr.write(`${sanitizeForTerminal(stack)}\n`);
    const { json, quiet } = fatalPromptSignals(opts.argv);
    await maybeOfferCrashReport(err, {
      stdin: process.stdin,
      stderr: process.stderr,
      json,
      quiet,
      verb: opts.verb,
      level: 'fatal',
    });
    await closeSentryCli(2000);
    await flushStdio();
  } catch {
    // Never let the handler itself become a crash loop.
  }
}
