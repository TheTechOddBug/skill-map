/**
 * Telemetry consent prompt (`spec/telemetry.md` §Consent contract). Shown at
 * most once, only on an interactive terminal, only when a real DSN is
 * configured, and only from the SECOND eligible run onward. The choice is
 * persisted to `~/.skill-map/settings.json`; once `promptedAt` is stamped
 * the prompt never appears again.
 *
 * Second-run deferral: the first run on which the prompt would be eligible
 * stamps `telemetry.firstRunAt` and stays silent, so the operator's very
 * first `sm` invocation is not asked two things at once (a first `sm scan`
 * may already prompt for the provider lens). The NEXT eligible run asks.
 *
 * While the CLI DSN is the empty placeholder, `isPromptEligible` returns
 * false (`dsnConfigured` is false), so this whole surface is dormant.
 *
 * The decision logic (`isPromptEligible`, `shouldPromptForConsent`,
 * `interpretConsentAnswer`) is pure and unit-tested; the interactive read is
 * the only side effect and runs solely when the gate opens.
 */

import { createInterface } from 'node:readline/promises';

import { TELEMETRY_PROMPT_TEXTS } from '../i18n/telemetry.texts.js';
import {
  hasSeenFirstRun,
  hasTelemetryPromptBeenShown,
  writeUserSettings,
} from '../util/user-settings-store.js';
import { isCliDsnConfigured, isTelemetryForcedOff } from './sentry-init.js';

/** Parsed intent of a raw consent answer. */
export type TConsentAnswer = 'yes' | 'no' | 'details';

/** The environment signals the prompt gate reads. */
export interface IPromptGateInputs {
  dsnConfigured: boolean;
  isTTY: boolean;
  isCI: boolean;
  forcedOff: boolean;
  alreadyPrompted: boolean;
}

/**
 * Interpret a raw prompt answer. `y` / `yes` opt in; `d` / `details` ask
 * for the disclosure; anything else (including the empty default) opts
 * out. Case- and whitespace-insensitive.
 */
export function interpretConsentAnswer(raw: string): TConsentAnswer {
  const value = raw.trim().toLowerCase();
  if (value === 'y' || value === 'yes') return 'yes';
  if (value === 'd' || value === 'details') return 'details';
  return 'no';
}

/**
 * Pure gate: a run is eligible to either record the first-run marker or show
 * the prompt when a real DSN is configured, we are on an interactive TTY,
 * not in CI, the kill switch is unset, and the operator has not been asked
 * before.
 */
export function isPromptEligible(opts: IPromptGateInputs): boolean {
  return (
    opts.dsnConfigured &&
    opts.isTTY &&
    !opts.isCI &&
    !opts.forcedOff &&
    !opts.alreadyPrompted
  );
}

/**
 * Pure gate: actually show the prompt this run. True only when the run is
 * eligible AND an earlier eligible run has already been seen (`firstRunSeen`),
 * i.e. this is the second-or-later eligible run.
 */
export function shouldPromptForConsent(
  opts: IPromptGateInputs & { firstRunSeen: boolean },
): boolean {
  return isPromptEligible(opts) && opts.firstRunSeen;
}

/** Snapshot the live environment signals for the gate. */
function liveGateInputs(stdout: { isTTY?: boolean }): IPromptGateInputs {
  return {
    dsnConfigured: isCliDsnConfigured(),
    isTTY: stdout.isTTY === true,
    isCI: Boolean(process.env['CI']),
    forcedOff: isTelemetryForcedOff(),
    alreadyPrompted: hasTelemetryPromptBeenShown(),
  };
}

/**
 * Ask the consent question, looping while the operator requests details,
 * and resolve to the opt-in boolean. The only place the prompt blocks.
 */
async function readConsentDecision(
  rl: { question: (q: string) => Promise<string> },
  stdout: NodeJS.WritableStream,
): Promise<boolean> {
  let answer = interpretConsentAnswer(await rl.question(TELEMETRY_PROMPT_TEXTS.question));
  while (answer === 'details') {
    stdout.write(TELEMETRY_PROMPT_TEXTS.details);
    answer = interpretConsentAnswer(await rl.question(TELEMETRY_PROMPT_TEXTS.question));
  }
  return answer === 'yes';
}

/**
 * Drive the readline dialog and persist the choice. Best-effort: any IO
 * failure leaves consent at its default (OFF). Split out so the public
 * entry point stays a thin gate.
 */
async function runConsentPrompt(
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
  nowMs: number,
): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const errorsEnabled = await readConsentDecision(rl, stdout);
    writeUserSettings({ telemetry: { errorsEnabled, promptedAt: nowMs } });
    stdout.write(
      errorsEnabled ? TELEMETRY_PROMPT_TEXTS.enabled : TELEMETRY_PROMPT_TEXTS.disabled,
    );
  } catch {
    // Prompt IO is best-effort. Leave consent untouched (OFF) on failure.
  } finally {
    rl.close();
  }
}

/**
 * On an eligible run, either defer (the first one) or show the prompt (the
 * second onward), persisting the choice. No-op (and never blocks) when the
 * run is not eligible. `nowMs` is injectable so callers/tests control the
 * timestamps.
 */
export async function maybeRunFirstRunPrompt({
  stdin = process.stdin,
  stdout = process.stdout,
  nowMs = Date.now(),
}: {
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream & { isTTY?: boolean };
  nowMs?: number;
} = {}): Promise<void> {
  if (!isPromptEligible(liveGateInputs(stdout))) return;
  if (!hasSeenFirstRun()) {
    // First eligible run: record it and stay silent so the telemetry prompt
    // does not stack on top of the first-run provider-lens prompt. The next
    // eligible run is the one that asks.
    writeUserSettings({ telemetry: { firstRunAt: nowMs } });
    return;
  }
  await runConsentPrompt(stdin, stdout, nowMs);
}
