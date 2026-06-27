/** UI strings for the NodeBadge renderer (`inspector.header.badge` slot). */
export const NODE_BADGE_TEXTS = {
  /**
   * Off-screen aria fallback when a badge carries a count but no label.
   * Screen readers announce "<count> <icon-name-unknown>" otherwise, so
   * we lean on the manifest label / tooltip when present and fall back
   * to this neutral word for the count-only case.
   */
  countAriaFallback: 'count',
} as const;
