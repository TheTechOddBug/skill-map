/** UI strings for the InputTypeControl component. */
export const INPUT_TYPE_CONTROL_TEXTS = {
  /** Placeholder for the `single-string` / `path-glob` / `regex` text input. */
  stringPlaceholder: 'Enter a value',
  /** Placeholder for the `enum-pick` select when none is supplied. */
  selectPlaceholder: 'Select an option',
  /** Placeholder for the `enum-multipick` multiselect when none is supplied. */
  multiSelectPlaceholder: 'Select options',
  /** Placeholder for the `string-list` / multiple `path-glob` tag input. */
  listPlaceholder: 'Type and press Enter',
  /** Aria-label for a click-to-add suggestion chip in the `string-list` palette. */
  suggestionAddAriaLabel: (value: string) => `Add ${value}`,
  /** Placeholder for a `secret` field that already holds a stored value. */
  secretSetPlaceholder: 'Leave blank to keep current value',
  /** Placeholder for a `secret` field with no stored value. */
  secretEmptyPlaceholder: 'Enter a value',
  /** Status note rendered next to a secret control when a value is stored. */
  secretSet: 'Set',
  /** Status note rendered next to a secret control when no value is stored. */
  secretEmpty: 'Empty',
  /** Aria/title for the regex flags suffix chip. */
  regexFlagsLabel: 'Regex flags',
  /** Key-value editor: add-row button label. */
  keyValueAdd: 'Add row',
  /** Key-value editor: remove-row button aria label. */
  keyValueRemove: 'Remove row',
  /** Key-value editor: default key / value column headers. */
  keyValueKeyDefault: 'Key',
  keyValueValueDefault: 'Value',
  /**
   * Fallback rendered for an input-type the control does not implement.
   * The control now ships all eleven catalog types; this only fires for
   * a future, not-yet-built type so the form degrades gracefully rather
   * than throwing.
   */
  unsupportedPrefix: 'Unsupported input type:',
} as const;
