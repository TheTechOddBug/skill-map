/**
 * Strings for the fused workspace view (files rail + map + inspector on
 * one screen). English-only catalog, same posture as the other view
 * text files. Spike-stage surface; keep it small.
 */
export const WORKSPACE_VIEW_TEXTS = {
  /**
   * The rail's activity sections (files navigator + job queue +
   * recorded sessions). The collapsed icon bar and the open tab strip
   * share these labels; the chevron collapse control keeps its own
   * `rail.collapse` copy.
   */
  sections: {
    /** Accessible name for the tab strip / icon bar container. */
    ariaLabel: 'Workspace panel sections',
    files: 'Files',
    queue: 'Queue',
    sessions: 'Sessions',
    /** Icon-bar button tooltips (collapsed rail). */
    filesTooltip: 'Files navigator',
    queueTooltip: 'Job queue',
    sessionsTooltip: 'Recorded runtime sessions',
    /** Replaces the queue tooltip while the Live lens owns the workspace. */
    queueDisabledTooltip: 'The job queue is unavailable while the live lens is on',
    sessionsDisabledTooltip:
      'Sessions need the live-activity hook: install it in Settings > Project',
  },
  rail: {
    label: 'Files',
    collapse: 'Collapse panel',
    expand: 'Expand panel',
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
