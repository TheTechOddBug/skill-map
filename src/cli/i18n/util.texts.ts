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

  // confirm.ts (default-no prompt suffix, destructive verbs)
  confirmPromptSuffix: ' [y/N] ',
  // confirm.ts (default-yes prompt suffix, consent-style verbs where the
  // user already triggered the action and is just acknowledging it,
  // e.g. the .sm write consent gate).
  confirmPromptSuffixDefaultYes: ' [Y/n] ',
  /**
   * Regex source matching affirmative / negative answers in `confirm()`.
   * Compiled with the `i` flag in the helper. Pre-i18n today the
   * patterns are English-only; when a non-English locale lands each
   * catalog entry grows alternations (e.g. `^(y(es)?|s(í|i)?)$`).
   */
  confirmYesPatternSource: '^y(es)?$',
  confirmNoPatternSource: '^no?$',
} as const;
