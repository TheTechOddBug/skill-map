/**
 * UI strings for `<sm-session-node>` (the virtual session anchor the
 * graph floats above spawn targets while Real Time is on).
 */
export const SESSION_NODE_TEXTS = {
  /** Capsule label. Ordinals are page-lifetime (F5 renumbers). */
  label: (ordinal: number): string => `Session ${ordinal}`,
  /**
   * Tooltip / aria. The owner key is opaque (never parsed) but still
   * useful to tell two parallel sessions apart when debugging.
   */
  tooltip: (owner: string): string => `AI session context (owner key: ${owner})`,
  a11y: (ordinal: number): string => `Session ${ordinal}, live AI session anchor`,
} as const;
