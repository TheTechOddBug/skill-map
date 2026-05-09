/**
 * CLI strings emitted by `sm tutorial` — `cli/commands/tutorial.ts`.
 *
 * Paired with the `sm-tutorial` Claude Code skill. The success line
 * nudges the tester to open Claude Code in the cwd and trigger the
 * skill by referencing the materialized file with `@sm-tutorial.md`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const TUTORIAL_TEXTS = {
  // Success — written to stdout after `<cwd>/sm-tutorial.md` is created.
  // Multi-line layout: the two trigger phrases (English / Spanish) are
  // indented and labelled so they're the most visible part of the
  // output. The reminder above them surfaces the SKILL's language
  // policy: the first message the tester writes to Claude sets the
  // tutorial language for the rest of the session.
  /**
   * Success body. `glyph` is wrapped green at the call site; `cwd`
   * renders relative to the user's cwd when it sits underneath. The
   * `English` / `Español` labels print dim — the eye lands on the
   * trigger phrases the user is going to copy / paste.
   */
  written:
    '  {{glyph}}  sm-tutorial.md created at {{cwd}}\n' +
    '\n' +
    '  Open Claude Code in this directory. Your first message sets\n' +
    '  the tutorial language for the rest of the session:\n' +
    '\n' +
    '      {{enLabel}}  run @sm-tutorial.md\n' +
    '      {{esLabel}}  ejecutá @sm-tutorial.md\n',
  writtenLabelEn: 'English',
  writtenLabelEs: 'Español',

  // Refusal — `sm-tutorial.md` already exists and `--force` was not set.
  // Goes to stderr, exit code 2 (operational error per spec § Exit codes).
  // Mirrors the success body shape: glyph + headline, then a dim hint
  // line spelling the fix.
  alreadyExists:
    '{{glyph}}  sm-tutorial.md already exists at {{cwd}}\n' +
    '   {{hint}}\n',
  alreadyExistsHint: 'Pass `--force` to overwrite.',

  // I/O failure on write or on reading the bundled SKILL source.
  writeFailed: '{{glyph}}  sm tutorial: failed to write sm-tutorial.md: {{message}}\n',
  sourceMissing:
    '{{glyph}}  sm tutorial: could not read the bundled tutorial (SKILL.md) from the install.\n' +
    '   {{hint}}\n',
  sourceMissingHint: 'Reinstall @skill-map/cli or report the bug.',
} as const;
