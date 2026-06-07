/**
 * User-facing strings emitted by the `tags` built-in analyzer
 * (`plugins/core/analyzers/tags/index.ts`).
 *
 * The analyzer surfaces no issues; it only projects the inspector
 * action button that dispatches `core/node-set-tags`. These strings are
 * the button label and the prompt label.
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
