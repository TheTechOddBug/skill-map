/**
 * First-run telemetry consent prompt (`spec/telemetry.md` §Consent
 * contract). Shown at most once, only on an interactive terminal, only
 * when a real DSN is configured. The operator's choice is persisted to
 * `~/.skill-map/settings.json`; once `promptedAt` is stamped the prompt
 * never appears again.
 *
 * While the CLI DSN is the empty placeholder, `shouldPromptForConsent`
 * returns false (`dsnConfigured` is false), so this whole surface is
 * dormant until the sentry.io project exists.
 *
 * The decision logic (`shouldPromptForConsent`, `interpretConsentAnswer`)
 * is pure and unit-tested; the interactive read is the only side effect
 * and runs solely when the gate opens.
 */

import { createInterface } from 'node:readline/promises';

import { TELEMETRY_PROMPT_TEXTS } from '../i18n/telemetry.texts.js';
import {
  hasTelemetryPromptBeenShown,
  writeUserSettings,
} from '../util/user-settings-store.js';
import { isCliDsnConfigured, isTelemetryForcedOff } from './sentry-init.js';

/** Parsed intent of a raw consent answer. */
export type TConsentAnswer = 'yes' | 'no' | 'details';

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
 * Pure gate: show the prompt only when a real DSN is configured, we are on
 * an interactive TTY, not in CI, the kill switch is unset, and the operator
 * has not been asked before.
 */
export function shouldPromptForConsent(opts: {
  dsnConfigured: boolean;
  isTTY: boolean;
  isCI: boolean;
  forcedOff: boolean;
  alreadyPrompted: boolean;
}): boolean {
  return (
    opts.dsnConfigured &&
    opts.isTTY &&
    !opts.isCI &&
    !opts.forcedOff &&
    !opts.alreadyPrompted
  );
}

/** Live evaluation of the consent gate against the current environment. */
function consentGateOpen(stdout: { isTTY?: boolean }): boolean {
  return shouldPromptForConsent({
    dsnConfigured: isCliDsnConfigured(),
    isTTY: stdout.isTTY === true,
    isCI: Boolean(process.env['CI']),
    forcedOff: isTelemetryForcedOff(),
    alreadyPrompted: hasTelemetryPromptBeenShown(),
  });
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
 * Run the one-time consent prompt if the gate opens, persisting the choice.
 * No-op (and never blocks) when the gate is closed. `nowMs` is injectable so
 * callers/tests control the `promptedAt` stamp.
 */
export async function maybeRunFirstRunPrompt(opts?: {
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream & { isTTY?: boolean };
  nowMs?: number;
}): Promise<void> {
  const stdout = opts?.stdout ?? process.stdout;
  if (!consentGateOpen(stdout)) return;
  await runConsentPrompt(opts?.stdin ?? process.stdin, stdout, opts?.nowMs ?? Date.now());
}
