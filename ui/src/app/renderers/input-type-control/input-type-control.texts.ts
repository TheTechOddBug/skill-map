/** UI strings for the InputTypeControl component. */
export const INPUT_TYPE_CONTROL_TEXTS = {
  /** Placeholder for the `single-string` text input when none is supplied. */
  stringPlaceholder: 'Enter a value',
  /** Placeholder for the `enum-pick` select when none is supplied. */
  selectPlaceholder: 'Select an option',
  /** Placeholder for the `string-list` tag input when none is supplied. */
  listPlaceholder: 'Type and press Enter',
  /**
   * Fallback rendered for an input-type the control does not implement.
   * The control only ships single-string / enum-pick / string-list today;
   * an unknown type renders this notice instead of throwing so a future
   * payload referencing a not-yet-built type degrades gracefully.
   */
  unsupportedPrefix: 'Unsupported input type:',
} as const;
