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
  /**
   * `sm -v` / `sm -q` / `sm --json` with no verb. These are documented
   * GLOBAL flags, so "unknown option" (Clipanion's parse error) would be
   * a lie, and routing them to `sm serve` starts a long-running process
   * for what reads like a question.
   */
  bareGlobalFlagOnly:
    '{{glyph}}  {{flags}} {{subject}}, not {{object}}.\n' +
    '   Pass {{pronoun}} alongside a verb (`sm {{example}} scan`), or run `sm help` for the command list.\n',
  bareNoProjectHint:
    'Run `sm init` to bootstrap one, or `sm --help` to see all commands.',
  /**
   * Hint variant for a bare `sm` in an EMPTY cwd when the interactive
   * menu cannot run (non-TTY stdin) or the operator gave no valid pick.
   * Points at the two getting-started verbs instead of `sm init` (a
   * brand-new user in an empty folder wants to try the tool, not
   * bootstrap an empty project).
   */
  bareEmptyHint:
    'Run `sm tutorial` for a guided walkthrough, or `sm example` to drop a project to explore.',

  /**
   * Confirm question for a bare `sm` in a NON-empty cwd with no project on
   * an interactive terminal. Header uses a yellow `?` glyph to match the
   * empty-folder menu; `confirm()` appends the ` [Y/n] ` suffix (default
   * yes). On accept the entry runs `sm init` then opens the UI (`sm serve`).
   */
  bareOfferInit:
    '{{glyph}}  No skill-map project in {{cwd}}. Set it up and open the map now?',

  /**
   * Getting-started menu shown on bare `sm` in an empty folder on an
   * interactive terminal. Header uses a yellow `?` glyph; two numbered
   * options dispatch to `sm tutorial` / `sm example`; the input line
   * accepts a number, a verb name, or an empty answer (which takes the
   * default, option 1, the tutorial).
   */
  emptyMenuHeader: '{{glyph}}  This folder is empty. How would you like to start?',
  emptyMenuOptionTutorial: '     1) Run the guided tutorial          (sm tutorial)  (default)',
  emptyMenuOptionExample: '     2) Copy an example project to try    (sm example)',
  emptyMenuInput: '  Enter the number [default 1]: ',

  parseErrorHeadline: 'sm: {{message}}',
  parseErrorUnknownOption: 'unknown option \'{{name}}\'',
  parseErrorUnknownOptionForVerb: '{{verb}}: unknown option \'{{name}}\'',
  parseErrorUnknownCommand: 'unknown command \'{{name}}\'',
  parseErrorIncompleteCommand: 'incomplete command \'{{name}}\'',
  parseErrorSubcommandList: 'Available subcommands: {{suggestions}}.',
  /**
   * Same line when the namespace has more subcommands than the sample
   * shows: the count keeps the sample honest ("Available subcommands"
   * alone reads as exhaustive when it is a 3-item slice).
   */
  parseErrorSubcommandListMore: 'Available subcommands: {{suggestions}}, and {{count}} more.',
  parseErrorVerbUsage: '{{verb}}: {{message}}',
  parseErrorMissingPositional: '{{verb}}: missing required positional argument(s) {{positionals}}',
  parseErrorFlagSuggestion: 'Did you mean \'{{suggestion}}\'?',
  parseErrorVerbSuggestion: 'Did you mean {{suggestions}}?',
  parseErrorVerbHelpHint: 'Run \'sm help {{verb}}\' for usage.',
  /** Footer for the incomplete-namespace error, points at that namespace's overview. */
  parseErrorNamespaceHelpHint: 'Run \'sm help {{name}}\' to see all subcommands.',
  parseErrorFooter: 'Run \'sm help\' to see the full command list.',
} as const;
