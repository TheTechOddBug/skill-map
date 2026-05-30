/**
 * Externalised strings for the first-run telemetry consent prompt
 * (`cli/telemetry/first-run-prompt.ts`). English-only, per the project
 * i18n convention. No em dashes (lint-enforced in `*.texts.ts`).
 *
 * Strings are color-free; the prompt renderer wraps glyphs / emphasis with
 * `IAnsi` at the call site so a `NO_COLOR` run reads the same bytes (per the
 * CLI output-style guide). This is the one interactive prompt that adopts
 * the verb-output style (glyphs + sections) instead of staying plain, see
 * `context/cli-output-style.md` §11.
 */

export const TELEMETRY_PROMPT_TEXTS = {
  // Header + body of the one-time question (glyph `ℹ` added by the renderer).
  title: 'Anonymous error reporting',
  intro: [
    'skill-map can send anonymous crash reports to help fix bugs you hit.',
    'No personal information is ever sent: not your files or their contents,',
    'not your folder or home paths, not your settings. Only the error itself.',
  ],
  question: 'Enable error reporting?',
  answerYes: '[Y]es',
  answerNo: '[n]o',
  answerDetails: '[d]etails',

  // Disclosure shown on `[d]etails`, then the question is re-asked.
  detailsSentTitle: 'Sent, only if you turn this on',
  detailsSent: [
    'the error name, code, and message',
    'the stack trace, with your home folder hidden as <HOME>',
    'cli version, node major, os, and the verb that crashed',
  ],
  detailsNeverTitle: 'Never sent',
  detailsNever: [
    'your files, their contents, frontmatter, annotations',
    'absolute paths, hostname, your username, ip address',
    'your settings values',
  ],
  detailsHint: 'Change it anytime in Settings, or turn it off with SKILL_MAP_TELEMETRY=0.',

  // Confirmation lines (glyph added by the renderer).
  enabled: 'Error reporting on. Thanks, you can turn it off anytime in Settings.',
  disabled: 'Error reporting off. You can turn it on later in Settings.',
} as const;
