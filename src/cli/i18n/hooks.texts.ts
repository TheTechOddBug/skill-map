/**
 * CLI strings emitted by `sm hooks install pre-commit-bump`
 * (`cli/commands/hooks.ts`).
 *
 * The verb installs (or chains into) a git pre-commit hook that runs
 * `sm bump --pending --staged` so any staged drift in `.sm` sidecars
 * is auto-bumped before the commit lands. Idempotent: re-running the
 * install detects the existing skill-map block and no-ops.
 *
 * Convention: flat string templates with `{{name}}` placeholders.
 */

export const HOOKS_TEXTS = {
  // --- discovery / preflight ------------------------------------------------
  notInGitRepo:
    '{{glyph}}  sm hooks install: not inside a git repository.\n' +
    '   {{hint}}\n',
  notInGitRepoHint: 'No .git/ found at or above {{cwd}}.',

  alreadyInstalled:
    '{{glyph}}  pre-commit-bump is already installed at {{hookPath}}. Nothing to do.\n',

  // --- happy path -----------------------------------------------------------
  installed:
    '{{glyph}}  Installed pre-commit-bump at {{hookPath}}.\n',

  chainedExisting:
    '{{glyph}}  Appended pre-commit-bump to existing pre-commit hook at {{hookPath}}.\n',

  // --- dry-run --------------------------------------------------------------
  dryRunHeader:
    'sm hooks install --dry-run: would write the following content to {{hookPath}} (no changes made).\n',

  dryRunMarkerOpen:
    '--- target: {{hookPath}} ---\n',

  dryRunMarkerClose:
    '--- end ---\n',

  // --- failures -------------------------------------------------------------
  installFailed: '{{glyph}}  sm hooks install: {{message}}\n',
} as const;
