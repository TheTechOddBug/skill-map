/** UI strings for the NodeActionButton renderer. */
export const NODE_ACTION_BUTTON_TEXTS = {
  /** Fallback label when the payload omits one (manifests should not). */
  fallbackLabel: 'Run action',
  /** Aria label for the inline per-button error dismiss control. */
  dismissErrorAriaLabel: 'Dismiss',
  /**
   * Header passed to the prompt dialog when the action declares no
   * label. The dialog component carries its own fallback too, this one
   * keeps the action-specific copy with the renderer that owns the verb.
   */
  promptDialogHeader: 'Provide a value',
} as const;
