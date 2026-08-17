/**
 * Confirm copy for the FULL delete-recording gesture (the Settings
 * recording row, its own ConfirmationService dialog): one gesture
 * erases the browser tape AND the project session journal, and the
 * warning names the analyzer-evidence cost (user decision 2026-08-16:
 * warn, then it is the operator's call). The replay transport's trash
 * no longer routes here (2026-08-17): it clears the tape only.
 */
export const SESSION_PURGE_TEXTS = {
  confirmHeader: 'Delete the recording?',
  confirmMessage:
    'This deletes the recording in this browser AND the project session journal (.skill-map/sessions). The journal is the evidence behind the "Observed in sessions" findings: after the next scan they are gone until new sessions are recorded.',
  confirmAccept: 'Delete both',
  confirmReject: 'Cancel',
} as const;
