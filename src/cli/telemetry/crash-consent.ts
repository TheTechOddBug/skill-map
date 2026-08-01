/**
 * Per-incident crash-report consent flow (`spec/telemetry.md`
 * §Per-incident crash-report consent).
 *
 * When a crash is caught (the `SmCommand` verb boundary, or the fatal
 * process handlers in `fatal-crash-handler.ts`), this module decides what
 * happens to the report:
 *
 *   - `prompt`: interactive context, ask the operator about THIS report.
 *     The default answer is a flat Yes (Enter sends, the announced bounded
 *     wait resolves Yes, an explicit no always wins); the answer is never
 *     persisted, the next crash asks again. The persisted
 *     `telemetry.errorsEnabled` toggle plays no role on this path.
 *   - `auto-send`: non-promptable context (no TTY, CI, `--json`, `-q`)
 *     with the persisted opt-in → send without asking (the pre-existing
 *     semantics).
 *   - `silent`: non-promptable without opt-in, the `SKILL_MAP_TELEMETRY=0`
 *     kill switch, a dormant DSN, or the `serve` verb (the BFF owns that
 *     process's Sentry client) → nothing is sent, nothing is asked.
 *
 * The prompt renders on **stderr** (stdout may be a JSON pipe), reuses the
 * first-run prompt's visual style, offers a `[d]etails` preview of the
 * SCRUBBED payload, and bounds the wait so an unattended terminal resolves
 * to the biased default. The whole flow is wrapped so a prompt or transport
 * failure can never alter the verb's exit code.
 */

import { createInterface } from 'node:readline/promises';

import { scrubEvent } from '../../core/telemetry/scrub.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { SENTRY_DSN_NODE } from '../../public-config.js';
import { VERSION } from '../../version.js';
import { CRASH_CONSENT_TEXTS } from '../i18n/crash-consent.texts.js';
import { ansiFor, type IAnsi } from '../util/ansi.js';
import {
  sendCrashReportOnce,
  telemetryInactiveReason,
  type TSentryNodeLoader,
  type TTelemetryInactiveReason,
} from './sentry-init.js';
import { resolveTelemetryEnv } from './telemetry-env.js';

/** What happens to a caught crash in the current context. */
export type TCrashFlow = 'prompt' | 'auto-send' | 'silent';

/** The environment signals the flow gate reads. */
export interface ICrashGateInputs {
  inactiveReason: TTelemetryInactiveReason | null;
  stdinIsTTY: boolean;
  stderrIsTTY: boolean;
  isCI: boolean;
  json: boolean;
  quiet: boolean;
  verb: string;
}

/**
 * Interactive enough to ask: both TTYs, not CI, and no machine-facing flag
 * (`--json` / `-q`), which must never block on a consent question.
 */
function isPromptable(inputs: ICrashGateInputs): boolean {
  return (
    inputs.stdinIsTTY && inputs.stderrIsTTY && !inputs.isCI && !inputs.json && !inputs.quiet
  );
}

/**
 * Pure gate. Hard dormancy first (kill switch, no DSN, the BFF-owned
 * `serve` process), then promptability, then the non-interactive fallback
 * split on the persisted opt-in.
 */
export function decideCrashFlow(inputs: ICrashGateInputs): TCrashFlow {
  if (inputs.inactiveReason === 'kill-switch' || inputs.inactiveReason === 'dsn-dormant') {
    return 'silent';
  }
  if (inputs.verb === 'serve') return 'silent';
  if (isPromptable(inputs)) return 'prompt';
  return inputs.inactiveReason === null ? 'auto-send' : 'silent';
}

/** Parsed intent of a raw per-incident answer. */
export type TCrashAnswer = 'yes' | 'no' | 'details';

/**
 * Interpret a raw answer against the biased default. `y` / `yes` and `n` /
 * `no` always win; `d` / `details` asks for the disclosure; the empty Enter
 * AND anything unrecognised resolve to the default. Stricter than the
 * first-run prompt's "anything else is yes": a crash consent must not
 * opt-in on gibberish when the bias is No. Case- and
 * whitespace-insensitive.
 */
export function interpretCrashAnswer(raw: string, dflt: 'yes' | 'no'): TCrashAnswer {
  const value = raw.trim().toLowerCase();
  if (value === 'y' || value === 'yes') return 'yes';
  if (value === 'n' || value === 'no') return 'no';
  if (value === 'd' || value === 'details') return 'details';
  return dflt;
}

/**
 * Build the preview object shown on `[d]etails`: a minimal event carrying
 * exactly what the report carries (error name / message / stack, the fixed
 * tags, release, environment), run through the SAME pure scrubber the SDK's
 * `beforeSend` applies. The SDK-added environment facts (os, arch, node
 * major) are named in the accompanying note instead of fabricated here, so
 * the preview stays honest about the delta.
 */
export function buildCrashPreview(err: unknown, verb: string): Record<string, unknown> {
  const e = err instanceof Error ? err : new Error(formatErrorMessage(err));
  return scrubEvent(
    {
      error: { name: e.name, message: e.message, stack: e.stack ?? '' },
      tags: { surface: 'cli', verb },
      release: `skill-map-cli@${VERSION}`,
      environment: resolveTelemetryEnv(),
    },
    [process.cwd()],
  );
}

/** Final outcome of `maybeOfferCrashReport`, for callers and tests. */
export type TCrashOutcome = 'sent' | 'send-failed' | 'declined' | 'skipped';

export interface ICrashReportOptions {
  stdin: NodeJS.ReadableStream;
  stderr: NodeJS.WritableStream & { isTTY?: boolean };
  json: boolean;
  quiet: boolean;
  noColor?: boolean;
  /** `''` when unknown; `db dump`-style multi-token verbs joined by space. */
  verb: string;
  /** `error` for the verb boundary, `fatal` for the process handlers. */
  level?: 'error' | 'fatal';
  /** Bounded prompt wait; resolves to the biased default. */
  timeoutMs?: number;
}

/**
 * Test seam: the SDK loader handed to `sendCrashReportOnce`, injectable
 * because the `SmCommand` boundary cannot thread a parameter through
 * `execute()`. `undefined` in production (the real dynamic import).
 */
let sdkLoaderOverride: TSentryNodeLoader | undefined;

export function setCrashConsentSdkLoaderForTests(loader: TSentryNodeLoader): void {
  sdkLoaderOverride = loader;
}

export function resetCrashConsentForTests(): void {
  sdkLoaderOverride = undefined;
}

/**
 * The one entry point: decide the flow for this crash and run it. Never
 * throws and never alters the caller's exit path; every failure inside
 * (prompt IO, SDK load, transport) degrades to a quieter outcome.
 */
export async function maybeOfferCrashReport(
  err: unknown,
  opts: ICrashReportOptions,
): Promise<TCrashOutcome> {
  try {
    const flow = decideCrashFlow({
      inactiveReason: telemetryInactiveReason(SENTRY_DSN_NODE),
      stdinIsTTY: (opts.stdin as NodeJS.ReadStream).isTTY === true,
      stderrIsTTY: opts.stderr.isTTY === true,
      isCI: Boolean(process.env['CI']),
      json: opts.json,
      quiet: opts.quiet,
      verb: opts.verb,
    });
    if (flow === 'silent') return 'skipped';
    if (flow === 'auto-send') {
      const ok = await sendCrashReportOnce(err, {
        verb: opts.verb,
        level: opts.level ?? 'error',
        loadSdk: sdkLoaderOverride,
      });
      return ok ? 'sent' : 'send-failed';
    }
    return await runCrashPrompt(err, opts);
  } catch {
    return 'skipped';
  }
}

/** The styled, ready-to-write strings for one prompt run. */
interface IRenderedCrashPrompt {
  question: string;
  reprompt: string;
  sent: string;
  sendFailed: string;
  declined: string;
}

/**
 * Compose the prompt in the skill-map verb-output style (yellow `⚠` header,
 * biased-default answer line, `✓` / `ℹ` outcome), wrapping glyphs /
 * emphasis through `IAnsi` so a `NO_COLOR` / non-TTY run keeps the same
 * bytes minus the escapes.
 */
function renderCrashPrompt(
  ansi: IAnsi,
  dflt: 'yes' | 'no',
  timeoutMs: number,
): IRenderedCrashPrompt {
  const t = CRASH_CONSENT_TEXTS;
  const yes = dflt === 'yes' ? ansi.bold(t.answerYesDefault) : t.answerYes;
  const no = dflt === 'no' ? ansi.bold(t.answerNoDefault) : t.answerNo;
  const hint = ansi.dim(
    tx(t.timeoutHint, { answer: dflt, seconds: String(Math.round(timeoutMs / 1000)) }),
  );
  const answerLine = `     ${t.question}  ${yes}  ${no}  ${ansi.dim(t.answerDetails)}  ${hint} `;
  return {
    question: [
      `  ${ansi.yellow('⚠')}  ${ansi.bold(t.title)}`,
      ...t.intro.map((line) => `     ${line}`),
      '',
      answerLine,
    ].join('\n'),
    reprompt: answerLine,
    sent: `  ${ansi.green('✓')}  ${t.sent}\n`,
    sendFailed: `  ${ansi.yellow('⚠')}  ${t.sendFailed}\n`,
    declined: `  ${ansi.cyan('ℹ')}  ${t.declined}\n`,
  };
}

/** Cap on raw stack lines rendered in the `[d]etails` preview. */
const PREVIEW_STACK_LINES = 12;

/**
 * Render the scrubbed preview block. Every line is `sanitizeForTerminal`'d
 * (an error message can carry hostile ANSI) and dimmed; the stack is capped
 * with an explicit "more lines" marker so silent truncation never reads as
 * the full payload.
 */
function renderPreviewBlock(err: unknown, verb: string, ansi: IAnsi): string {
  const t = CRASH_CONSENT_TEXTS;
  const preview = buildCrashPreview(err, verb) as {
    error: { name: string; message: string; stack: string };
    tags: { surface: string; verb: string };
    release: string;
    environment: string;
  };
  const stackLines = preview.error.stack === '' ? [] : preview.error.stack.split('\n');
  const shown = stackLines.slice(0, PREVIEW_STACK_LINES);
  const hidden = stackLines.length - shown.length;
  const lines: string[] = [
    '',
    `     ${t.previewTitle}`,
    `       ${ansi.dim(sanitizeForTerminal(`${preview.error.name}: ${preview.error.message}`))}`,
    ...shown.map((line) => `       ${ansi.dim(sanitizeForTerminal(line))}`),
  ];
  if (hidden > 0) {
    lines.push(`       ${ansi.dim(tx(t.previewMoreLines, { count: String(hidden) }).trimEnd())}`);
  }
  const verbTag = preview.tags.verb === '' ? '' : `  verb=${preview.tags.verb}`;
  lines.push(
    `       ${ansi.dim(
      sanitizeForTerminal(
        `tags: surface=${preview.tags.surface}${verbTag}  release: ${preview.release}  environment: ${preview.environment}`,
      ),
    )}`,
    `     ${ansi.dim(t.previewSdkNote)}`,
    '',
  );
  return lines.join('\n') + '\n';
}

/**
 * Send the consented report and acknowledge the outcome on stderr.
 */
async function sendAndAck(
  err: unknown,
  opts: ICrashReportOptions,
  rendered: IRenderedCrashPrompt,
): Promise<TCrashOutcome> {
  const ok = await sendCrashReportOnce(err, {
    verb: opts.verb,
    level: opts.level ?? 'error',
    loadSdk: sdkLoaderOverride,
  });
  opts.stderr.write(ok ? rendered.sent : rendered.sendFailed);
  return ok ? 'sent' : 'send-failed';
}

/**
 * `rl.question` that can never reject or throw: an already-closed
 * interface (stdin EOF consumed between the first ask and a re-ask)
 * throws `ERR_USE_AFTER_CLOSE` synchronously, which must resolve to the
 * default answer, not blow up the flow.
 */
function safeQuestion(
  rl: { question: (q: string) => Promise<string> },
  question: string,
): Promise<string | null> {
  try {
    return rl.question(question).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

/**
 * Ask once, racing the question against readline `close` (stdin EOF) and
 * the bounded timeout; every non-answer resolves to the biased default so
 * the process can never hang on an unattended terminal.
 */
async function askOnce(
  rl: { question: (q: string) => Promise<string> },
  question: string,
  races: readonly Promise<null>[],
  dflt: 'yes' | 'no',
): Promise<TCrashAnswer> {
  const raw = await Promise.race([safeQuestion(rl, question), ...races]);
  return raw === null ? dflt : interpretCrashAnswer(raw, dflt);
}

/**
 * Drive the readline dialog: ask, loop on `[d]etails`, send on yes.
 */
async function runCrashPrompt(
  err: unknown,
  opts: ICrashReportOptions,
): Promise<TCrashOutcome> {
  const ansi = ansiFor({
    isTTY: opts.stderr.isTTY === true,
    noColorFlag: opts.noColor ?? false,
  });
  // Flat Yes default (spec §Per-incident crash-report consent rule 2):
  // Enter sends, silence resolves Yes at the announced bound, an explicit
  // no always wins. The persisted toggle plays no role here; it only
  // governs the non-promptable fallback in `decideCrashFlow`.
  const dflt = 'yes' as const;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const rendered = renderCrashPrompt(ansi, dflt, timeoutMs);
  const rl = createInterface({ input: opts.stdin, output: opts.stderr });
  let timer: NodeJS.Timeout | undefined;
  try {
    const closed = new Promise<null>((resolve) => {
      // Deferred a macrotask so an answer arriving in the same IO burst as
      // EOF (piped input ending right after the line) wins the race; the
      // question's own resolution takes a couple of microtasks.
      rl.once('close', () => setImmediate(() => resolve(null)));
    });
    const timedOut = new Promise<null>((resolve) => {
      // Kept referenced on purpose: on the fatal path this timer is what
      // keeps the event loop alive while the operator reads the prompt.
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    let question = rendered.question;
    for (;;) {
      const answer = await askOnce(rl, question, [closed, timedOut], dflt);
      if (answer === 'details') {
        opts.stderr.write(renderPreviewBlock(err, opts.verb, ansi));
        question = rendered.reprompt;
        continue;
      }
      if (answer === 'no') {
        opts.stderr.write(rendered.declined);
        return 'declined';
      }
      return await sendAndAck(err, opts, rendered);
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    rl.close();
  }
}
