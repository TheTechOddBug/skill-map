/**
 * Shared confirm copy for the delete-recording gesture (consumed by the
 * Settings recording row and the replay transport's trash, both
 * mounting their own ConfirmationService dialog): one gesture erases
 * the browser tape AND the project session journal, and the warning
 * names the analyzer-evidence cost (user decision 2026-08-16: warn,
 * then it is the operator's call).
 */
export const SESSION_PURGE_TEXTS = {
  confirmHeader: 'Delete the recording?',
  confirmMessage:
    'This deletes the recording in this browser AND the project session journal (.skill-map/sessions). The journal is the evidence behind the "Observed in sessions" findings: after the next scan they are gone until new sessions are recorded.',
  confirmAccept: 'Delete both',
  confirmReject: 'Cancel',
} as const;
