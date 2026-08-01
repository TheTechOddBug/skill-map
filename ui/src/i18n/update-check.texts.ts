/**
 * Strings for the topbar "update available" chip rendered when the BFF
 * reports `/api/update-status -> isOutdated: true`. English-only per
 * AGENTS.md (externalized but not internationalized).
 */
const COPY_COMMAND = 'npm i -g @skill-map/cli@latest';

export const UPDATE_CHECK_TEXTS = {
  available: 'Update available',
  /** Chip label swapped in briefly after a successful clipboard copy. */
  copiedLabel: 'Copied!',
  tooltip: (latest: string) =>
    `v${latest} is available. Click to copy the install command.`,
  /** Command copied to the clipboard when the chip is clicked. */
  copyCommand: COPY_COMMAND,
  /** Tooltip swap shown briefly after a successful copy. */
  copiedTooltip: 'Copied! Paste it in your terminal.',
  /**
   * Tooltip / aria swap when the clipboard write is blocked (insecure
   * context or denied permission): surfaces the literal command so the
   * click stays recoverable by hand instead of failing silently.
   */
  copyFailedTooltip: `Copy blocked by the browser. Run this in your terminal:\n${COPY_COMMAND}`,
  copyFailedA11y: `Copy failed. Run this in your terminal: ${COPY_COMMAND}`,
  /** Companion external-link chip pointing at the official npm package page. */
  npmLinkUrl: 'https://www.npmjs.com/package/@skill-map/cli',
  npmLinkTooltip: 'Open on npm',
  npmLinkA11y: 'Open the @skill-map/cli package page on npm',
  a11yLabel: (latest: string) => `Update available: version ${latest}, click to copy the install command`,
  /** Topbar version chip, shown next to the Beta badge so screenshots are self-identifying. */
  versionLabel: (current: string) => `v${current}`,
  versionTooltip: (current: string) => `skill-map CLI v${current}`,
  versionA11yLabel: (current: string) => `Running version ${current}`,
  /** Developer-only `console.warn` emitted when the BFF probe fails. */
  fetchFailed: (message: string): string =>
    `UpdateCheckService: fetch failed (${message})`,
} as const;
