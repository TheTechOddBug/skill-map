/**
 * Strings for the topbar "update available" chip rendered when the BFF
 * reports `/api/update-status -> isOutdated: true`. English-only per
 * AGENTS.md (externalized but not internationalized).
 */
export const UPDATE_CHECK_TEXTS = {
  available: 'Update available',
  tooltip: (latest: string) =>
    `v${latest} is available. Run \`npm i -g @skill-map/cli@latest\` to update.`,
  a11yLabel: (latest: string) => `Update available: version ${latest}`,
  /** Topbar version chip — shown next to the Beta badge so screenshots are self-identifying. */
  versionLabel: (current: string) => `v${current}`,
  versionTooltip: (current: string) => `skill-map CLI v${current}`,
  versionA11yLabel: (current: string) => `Running version ${current}`,
} as const;
