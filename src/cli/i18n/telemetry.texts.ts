/**
 * Externalised strings for the first-run telemetry consent prompt
 * (`cli/telemetry/first-run-prompt.ts`). English-only, per the project
 * i18n convention. No em dashes (lint-enforced in `*.texts.ts`).
 */

export const TELEMETRY_PROMPT_TEXTS = {
  // The one-time consent question shown on an interactive terminal.
  question: [
    'skill-map can report crashes anonymously to help fix bugs you hit.',
    'This is OFF by default and only sends scrubbed error reports, never',
    'your file contents, paths, or settings. Enable error reporting?',
    '  [y]es  [N]o  [d]etails: ',
  ].join('\n'),

  // Shown when the operator asks for [d]etails, then the question repeats.
  details: [
    'What WOULD be sent (only after you opt in):',
    '  - Stack traces with home paths scrubbed to <HOME>.',
    '  - CLI version, Node major, OS, and the verb that crashed.',
    '  - Error name, code, and a scrubbed message.',
    'What is NEVER sent:',
    '  - File contents, file names, frontmatter, annotations.',
    '  - Absolute paths, hostname, OS username, IP address.',
    '  - Your settings values.',
    'You can change this anytime in Settings (Privacy), or force it OFF',
    'with SKILL_MAP_TELEMETRY=0.',
    '',
  ].join('\n'),

  enabled: 'Error reporting enabled. Thank you. Disable anytime in Settings (Privacy).\n',
  disabled: 'Error reporting stays off. You can enable it later in Settings (Privacy).\n',
} as const;
