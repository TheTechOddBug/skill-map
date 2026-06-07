/** UI strings for the NodeSection renderer (`inspector.body.section` slot). */
export const NODE_SECTION_TEXTS = {
  /** Shown inside an expanded zone that carries no key/value entries. */
  emptyEntries: 'No entries.',
  /**
   * Off-screen aria-label fallback for the collapsible toggle when the
   * zone title cannot be resolved (corrupt payload). The toggle is built
   * on `<sm-collapsible-section>`, whose own title drives the visible
   * label; this only feeds the screen-reader path in the empty-title
   * edge case.
   */
  toggleAriaFallback: 'Plugin section',
} as const;
