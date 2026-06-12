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
    /** Tooltip when the search → map coupling is ON (click turns it off). */
    searchMapOn: 'Search also filters the map. Click so it filters only the files list.',
    /** Tooltip when the coupling is OFF, the default (click turns it on). */
    searchMapOff: 'Search filters only the files list. Click so it also filters the map.',
  },
} as const;
