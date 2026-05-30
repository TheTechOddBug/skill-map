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
  title: 'Anonymous error and usage reporting',
  intro: [
    'skill-map can send anonymous reports to help fix bugs and decide what to',
    'build next. No personal information is ever sent: not your files or their',
    'contents, not your folder or home paths, not your settings.',
  ],
  question: 'Enable anonymous error and usage reporting?',
  answerYes: '[Y]es',
  answerNo: '[n]o',
  answerDetails: '[d]etails',

  // Disclosure shown on `[d]etails`, then the question is re-asked.
  detailsSentTitle: 'Sent, only if you turn this on',
  detailsSent: [
    'crashes: error name, code, message, and a path-stripped stack trace',
    'usage: the command you ran and its flag names (never their values)',
    'usage: which built-in extractors ran, and which UI views you opened',
    'cli version, node major, os, arch, and a random anonymous id',
  ],
  detailsNeverTitle: 'Never sent',
  detailsNever: [
    'your files, their contents, frontmatter, annotations',
    'absolute paths, hostname, your username, ip address',
    'your settings values or any flag values',
  ],
  detailsHint: 'Turn error reports, CLI usage, and UI usage on or off independently in Settings, or force everything off with SKILL_MAP_TELEMETRY=0.',

  // Confirmation lines (glyph added by the renderer).
  enabled: 'Telemetry on. Thanks. Turn error reports, CLI usage, and UI usage off independently in Settings.',
  disabled: 'Telemetry off. You can turn any of it on later in Settings.',
} as const;
