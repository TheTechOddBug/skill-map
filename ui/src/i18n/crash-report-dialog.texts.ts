/**
 * UI strings for the CrashReportDialog (per-incident crash-report consent,
 * `spec/telemetry.md` §Per-incident crash-report consent). English-only per
 * the i18n convention; no em dashes.
 */
export const CRASH_REPORT_DIALOG_TEXTS = {
  header: 'Something crashed. Send an anonymous report?',
  body:
    'The report carries the error name, message, and stack trace, plus ' +
    'browser and version facts. Your home directory and this project\'s ' +
    'folder are redacted before sending, and no file contents, settings ' +
    'values, or identifiers ride along. Your answer applies to this ' +
    'report only; nothing is remembered.',
  previewLabel: 'Summary of what would be sent:',
  send: 'Send report',
  dismiss: 'Not now',
  ariaLabel: 'Crash report consent',
  /** Screen-reader announcement when the dialog opens. */
  announce: 'An error occurred. A crash report consent dialog is open.',
} as const;
