/**
 * CLI strings emitted by the `sm issues` verb family
 * (`cli/commands/issues.ts`): the dismissal escape hatch for
 * DETERMINISTIC analyzer issues, keyed by (analyzer, value)
 * (`spec/cli-contract.md` §sm issues dismiss / undismiss /
 * suppressions). Unlike the findings read-time lens, an issue
 * suppression applies at EMISSION time: dismissing deletes the stored
 * rows immediately, undismissing needs a rescan for the issue to
 * reappear.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const ISSUES_TEXTS = {
  // --- sm issues dismiss ---------------------------------------------------
  /**
   * Success: the `annotations.issueSuppressions` entry landed in the
   * node's `.sm` sidecar and the matching persisted rows were deleted,
   * so every read agrees immediately. Names the silenced (analyzer,
   * value) pair, the node, and the deleted-row count so the operator
   * sees exactly what stops being flagged. Every interpolated value is
   * sanitized at the call site.
   */
  dismissDone:
    '{{glyph}}  Dismissed: {{analyzer}} "{{value}}" on {{node}} ' +
    '(recorded in {{sidecar}}; {{deleted}} stored issue row{{plural}} deleted).\n' +
    '   {{hint}}\n',
  dismissDoneHint:
    'The analyzer skips this exact value on every future scan; `sm issues undismiss` lifts it (the issue returns at the next scan).',
  /** Exit 5: the node is not in the current scan, nothing to anchor to. */
  dismissNodeGone:
    '{{glyph}}  Node {{node}} is not in the current scan.\n' +
    '   {{hint}}\n',
  dismissNodeGoneHint: 'Run `sm scan` to index the node, then dismiss again.',

  // --- sm issues undismiss -------------------------------------------------
  /**
   * Success: the entry left the sidecar. The suppression acted at
   * EMISSION time (the rows were deleted, not hidden), so the issue
   * reappears only at the NEXT scan, the documented asymmetry with
   * dismiss, which takes effect immediately.
   */
  undismissDone:
    '{{glyph}}  Un-dismissed: {{analyzer}} "{{value}}" on {{node}} ' +
    '(removed from {{sidecar}}).\n' +
    '   {{hint}}\n',
  undismissDoneHint:
    'The issue reappears at the NEXT scan (issue suppressions act at emission time); run `sm scan` to re-check the node.',
  /** Exit 5: no issue-suppression entry matches the (analyzer, value) pair. */
  undismissNoMatch:
    '{{glyph}}  No issue suppression for {{analyzer}} "{{value}}" on {{node}}.\n' +
    '   {{hint}}\n',
  undismissNoMatchHint:
    'Run `sm issues suppressions -n <path>` to list the active entries (matching is exact and case-sensitive on the value).',
  /** Exit 5: the node is not in the current scan. */
  undismissNodeGone:
    '{{glyph}}  Node {{node}} is not in the current scan.\n' +
    '   {{hint}}\n',
  undismissNodeGoneHint: 'Run `sm scan` to re-index the node, then undismiss again.',

  // --- sm issues suppressions ----------------------------------------------
  /** Zero active issue suppressions across the queried scope. */
  suppressionsNone: '{{glyph}}  No active issue suppressions.\n',
  /** Header over the listing: total entry count. */
  suppressionsHeader: 'sm issues suppressions: {{count}} active\n\n',
  /**
   * One suppression row: node, the silenced (analyzer, value) pair, the
   * optional note. `{{noteSuffix}}` is empty or the note shape below.
   */
  suppressionsRow: '  {{node}}  {{analyzer}}  "{{value}}"{{noteSuffix}}\n',
  /** The dim `  note` tail on a row; omitted when the entry has no note. */
  suppressionsNoteSuffix: '  {{note}}',
  /** Footer hint pointing at the escape hatch. */
  suppressionsTip:
    '\nTip: `sm issues undismiss <analyzer> <value> -n <path>` removes one; the issue returns at the next scan.\n',
} as const;
