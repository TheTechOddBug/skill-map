/**
 * Shared telemetry consent prompt (`spec/telemetry.md` §Consent contract).
 * Shown at most once, only on an interactive terminal, only when at least
 * one carrier is configured (the Sentry DSN OR the PostHog key), and only
 * from the SECOND eligible run onward. A single answer consents to (or
 * declines) every surface at once: a `yes` enables error reporting plus both
 * usage toggles and mints the anonymous usage id; a `no` leaves all of them
 * OFF. Each toggle stays independently changeable from Settings afterward.
 * The choice is persisted to `~/.skill-map/settings.json`; once `promptedAt`
 * is stamped the prompt never appears again.
 *
 * Second-run deferral: the first run on which the prompt would be eligible
 * stamps `telemetry.firstRunAt` and stays silent, so the operator's very
 * first `sm` invocation is not asked two things at once (a first `sm scan`
 * may already prompt for the provider lens). The NEXT eligible run asks.
 *
 * While both carrier placeholders are empty, `isPromptEligible` returns
 * false (`dsnConfigured` is false), so this whole surface is dormant.
 *
 * The decision logic (`isPromptEligible`, `shouldPromptForConsent`,
 * `interpretConsentAnswer`) is pure and unit-tested; the interactive read is
 * the only side effect and runs solely when the gate opens.
 */

import { createInterface } from 'node:readline/promises';

import { TELEMETRY_PROMPT_TEXTS } from '../i18n/telemetry.texts.js';
import { ansiFor, type IAnsi } from '../util/ansi.js';
import {
  ensureAnonymousId,
  hasSeenFirstRun,
  hasTelemetryPromptBeenShown,
  writeUserSettings,
} from '../util/user-settings-store.js';
import { isCliDsnConfigured, isTelemetryForcedOff } from './sentry-init.js';
import { isUsageKeyConfigured } from './posthog-init.js';

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
 * Interpret a raw prompt answer, `[Y]es` default convention. `n` / `no` opt
 * out; `d` / `details` ask for the disclosure; everything else (the empty
 * Enter default, `y` / `yes`, or any other text) opts in. Case- and
 * whitespace-insensitive.
 */
export function interpretConsentAnswer(raw: string): TConsentAnswer {
  const value = raw.trim().toLowerCase();
  if (value === 'n' || value === 'no') return 'no';
  if (value === 'd' || value === 'details') return 'details';
  return 'yes';
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

/**
 * Snapshot the live environment signals for the gate. The shared prompt
 * covers both surfaces, so `dsnConfigured` means "at least one carrier is
 * configured" (the Sentry DSN OR the PostHog key): asking is worthwhile as
 * soon as either sink exists.
 */
function liveGateInputs(stdout: { isTTY?: boolean }): IPromptGateInputs {
  return {
    dsnConfigured: isCliDsnConfigured() || isUsageKeyConfigured(),
    isTTY: stdout.isTTY === true,
    isCI: Boolean(process.env['CI']),
    forcedOff: isTelemetryForcedOff(),
    alreadyPrompted: hasTelemetryPromptBeenShown(),
  };
}

/** The styled, ready-to-write strings for one prompt run. */
interface IRenderedPrompt {
  question: string;
  reprompt: string;
  details: string;
  enabled: string;
  disabled: string;
}

/**
 * Compose the prompt in the skill-map verb-output style (cyan `ℹ` header,
 * sectioned details, `✓` / `ℹ` confirmation), wrapping glyphs / emphasis
 * through `IAnsi` so a `NO_COLOR` / non-TTY run keeps the same bytes minus
 * the escapes. See `context/cli-output-style.md`.
 */
function renderConsent(ansi: IAnsi): IRenderedPrompt {
  const t = TELEMETRY_PROMPT_TEXTS;
  const answerLine = `     ${t.question}  ${ansi.bold(t.answerYes)}  ${t.answerNo}  ${ansi.dim(t.answerDetails)} `;
  return {
    question: [
      `  ${ansi.cyan('ℹ')}  ${ansi.bold(t.title)}`,
      ...t.intro.map((line) => `     ${line}`),
      '',
      answerLine,
    ].join('\n'),
    reprompt: answerLine,
    details: [
      '',
      `     ${t.detailsSentTitle}`,
      ...t.detailsSent.map((line) => `       ${ansi.dim('→')}  ${line}`),
      `     ${t.detailsNeverTitle}`,
      ...t.detailsNever.map((line) => `       ${ansi.red('✕')}  ${line}`),
      '',
      `     ${ansi.dim(t.detailsHint)}`,
      '',
    ].join('\n'),
    enabled: `  ${ansi.green('✓')}  ${t.enabled}\n`,
    disabled: `  ${ansi.cyan('ℹ')}  ${t.disabled}\n`,
  };
}

/**
 * Ask the consent question, looping while the operator requests details,
 * and resolve to the opt-in boolean. The only place the prompt blocks. The
 * re-ask after details uses the short answer line (no repeated header).
 */
async function readConsentDecision(
  rl: { question: (q: string) => Promise<string> },
  stdout: NodeJS.WritableStream,
  rendered: IRenderedPrompt,
): Promise<boolean> {
  let answer = interpretConsentAnswer(await rl.question(rendered.question));
  while (answer === 'details') {
    stdout.write(rendered.details);
    answer = interpretConsentAnswer(await rl.question(rendered.reprompt));
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
  stdout: NodeJS.WritableStream & { isTTY?: boolean },
  nowMs: number,
): Promise<void> {
  const rendered = renderConsent(
    ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: false }),
  );
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    // One answer consents to (or declines) every surface. Each toggle stays
    // independently changeable from Settings afterward; the anonymous usage
    // id is minted only on opt-in (there is no distinct_id to create on a no).
    const consented = await readConsentDecision(rl, stdout, rendered);
    writeUserSettings({
      telemetry: {
        errorsEnabled: consented,
        usageCliEnabled: consented,
        usageUiEnabled: consented,
        promptedAt: nowMs,
      },
    });
    if (consented) ensureAnonymousId();
    stdout.write(consented ? rendered.enabled : rendered.disabled);
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
