/**
 * CLI strings emitted by `sm tutorial`, `cli/commands/tutorial.ts`.
 *
 * Paired with the `sm-tutorial` skill (basic walkthrough) and the
 * `sm-master` skill (advanced walkthrough). The verb takes an optional
 * positional `variant` arg (`tutorial` default, or `master`) and a
 * `--for <provider>` flag selecting the destination territory. The skill
 * folder lands under the chosen Provider's `scaffold.skillDir`
 * (`.claude/skills` for Claude, `.agents/skills` for the open standard),
 * so every key that mentions a target path is parameterized with a
 * `{{target}}` placeholder and the success block also interpolates
 * `{{slug}}`, `{{provider}}`, plus per-language trigger phrases.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const TUTORIAL_TEXTS = {
  // Success, written to stdout after `<cwd>/{{target}}` is created.
  // The skill lives at `<skillDir>/<slug>/`; the tester's agent
  // auto-discovers it on the next boot, so the tester invokes by
  // speaking a trigger phrase rather than referencing the file path.
  // Message stays host-agnostic ("your coding agent") because the
  // destination Provider varies. English / Spanish triggers are
  // surfaced side by side and the first phrase the tester types sets
  // the tutorial language for the rest of the session.
  written:
    '  {{glyph}}  Skill `{{slug}}` materialized at {{target}} (under {{cwd}}, for {{provider}})\n' +
    '\n' +
    '  Open your coding agent in this directory. The skill is auto-\n' +
    '  discovered; invoke it with one of its trigger phrases. The\n' +
    '  first message you type sets the tutorial language for the\n' +
    '  rest of the session:\n' +
    '\n' +
    '      {{enLabel}}  {{enTrigger}}\n' +
    '      {{esLabel}}  {{esTrigger}}\n',
  writtenLabelEn: 'English',
  writtenLabelEs: 'Español',

  // Destination-provider prompt (interactive stdin, no `--for`). Header
  // uses a yellow `?` glyph; options are a numbered list of provider
  // label (with any `aka` agents in parentheses) + skill directory, with
  // a `(default)` marker on the first option (Claude). The input line
  // accepts a number, a provider id, or an empty answer (which takes the
  // default).
  promptHeader: '{{glyph}}  Which agent should host the tutorial skill?',
  promptOption: '     {{index}}) {{label}}: {{skillDir}}{{marker}}',
  promptDefaultMarker: '  (default)',
  promptInput: '  Enter the number or provider id [default {{index}}]: ',

  // Prompt answer matched neither an index nor an id. Goes to stderr,
  // exit code 2. Mirrors the error shape: glyph + headline + dim hint.
  promptInvalid:
    '{{glyph}}  sm tutorial: that is not one of the listed providers\n' +
    '   {{hint}}\n',

  // `--for` named a provider that does not exist or declares no
  // `scaffold.skillDir`. Goes to stderr, exit code 2.
  forUnknown:
    "{{glyph}}  sm tutorial: unknown provider '{{provider}}' for --for\n" +
    '   {{hint}}\n',
  forUnknownHint: 'Valid providers: {{ids}}.',

  // Defensive: no built-in provider declares a scaffold target. Should
  // never happen (claude always does). Goes to stderr, exit code 2.
  noTargets:
    '{{glyph}}  sm tutorial: no provider declares a skill scaffold target.\n',

  // Refusal, the cwd is not empty and `--force` was not set. Goes to
  // stderr, exit code 2 (operational error per spec § Exit codes). The
  // tutorial seeds a self-contained scenario into the cwd, so it needs
  // an empty directory; the hint spells the two ways forward. Mirrors
  // the error shape: glyph + headline + dim hint.
  notEmpty:
    '{{glyph}}  sm tutorial: the current directory is not empty (found {{entries}})\n' +
    '   {{hint}}\n',
  notEmptyHint:
    'sm tutorial seeds a self-contained scenario; run it in a fresh empty directory, or pass `--force` to use this one anyway.',

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
