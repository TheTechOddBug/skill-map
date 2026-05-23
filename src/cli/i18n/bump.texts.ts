/**
 * CLI strings emitted by `sm bump <node-path>` and `sm bump --pending`
 * (`cli/commands/bump.ts`).
 *
 * The `bump` verb wraps the built-in deterministic `core/bump` Action
 * (Step 9.6.3), the kernel materialises sidecar writes through
 * `FilesystemSidecarStore` after the Action returns. Single-node mode
 * is gated by drift unless `--force`; batch mode (`--pending`) walks
 * every stale node in the persisted scan and bumps them in `node.path`
 * ASC order.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const BUMP_TEXTS = {
  // --- argument validation --------------------------------------------------
  /**
   * §3.1b two-line block. Mutex between the positional <node.path> and
   * the `--pending` batch flag; hint names the two valid invocations.
   */
  nodeAndPendingMutex:
    '{{glyph}}  --pending cannot be combined with a positional <node.path>.\n' +
    '   {{hint}}\n',
  nodeAndPendingMutexHint:
    'Run `sm bump <node.path>` for a single bump, or `sm bump --pending` to batch every stale node.',

  /**
   * §3.1b two-line block. Headline names the missing input, hint maps
   * out the two valid invocations.
   */
  noTargetSpecified:
    '{{glyph}}  Pass <node.path> for a single-node bump, or --pending for batch mode.\n' +
    '   {{hint}}\n',
  noTargetSpecifiedHint:
    'Examples: `sm bump path/to/node.md` (single), `sm bump --pending` (every stale sidecar).',

  /**
   * §3.1b two-line block. `--staged` is a modifier on the batch flow;
   * the hint reminds the operator they need to add `--pending` too.
   */
  stagedRequiresPending:
    '{{glyph}}  --staged is only valid together with --pending.\n' +
    '   {{hint}}\n',
  stagedRequiresPendingHint:
    'Pass `--pending --staged` to bump every stale sidecar and `git add` each successful write.',

  // --- single-node mode -----------------------------------------------------
  nodeNotFound:
    '{{glyph}}  Node not found in the persisted scan: {{nodePath}}\n' +
    '   {{hint}}\n',
  nodeNotFoundHint:
    'Run `sm scan` first, then retry with the path as it appears in `sm list`.',

  refusedFresh:
    '{{glyph}}  {{nodePath}} is fresh (no drift versus its sidecar)\n' +
    '   {{hint}}\n',
  refusedFreshHint: 'Pass --force to bump anyway.',

  bumped:
    '{{glyph}}  Bumped {{nodePath}} to annotations.version={{version}}.\n',

  bumpedCreated:
    '{{glyph}}  Created {{sidecarPath}} and bumped {{nodePath}} to annotations.version={{version}}.\n',

  // --- batch (--pending) mode ----------------------------------------------
  pendingBanner:
    'sm bump --pending: scanning {{count}} stale node(s).\n',

  pendingNone:
    'sm bump --pending: no stale sidecars in the persisted scan. Nothing to do.\n',

  pendingSummary:
    'sm bump --pending: bumped {{bumped}}, refused {{refused}}, skipped {{skipped}}, errors {{errors}}.\n',

  bumpedItem:
    '  bumped {{nodePath}} -> v{{version}}{{createdSuffix}}\n',

  refusedItem:
    '  refused {{nodePath}} (fresh, would need --force)\n',

  skippedItem:
    '  skipped {{nodePath}} ({{reason}})\n',

  errorItem:
    '  error  {{nodePath}}: {{message}}\n',

  // --- staged-mode (--staged) ---------------------------------------------
  /**
   * §3.1b two-line block. Hint suggests dropping `--staged` (the bump
   * still runs without it) or running the verb from inside a git
   * checkout.
   */
  notInGitRepo:
    '{{glyph}}  --staged: not inside a git repository (no .git/ found at or above {{cwd}}).\n' +
    '   {{hint}}\n',
  notInGitRepoHint:
    'Drop `--staged` to bump without staging, or run `sm bump` from inside a git checkout.',

  gitBinaryMissing:
    '{{glyph}}  --staged: `git` binary not found on PATH.\n' +
    '   {{hint}}\n',
  gitBinaryMissingHint: 'Install git or run without --staged.',

  /**
   * §3.1b two-line block. Non-fatal advisory (yellow `⚠`): the bump
   * itself succeeded, only the staging missed; the batch keeps going.
   * The hint surfaces the "Continuing batch." continuation so it lives
   * on its own dim line instead of being glued to the headline.
   */
  gitAddFailed:
    '{{glyph}}  --staged: git add failed for {{path}}: {{message}}.\n' +
    '   {{hint}}\n',
  gitAddFailedHint: 'Continuing batch; stage the sidecar manually with `git add {{path}}` afterwards.',

  // --- failures -------------------------------------------------------------
  bumpFailed: '{{glyph}}  sm bump: {{message}}\n',

  storeFailedDetail:
    'sidecar write failed for {{path}}: {{message}}',

  resolveAbsPathFailed:
    'cannot resolve absolute path for {{nodePath}}: {{message}}',

  // --- .sm consent gate ---------------------------------------------------
  // The shared strings live in `consent.texts.ts` (CONSENT_TEXTS); they
  // are used by every verb that writes a sidecar (`sm bump`,
  // `sm sidecar refresh`, `sm sidecar annotate`) with a `{{verb}}`
  // placeholder for the directed prefix.
} as const;
