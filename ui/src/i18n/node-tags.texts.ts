/**
 * UI strings for `<sm-node-tags>`, the inspector's inline tag row.
 *
 * View mode renders the node's `annotations.tags` as clickable filter
 * chips plus a pencil affordance; edit mode swaps in the inline
 * string-list editor (add / remove) and Save / Cancel. English-only
 * catalog (externalized texts, see AGENTS.md).
 */
export const NODE_TAGS_TEXTS = {
  /** aria-label for a tag chip (clicking filters the map by that tag). */
  tagFilterAriaLabel: (tag: string) => `Select every node tagged ${tag} on the map`,
  /** Tooltip / aria-label on the pencil when the node already has tags. */
  editTooltip: 'Edit tags',
  /** Tooltip / aria-label on the pencil when the node has no tags yet. */
  addTooltip: 'Add tags',
  /**
   * Auto-tag affordance (user request 2026-07-21): the magic (sparkles)
   * button on the tag row queues `core/ai-tagger-action`; the inferred
   * tags land in the sidecar via the record-side write-through and the
   * chips refresh on the next scan broadcast.
   */
  autoTag: {
    tooltipIdle: 'Auto-tag this file',
    tooltipQueued: 'Auto-tag queued',
    tooltipRunning: 'Inferring tags…',
    /**
     * Gate tooltip: no agent is set up to drain the queue for the
     * active lens, so the button sits disabled (visible, never hidden).
     * Same wording as the header's summarize gate; deliberately terse,
     * it states the requirement and leaves the how-to to the AI Actions
     * warning.
     */
    tooltipNoAgent: 'Needs a jobs agent',
    tooltipAgentSilent: 'No agent answered the last check',
    tooltipChecking: 'Checking your agent setup...',
  },
  /** Inline title for the view-mode tag row (renders as `TAGS:`). */
  viewLabel: 'Tags',
  /** Label above the inline tag editor input. */
  editorLabel: 'Tags',
  /** Save / cancel the inline edit. */
  save: 'Save',
  cancel: 'Cancel',
  saveAriaLabel: 'Save tags',
  cancelAriaLabel: 'Cancel editing tags',
  /** aria-label on the error banner's dismiss button. */
  dismissErrorAriaLabel: 'Dismiss error',
} as const;
