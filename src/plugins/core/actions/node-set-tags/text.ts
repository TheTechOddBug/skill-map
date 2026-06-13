/**
 * User-facing strings for the `node-set-tags` built-in action's
 * inspector button (`plugins/core/actions/node-set-tags/index.ts`).
 *
 * The action's scan-time `project()` emits the `inspector.action.button`
 * that edits the taxonomy tags of the current node (the former
 * `core/tags` projector analyzer, now folded into the action that
 * dispatches the button). These strings are the button label and the
 * prompt label.
 *
 * Convention: flat string templates. The `tx` helper at
 * `kernel/util/tx.ts` does the interpolation (none needed here today).
 */

export const TAGS_TEXTS = {
  /** Label of the inspector action button that edits the node's tags. */
  editLabel: 'Edit tags',
  /** Prompt label for the string-list tags input. */
  promptLabel: 'Tags',
} as const;
