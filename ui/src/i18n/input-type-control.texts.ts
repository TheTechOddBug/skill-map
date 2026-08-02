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
  /** Match-list editor: per-kind option labels for the type select. */
  matchKindLiteral: 'literal',
  matchKindRegex: 'regex',
  matchKindGlob: 'glob',
  /** Match-list editor: aria label for the pending entry's kind select. */
  matchKindAriaLabel: 'Match kind',
  /** Match-list editor: placeholder for the pending entry's value input. */
  matchValuePlaceholder: 'Value to match',
  /** Match-list editor: add-entry button label. */
  matchAdd: 'Add',
  /** Match-list editor: remove-entry button label. */
  matchRemove: 'Remove',
  /** Match-list editor: inline error for an uncompilable regex entry. */
  matchInvalidRegex: 'This pattern is not a valid regular expression.',
  /** Match-list editor: inline error for control characters in the value. */
  matchHasControlChar: 'Value must be a single line without control characters.',
  /** Match-list editor: inline error for a value over the 256-char cap. */
  matchTooLong: 'Value must be 256 characters or fewer.',
  /** Match-list editor: inline error for an entry already in the list. */
  matchDuplicate: 'This entry is already in the list.',
  /**
   * Fallback rendered for an input-type the control does not implement.
   * The control now ships all twelve catalog types; this only fires for
   * a future, not-yet-built type so the form degrades gracefully rather
   * than throwing.
   */
  unsupportedPrefix: 'Unsupported input type:',
} as const;
