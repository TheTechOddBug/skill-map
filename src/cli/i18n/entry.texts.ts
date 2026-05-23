/**
 * Strings emitted from the CLI entry point, outside any single verb.
 * Covers the bare-invocation hint when the cwd has no `.skill-map/`
 * project, and the concise diagnostic for argv parse errors that
 * replaces Clipanion's full-catalog dump.
 */

export const ENTRY_TEXTS = {
  /**
   * Bare `sm` invocation from a directory with no `.skill-map/` DB.
   * Two-line error block per `context/cli-output-style.md` §3.1b:
   *   - line 1: `{{glyph}}` (red `✕` because the exit code is 2,
   *     "bad usage" per the spec), followed by the headline naming the
   *     cwd that has no project.
   *   - line 2 (indent 3): `{{hint}}`, dim, two actionable next steps
   *     joined by `or` so the operator picks the right one.
   * Backticks (instead of double quotes) wrap the verb names so the
   * rendered block matches the rest of the catalog (the
   * active-provider hint follows the same convention).
   */
  bareNoProject:
    '{{glyph}}  No skill-map project found in {{cwd}}.\n' +
    '   {{hint}}\n',
  bareNoProjectHint:
    'Run `sm init` to bootstrap one, or `sm --help` to see all commands.',

  parseErrorHeadline: 'sm: {{message}}',
  parseErrorUnknownOption: 'unknown option \'{{name}}\'',
  parseErrorUnknownOptionForVerb: '{{verb}}: unknown option \'{{name}}\'',
  parseErrorUnknownCommand: 'unknown command \'{{name}}\'',
  parseErrorIncompleteCommand: 'incomplete command \'{{name}}\'',
  parseErrorSubcommandList: 'Available subcommands: {{suggestions}}.',
  parseErrorVerbUsage: '{{verb}}: {{message}}',
  parseErrorMissingPositional: '{{verb}}: missing required positional argument(s) {{positionals}}',
  parseErrorFlagSuggestion: 'Did you mean \'{{suggestion}}\'?',
  parseErrorVerbSuggestion: 'Did you mean {{suggestions}}?',
  parseErrorVerbHelpHint: 'Run \'sm help {{verb}}\' for usage.',
  parseErrorFooter: 'Run \'sm help\' to see the full command list.',
} as const;
