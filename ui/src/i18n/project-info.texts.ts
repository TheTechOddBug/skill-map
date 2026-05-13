/**
 * Developer-facing log strings for `ProjectInfoService`. The service
 * probes `/api/health` once at boot; failures are silent UI-side but
 * surface here for tester / dev visibility.
 * English-only per AGENTS.md (externalized, not internationalized).
 */
export const PROJECT_INFO_TEXTS = {
  /** Developer-only `console.warn` emitted when `/api/health` fails. */
  healthFailed: (message: string): string =>
    `ProjectInfoService: /api/health probe failed (${message})`,
} as const;
