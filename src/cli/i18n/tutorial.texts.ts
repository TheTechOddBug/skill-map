/**
 * CLI strings emitted by `sm tutorial`, `cli/commands/tutorial.ts`.
 *
 * Paired with the `sm-tutorial` Claude Code skill (basic walkthrough)
 * and the `sm-master` skill (advanced walkthrough). The verb takes an
 * optional positional `variant` arg whose value is one of `tutorial`
 * (default, writes `.claude/skills/sm-tutorial/`) or `master` (writes
 * `.claude/skills/sm-master/`), so every key that mentions a target
 * path is parameterized with a `{{target}}` placeholder and the
 * success block also interpolates `{{slug}}` plus per-language trigger
 * phrases the tester can copy-paste.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const TUTORIAL_TEXTS = {
  // Success, written to stdout after `<cwd>/{{target}}` is created.
  // The skill now lives at `.claude/skills/<slug>/`; Claude Code
  // auto-discovers it on the next boot, so the tester invokes by
  // speaking a trigger phrase rather than referencing the file path.
  // English / Spanish triggers are surfaced side by side and the
  // first phrase the tester types sets the tutorial language for the
  // rest of the session.
  written:
    '  {{glyph}}  Skill `{{slug}}` materialized at {{target}} (under {{cwd}})\n' +
    '\n' +
    '  Open Claude Code in this directory. The skill is auto-\n' +
    '  discovered; invoke it with one of its trigger phrases. The\n' +
    '  first message you type sets the tutorial language for the\n' +
    '  rest of the session:\n' +
    '\n' +
    '      {{enLabel}}  {{enTrigger}}\n' +
    '      {{esLabel}}  {{esTrigger}}\n',
  writtenLabelEn: 'English',
  writtenLabelEs: 'Español',

  // Refusal, `{{target}}` already exists and `--force` was not set.
  // Goes to stderr, exit code 2 (operational error per spec § Exit codes).
  // Mirrors the success body shape: glyph + headline, then a dim hint
  // line spelling the fix.
  alreadyExists:
    '{{glyph}}  {{target}} already exists under {{cwd}}\n' +
    '   {{hint}}\n',
  alreadyExistsHint: 'Pass `--force` to overwrite (deletes the existing folder first).',

  // Invalid `variant` positional argument. Goes to stderr, exit code 2.
  // Mirrors `alreadyExists`: glyph + headline + dim hint enumerating the
  // valid values.
  invalidVariant:
    "{{glyph}}  sm tutorial: unknown variant '{{variant}}'\n" +
    '   {{hint}}\n',
  invalidVariantHint: 'Valid values: tutorial (default), master.',

  // I/O failure on write or on reading the bundled skill source.
  writeFailed: '{{glyph}}  sm tutorial: failed to write {{target}}: {{message}}\n',
  sourceMissing:
    '{{glyph}}  sm tutorial: could not read the bundled skill payload for {{target}} from the install.\n' +
    '   {{hint}}\n',
  sourceMissingHint: 'Reinstall @skill-map/cli or report the bug.',
} as const;
