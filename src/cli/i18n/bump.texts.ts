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
    '{{glyph}}  --pending cannot be combined with a positional <node.path>.\n',

  noTargetSpecified:
    '{{glyph}}  Pass <node.path> for a single-node bump, or --pending\n' +
    '   to bump every node carrying a stale sidecar.\n',

  stagedRequiresPending:
    '{{glyph}}  --staged is only valid together with --pending.\n',

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
    '  refused {{nodePath}} (fresh — would need --force)\n',

  skippedItem:
    '  skipped {{nodePath}} ({{reason}})\n',

  errorItem:
    '  error  {{nodePath}}: {{message}}\n',

  // --- staged-mode (--staged) ---------------------------------------------
  notInGitRepo:
    '{{glyph}}  --staged: not inside a git repository (no .git/ found at or above {{cwd}}).\n',

  gitBinaryMissing:
    '{{glyph}}  --staged: `git` binary not found on PATH.\n' +
    '   {{hint}}\n',
  gitBinaryMissingHint: 'Install git or run without --staged.',

  gitAddFailed:
    '{{glyph}}  --staged: git add failed for {{path}}: {{message}}. Continuing batch.\n',

  // --- failures -------------------------------------------------------------
  bumpFailed: '{{glyph}}  sm bump: {{message}}\n',

  storeFailedDetail:
    'sidecar write failed for {{path}}: {{message}}',

  resolveAbsPathFailed:
    'cannot resolve absolute path for {{nodePath}}: {{message}}',

  // --- .sm consent gate ---------------------------------------------------
  /**
   * Pre-prompt context shown before the interactive `confirm()` so the
   * operator sees what they are about to opt into. `.skill-map/settings.local.json`
   * is gitignored — the choice is saved per-checkout, never travels via the repo.
   */
  consentPrompt:
    'skill-map needs your consent to create .sm sidecar files next to your\n' +
    'source files in this project. The choice is saved to\n' +
    '.skill-map/settings.local.json (gitignored, per-checkout) so this prompt\n' +
    'never appears again. Decline to abort without persisting the rejection.\n\n' +
    'Allow .sm sidecar writes in this project?',
  consentAborted:
    '{{glyph}}  sm bump: aborted by user. No .sm sidecar files were written.\n',
  consentRequiredNonTty:
    '{{glyph}}  sm bump: consent required to write .sm sidecar files in this project.\n' +
    '   {{hint}}\n',
  consentRequiredNonTtyHint:
    'Pass --yes to grant (writes to .skill-map/settings.local.json — gitignored).',
} as const;
