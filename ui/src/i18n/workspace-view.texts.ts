/**
 * Strings for the fused workspace view (files rail + map + inspector on
 * one screen). English-only catalog, same posture as the other view
 * text files. Spike-stage surface; keep it small.
 */
export const WORKSPACE_VIEW_TEXTS = {
  rail: {
    label: 'Files',
    collapse: 'Collapse files panel',
    expand: 'Expand files panel',
    resize: 'Resize files panel',
    searchPlaceholder: 'Search…',
    searchAriaLabel: 'Search nodes by name or tag',
    /** In-input clear button, shown only while the search has text. */
    searchClear: 'Clear search',
    /** Tooltip when the search → map coupling is ON (click turns it off). */
    searchMapOn: 'Search also filters the map. Click so it filters only the files list.',
    /** Tooltip when the coupling is OFF, the default (click turns it on). */
    searchMapOff: 'Search filters only the files list. Click so it also filters the map.',
    /** Tooltip when "files follows selection" is ON (click turns it off). */
    followOn: 'Selecting a node reveals it in the files list. Click to turn off.',
    /** Tooltip when "files follows selection" is OFF, the default (click turns it on). */
    followOff: 'Selecting a node does not touch the files list. Click so it reveals the node here.',
    /** Reset control: clears the map folder selection AND every facet filter. */
    reset: 'Reset filters',
    resetTooltip: 'Show all on the map and clear the search, kind, severity and favorite filters',
  },
} as const;
