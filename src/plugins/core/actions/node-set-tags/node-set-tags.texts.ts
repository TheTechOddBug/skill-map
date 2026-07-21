/**
 * User-facing strings for the `node-set-tags` built-in action's
 * inspector surface (`plugins/core/actions/node-set-tags/index.ts`).
 *
 * The action's scan-time `project()` emits the `inspector.action.button`
 * contribution whose PRESENCE gates the inspector's inline tag row (the
 * row is the affordance, re-homed like the stability / version chips;
 * the payload label only surfaces in fallback renderers). Convention:
 * flat string templates, `tx` at `kernel/util/tx.ts` interpolates (none
 * needed here today).
 */

export const NODE_SET_TAGS_TEXTS = {
  /** Label of the action-button contribution that edits the tags. */
  editLabel: 'Edit tags',
} as const;
