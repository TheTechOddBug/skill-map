/** UI strings for the ActionPromptDialog (parametrized-action prompt). */
export const ACTION_PROMPT_DIALOG_TEXTS = {
  /** Fallback header when the action declares no label. */
  fallbackHeader: 'Provide a value',
  /** Aria label for the dialog shell. */
  ariaLabel: 'Action input',
  /** Confirm button (dispatches the action). */
  confirm: 'Confirm',
  /** Cancel button (closes without dispatching). */
  cancel: 'Cancel',
} as const;
