/**
 * Developer-facing log strings for `ScanTriggerService`. The service
 * issues a `/api/scan` request and surfaces the error in the topbar;
 * the `console.warn` mirrors that error for tester / dev visibility.
 * English-only per AGENTS.md (externalized, not internationalized).
 */
export const SCAN_TRIGGER_TEXTS = {
  /** Developer-only `console.warn` emitted when the scan request fails. */
  scanFailed: (message: string): string => `scan-trigger failed: ${message}`,
  /**
   * Screen-reader announcements for the scan lifecycle (WCAG 4.1.3).
   * The refresh button is a silent icon control, so these narrate the
   * async progression a sighted user reads from the spinner.
   */
  announce: {
    started: 'Scan started.',
    completed: 'Scan complete. Map updated.',
    failed: (message: string): string => `Scan failed: ${message}`,
  },
} as const;
