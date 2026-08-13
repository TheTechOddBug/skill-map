/** UI strings for the Live lens toolbar controls (`sm-live-lens-controls`). */
export const LIVE_LENS_TEXTS = {
  toggle: {
    ariaOn: 'Exit the live lens',
    ariaOff: 'Enter the live lens',
    tooltipOn: 'Exit the live lens and restore your map',
    tooltipOff: 'Live lens: watch only the nodes your AI runtime is executing',
  },
  window: {
    aria: 'Linger window',
    tooltip: 'How long a node stays on the lens after executing',
    fiveMinutes: '5 min',
    infinite: 'No limit',
    /** Compact face for the toolbar button itself. */
    compactFiveMinutes: '5m',
    compactInfinite: 'ALL',
  },
  reset: {
    aria: 'Clear the lens canvas',
    tooltip: 'Clear the canvas; nodes executing right now stay',
  },
} as const;
