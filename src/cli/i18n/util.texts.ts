/**
 * Strings emitted by cross-cutting CLI utilities under `cli/util/*`
 * (db-path, elapsed, confirm). Same convention as the per-verb catalogs:
 * flat string templates with `{{name}}` placeholders for `tx(...)`.
 */

export const UTIL_TEXTS = {
  // db-path.ts
  /** Hits every verb that reads from the DB before scan has run. */
  dbNotFound: '{{glyph}}  DB not found at {{path}}\n   {{hint}}\n',
  dbNotFoundHint: 'Run `sm scan` first.',

  // elapsed.ts
  // Leading \n separates the elapsed line from the verb's body output.
  // Every verb's body is expected to end on a content line (with or
  // without its own trailing \n); the blank line here is universal.
  doneIn: '\ndone in {{elapsed}}\n',

  // confirm.ts (default-no prompt suffix)
  confirmPromptSuffix: ' [y/N] ',
  /**
   * Regex source matching affirmative answers in `confirm()`. Compiled
   * with the `i` flag in the helper. Pre-i18n today the pattern is
   * English-only; when a non-English locale lands the catalog grows
   * alternations (e.g. `^(y(es)?|s(í|i)?)$`).
   */
  confirmYesPatternSource: '^y(es)?$',
} as const;
