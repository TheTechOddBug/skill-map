/**
 * Externalised strings for the per-incident crash-report consent prompt
 * (`cli/telemetry/crash-consent.ts`, spec/telemetry.md §Per-incident
 * crash-report consent). English-only, per the i18n convention. No em
 * dashes (lint-enforced in `*.texts.ts`).
 *
 * Strings are color-free; the prompt renderer wraps glyphs / emphasis with
 * `IAnsi` at the call site so a `NO_COLOR` run reads the same bytes (per
 * `context/cli-output-style.md`). Answer labels ship in both default and
 * non-default casing because the biased default flips which token carries
 * the capital (`[Y]es [n]o` vs `[y]es [N]o`).
 */

export const CRASH_CONSENT_TEXTS = {
  // Header + body of the per-incident question (glyph `⚠` added by the
  // renderer).
  title: 'Send an anonymous crash report to the skill-map maintainers?',
  intro: [
    'It carries the error name, message, and a path-stripped stack trace,',
    'plus cli version, node major, os, and arch. Never your files, paths,',
    'settings, flag values, or any identifier. Your answer applies to this',
    'report only; nothing is remembered.',
  ],
  question: 'Send this report?',
  answerYes: '[y]es',
  answerYesDefault: '[Y]es',
  answerNo: '[n]o',
  answerNoDefault: '[N]o',
  answerDetails: '[d]etails',
  // Dim suffix on the answer line; {{answer}} is `yes` / `no`, {{seconds}}
  // the bounded wait.
  timeoutHint: '(auto-answers {{answer}} in {{seconds}}s)',

  // Disclosure shown on `[d]etails`, then the question is re-asked.
  previewTitle: 'This is the payload, after scrubbing:',
  previewMoreLines: '... {{count}} more stack lines\n',
  previewSdkNote:
    'The SDK attaches os, arch, and the node major version. Nothing else.',

  // Outcome lines (glyph added by the renderer).
  sent: 'Crash report sent. Thank you.',
  sendFailed: 'Could not send the crash report. Nothing left the machine.',
  declined: 'Not sent.',
} as const;
