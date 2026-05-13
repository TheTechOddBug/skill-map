/**
 * Developer-facing log strings for `ScanTriggerService`. The service
 * issues a `/api/scan` request and surfaces the error in the topbar;
 * the `console.warn` mirrors that error for tester / dev visibility.
 * English-only per AGENTS.md (externalized, not internationalized).
 */
export const SCAN_TRIGGER_TEXTS = {
  /** Developer-only `console.warn` emitted when the scan request fails. */
  scanFailed: (message: string): string => `scan-trigger failed: ${message}`,
} as const;
