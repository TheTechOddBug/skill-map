/**
 * CLI strings emitted by `sm bump <node-path>` and `sm bump --pending`
 * (`cli/commands/bump.ts`).
 *
 * The `bump` verb wraps the built-in deterministic `core/bump` Action
 * (Step 9.6.3) — the kernel materialises sidecar writes through
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
  nodeAndPendingMutex:
    'sm bump: --pending cannot be combined with a positional <node.path>.\n',

  noTargetSpecified:
    'sm bump: pass <node.path> for a single-node bump, or --pending to ' +
    'bump every node carrying a stale sidecar.\n',

  stagedRequiresPending:
    'sm bump: --staged is only valid together with --pending.\n',

  // --- single-node mode -----------------------------------------------------
  nodeNotFound:
    'sm bump: node not found in the persisted scan: {{nodePath}}\n' +
    'Run `sm scan` first, then retry with the path as it appears in `sm list`.\n',

  refusedFresh:
    'sm bump: {{nodePath}} is fresh (no drift versus its sidecar). ' +
    'Pass --force to bump anyway.\n',

  bumped:
    'Bumped {{nodePath}} to annotations.version={{version}}.\n',

  bumpedCreated:
    'Created {{sidecarPath}} and bumped {{nodePath}} to annotations.version={{version}}.\n',

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
    '  refused {{nodePath}} (fresh — would need --force)\n',

  skippedItem:
    '  skipped {{nodePath}} ({{reason}})\n',

  errorItem:
    '  error  {{nodePath}}: {{message}}\n',

  // --- staged-mode (--staged) ---------------------------------------------
  notInGitRepo:
    'sm bump --staged: not inside a git repository (no .git/ found at or above {{cwd}}).\n',

  gitBinaryMissing:
    'sm bump --staged: `git` binary not found on PATH. Install git or run without --staged.\n',

  gitAddFailed:
    'sm bump --staged: git add failed for {{path}}: {{message}}. Continuing batch.\n',

  // --- failures -------------------------------------------------------------
  bumpFailed: 'sm bump: {{message}}\n',

  storeFailedDetail:
    'sidecar write failed for {{path}}: {{message}}',

  resolveAbsPathFailed:
    'cannot resolve absolute path for {{nodePath}}: {{message}}',
} as const;
