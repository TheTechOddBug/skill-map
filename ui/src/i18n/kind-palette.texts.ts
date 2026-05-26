/** UI strings for the KindPalette component. Kind labels are shared via `kinds.texts.ts`. */
export const KIND_PALETTE_TEXTS = {
  a11y: {
    toolbarLabel: 'Toggle node kinds',
  },
  favorites: {
    label: 'Favorites',
  },
  search: {
    /** Tooltip on the magnifier when collapsed. */
    openTooltip: 'Search nodes',
    /** Tooltip on the magnifier when expanded (clicking collapses). */
    closeTooltip: 'Close search',
    /** `placeholder` + `aria-label` on the inline input. */
    placeholder: 'Search…',
    inputAriaLabel: 'Search nodes by name or tag',
  },
} as const;
