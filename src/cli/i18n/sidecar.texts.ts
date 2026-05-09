/**
 * CLI strings emitted by the `sm sidecar` sub-namespace
 * (`cli/commands/sidecar.ts`):
 *
 *   - `sm sidecar refresh <node-path>` — refresh `for.{bodyHash,
 *     frontmatterHash}` only; do NOT bump the version, do NOT touch
 *     the audit block. Useful when the user knows the body change is
 *     editorial-only and they don't want to spend a version increment.
 *   - `sm sidecar prune [--dry-run]` — delete orphan `.sm` files
 *     (those whose accompanying `.md` no longer exists).
 *   - `sm sidecar annotate <node-path> [--force]` — pure scaffolding:
 *     create an empty `.sm` next to the `.md` ready for editing.
 *
 * `sm sidecar refresh` is intentionally distinct from `sm refresh` (the
 * Step A.8 enrichment-layer verb) — different storage, different
 * concept; the sub-namespace prefix keeps the two from colliding.
 *
 * Convention: flat string templates with `{{name}}` placeholders.
 */

export const SIDECAR_TEXTS = {
  // --- sm sidecar refresh ---------------------------------------------------
  refreshNodeNotFound:
    'sm sidecar refresh: node not found in the persisted scan: {{nodePath}}\n' +
    'Run `sm scan` first, then retry with the path as it appears in `sm list`.\n',

  refreshNoSidecar:
    'sm sidecar refresh: no sidecar at {{sidecarPath}}. ' +
    'Run `sm sidecar annotate` to scaffold one, or `sm bump` to create it via the Action.\n',

  refreshFresh:
    '{{glyph}}  {{nodePath}} is fresh (hashes match the live node). Nothing to do.\n',

  refreshUpdated:
    '{{glyph}}  Refreshed {{sidecarPath}} (bodyHash + frontmatterHash sync\'d to live node, version unchanged).\n',

  refreshFailed: 'sm sidecar refresh: {{message}}\n',

  // --- sm sidecar prune -----------------------------------------------------
  pruneNone:
    '{{glyph}}  No orphan .sm files found under the configured roots.\n',

  pruneItem: '  {{action}} {{sidecarPath}} (expected {{expectedMd}})\n',

  pruneConfirm:
    'sm sidecar prune is about to delete {{count}} orphan .sm file(s):\n' +
    '{{lines}}\n' +
    'Proceed?',

  pruneAborted: 'sm sidecar prune: aborted by user. No files deleted.\n',

  pruneSummary:
    '{{glyph}}  Deleted {{deleted}} orphan .sm file{{plural}}.\n',

  pruneSummaryDryRun:
    '{{glyph}}  Would delete {{wouldDelete}} orphan .sm file{{plural}}{{dryTag}}\n',

  pruneDeleteFailed:
    'sm sidecar prune: failed to delete {{path}}: {{message}}. Continuing.\n',

  // --- sm sidecar annotate --------------------------------------------------
  annotateNodeNotFound:
    'sm sidecar annotate: node not found in the persisted scan: {{nodePath}}\n' +
    'Run `sm scan` first, then retry with the path as it appears in `sm list`.\n',

  annotateExists:
    'sm sidecar annotate: {{sidecarPath}} already exists. Pass --force to overwrite.\n',

  annotateCreated:
    '{{glyph}}  Created {{sidecarPath}}. Edit it, then run `sm bump {{nodePath}}` to commit the version.\n',
  /** Trailing dim tag for sidecar prune dry-run (matches the orphans pattern). */
  sidecarDryRunTag: '  (no changes made)',

  annotateFailed: 'sm sidecar annotate: {{message}}\n',
} as const;
