/**
 * CLI strings emitted by `sm tutorial`, `cli/commands/tutorial.ts`.
 *
 * Paired with the single `sm-tutorial` skill (basic walkthrough plus the
 * advanced parts, selectable from the in-skill menu). The verb takes no
 * positional argument and a `--for <provider>` flag selecting the
 * destination territory. The skill folder lands under the chosen
 * Provider's `scaffold.skillDir` (`.claude/skills` for Claude,
 * `.agents/skills` for the open standard), so every key that mentions a
 * target path is parameterized with a `{{target}}` placeholder and the
 * success block also interpolates `{{slug}}`, `{{provider}}`, plus
 * per-language trigger phrases.
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
  // uses a yellow `?` glyph; options are a numbered list of the provider's
  // label (for a provider with an `aka`, the standard label leads and the
  // supporting vendors follow in parentheses, closed by `akaOthers` to mark
  // the set as open), with a `(default)` marker on the first option (Claude).
  // The destination folder is deliberately NOT shown: several providers share
  // `.agents/skills`, so the folder does not identify the lens. The input line
  // accepts a number, a provider id, or an empty answer (which takes the
  // default).
  promptHeader: '{{glyph}}  Which agent should host the tutorial skill?',
  promptOption: '     {{index}}) {{label}}{{marker}}',
  promptDefaultMarker: '  (default)',
  // Trailing token appended to the `aka` vendor list in the open-lens label
  // ("... (Google's Antigravity, others)"), signalling the open standard is
  // not tied to a single vendor and more will support it.
  akaOthers: 'others',
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

  // Legacy positional argument (e.g. a stale `sm tutorial master`). The
  // verb no longer takes a positional: there is a single umbrella skill
  // and the advanced walkthrough is a menu choice inside it, not a
  // separate install. Goes to stderr, exit code 2. Mirrors the error
  // shape: glyph + headline + dim hint.
  legacyPositional:
    "{{glyph}}  sm tutorial: unexpected argument '{{arg}}'\n" +
    '   {{hint}}\n',
  legacyPositionalHint:
    'sm tutorial takes no positional argument. The master walkthrough is no longer a separate install; run `sm tutorial` and pick the advanced parts from the in-skill menu.',

  // I/O failure on write or on reading the bundled skill source.
  writeFailed: '{{glyph}}  sm tutorial: failed to write {{target}}: {{message}}\n',
  sourceMissing:
    '{{glyph}}  sm tutorial: could not read the bundled skill payload for {{target}} from the install.\n' +
    '   {{hint}}\n',
  sourceMissingHint: 'Reinstall @skill-map/cli or report the bug.',

  // Completion ping (`--completed <part-id|book>`, run by the shipped
  // skill at part closes / the final wrap-up). The confirmation prints
  // the COLLAPSED id, never raw input.
  completionRecorded: '{{glyph}} Tutorial progress noted: {{id}}.',
  completedFlagsConflict:
    '{{glyph}}  sm tutorial: --completed cannot be combined with --for, --force, or --experimental.\n' +
    '   {{hint}}\n',
  completedFlagsConflictHint:
    'The completion ping performs no scaffolding; run it bare: `sm tutorial --completed <part-id>`.',
} as const;
