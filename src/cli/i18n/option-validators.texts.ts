/**
 * Strings emitted by the shared CLI option validators
 * (`cli/util/option-validators.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const OPTION_VALIDATORS_TEXTS = {
  /**
   * §3.1b two-line block. Generic "expected a positive integer"
   * rejection. `{{label}}` is the flag identifier the verb uses (e.g.
   * `--limit`, `--top`). The hint names the accepted shape so the
   * operator does not have to re-read `--help` for every numeric
   * argument the CLI takes.
   */
  notPositiveInt:
    '{{glyph}}  {{label}}: expected a positive integer, got "{{value}}".\n' +
    '   {{hint}}\n',
  notPositiveIntHint: 'Pass an integer >= 1 (e.g. {{label}} 10).',
} as const;
