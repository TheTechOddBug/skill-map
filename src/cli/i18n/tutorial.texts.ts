/**
 * CLI strings emitted by `sm tutorial`, `cli/commands/tutorial.ts`.
 *
 * Paired with the `sm-tutorial` Claude Code skill (basic walkthrough)
 * and the `sm-master` skill (advanced walkthrough). The verb takes an
 * optional positional `variant` arg whose value is one of `tutorial`
 * (default, writes `sm-tutorial.md`) or `master` (writes `sm-master.md`),
 * so every key that mentions a target file name is parameterized with
 * a `{{filename}}` placeholder. The trigger labels (`enLabel` /
 * `esLabel`) also interpolate the filename so the success block points
 * the tester at whichever file was materialised.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const TUTORIAL_TEXTS = {
  // Success, written to stdout after `<cwd>/{{filename}}` is created.
  // Multi-line layout: the two trigger phrases (English / Spanish) are
  // indented and labelled so they're the most visible part of the
  // output. The reminder above them surfaces the SKILL's language
  // policy: the first message the tester writes to Claude sets the
  // tutorial language for the rest of the session.
  /**
   * Success body. `glyph` is wrapped green at the call site; `cwd`
   * renders relative to the user's cwd when it sits underneath. The
   * `English` / `Español` labels print dim, the eye lands on the
   * trigger phrases the user is going to copy / paste.
   */
  written:
    '  {{glyph}}  {{filename}} created at {{cwd}}\n' +
    '\n' +
    '  Open Claude Code in this directory. Your first message sets\n' +
    '  the tutorial language for the rest of the session:\n' +
    '\n' +
    '      {{enLabel}}  run @{{filename}}\n' +
    '      {{esLabel}}  ejecutá @{{filename}}\n',
  writtenLabelEn: 'English',
  writtenLabelEs: 'Español',

  // Refusal, `{{filename}}` already exists and `--force` was not set.
  // Goes to stderr, exit code 2 (operational error per spec § Exit codes).
  // Mirrors the success body shape: glyph + headline, then a dim hint
  // line spelling the fix.
  alreadyExists:
    '{{glyph}}  {{filename}} already exists at {{cwd}}\n' +
    '   {{hint}}\n',
  alreadyExistsHint: 'Pass `--force` to overwrite.',

  // Invalid `variant` positional argument. Goes to stderr, exit code 2.
  // Mirrors `alreadyExists`: glyph + headline + dim hint enumerating the
  // valid values.
  invalidVariant:
    "{{glyph}}  sm tutorial: unknown variant '{{variant}}'\n" +
    '   {{hint}}\n',
  invalidVariantHint: 'Valid values: tutorial (default), master.',

  // I/O failure on write or on reading the bundled SKILL source.
  writeFailed: '{{glyph}}  sm tutorial: failed to write {{filename}}: {{message}}\n',
  sourceMissing:
    '{{glyph}}  sm tutorial: could not read the bundled tutorial ({{filename}}) from the install.\n' +
    '   {{hint}}\n',
  sourceMissingHint: 'Reinstall @skill-map/cli or report the bug.',
} as const;
