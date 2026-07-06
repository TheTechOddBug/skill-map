/** UI strings for the GraphView. */
export const GRAPH_VIEW_TEXTS = {
  loading: 'Loading collection',
  errorTitle: 'Failed to load',
  emptyTitle: 'No nodes match the current filters.',
  resetFilters: 'Reset filters',
  curationEmptyTitle: 'Nothing from your map selection is visible right now.',
  showAllOnMap: 'Show all on map',
  a11y: {
    toolbar: 'Map controls',
    panel: 'Selected node details',
  },
  toolbar: {
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fitToScreen: 'Fit to screen',
    /**
     * "Follow the Activity" camera toggle (spec/provider-activity.md
     * lighting, camera side). Only rendered while Real Time is on; a
     * manual pan / zoom switches it back off (log-viewer follow
     * semantics), hence the on/off tooltip pair.
     */
    followActivity: {
      tooltipOn: 'Stop following the activity',
      tooltipOff: 'Follow the activity',
      ariaOn: 'Stop following the activity',
      ariaOff: 'Follow the activity',
    },
    resetLayoutLabel: 'Re-arrange layout',
    resetLayoutTooltip: 'Re-arrange the visible nodes',
    showAllLabel: 'Show all',
    showAllTooltip: 'Clear the map selection and show every node again',
    showAllAria: 'Show all nodes on the map',
    /**
     * Inline graph-layout popovers anchored to the bottom toolbar.
     * The popovers are the only surface that exposes these knobs,
     * Settings → General used to mirror them but was retired once
     * the toolbar shipped (the user can live-tinker without opening
     * a modal). Labels here drive both the button `aria-label` /
     * tooltip and the popover items.
     */
    layoutAlgorithmLabel: 'Layout algorithm',
    layoutAlgorithmTooltip: 'Layout algorithm',
    layoutDirectionLabel: 'Layout direction',
    layoutDirectionTooltip: 'Layout direction',
    layoutDirectionUnavailableTooltip:
      'Direction does not apply to the Organic layout. Switch to Balanced or Stretched to set it.',
    layoutSpacingLabel: 'Layout spacing',
    layoutSpacingTooltip: 'Layout spacing',
    layoutSpacingUnavailableTooltip:
      'Spacing does not apply to the Organic layout. Switch to Balanced or Stretched to set it.',
    /**
     * Connector style popover, migrated from `Settings → General` so
     * the operator can switch connector shapes live without opening a
     * modal. Mirrors the layout-direction / layout-spacing pattern:
     * one toolbar button + an icon-row popover.
     */
    connectionTypeLabel: 'Connector style',
    connectionTypeTooltip: 'Connector style',
  },
  /**
   * Per-option labels for the three layout popovers. Same shape the
   * Settings modal used before the toolbar took over, kept verbatim
   * so the migration in `graph-view.ts` was a one-line import swap
   * (`SETTINGS_TEXTS.general.layoutAlgorithm.options` →
   * `GRAPH_VIEW_TEXTS.layout.algorithm.options`).
   */
  layout: {
    algorithm: {
      options: {
        'network-simplex': { label: 'Balanced' },
        'longest-path': { label: 'Stretched' },
        force: { label: 'Organic' },
      },
    },
    direction: {
      options: {
        TOP_BOTTOM: { label: 'Top to bottom' },
        BOTTOM_TOP: { label: 'Bottom to top' },
        LEFT_RIGHT: { label: 'Left to right' },
        RIGHT_LEFT: { label: 'Right to left' },
      },
    },
    spacing: {
      options: {
        compact: { label: 'Compact' },
        normal: { label: 'Normal' },
        spacious: { label: 'Spacious' },
      },
    },
    connection: {
      options: {
        segment: { label: 'Orthogonal' },
        straight: { label: 'Straight' },
        bezier: { label: 'Bezier' },
        'adaptive-curve': { label: 'Adaptive curve' },
      },
    },
  },
  panel: {
    resizeLabel: 'Resize panel',
  },
  /**
   * Ephemeral spawn edges + session anchors (live agent spawns,
   * spec/provider-activity.md). The edge is clickable: it opens the
   * conversation dialog for that spawn.
   */
  spawnEdge: {
    aria: 'Open the conversation for this agent spawn',
  },
  /**
   * Edge conversation-count pill (spec/provider-activity.md §Execution
   * stats, per-pair spawn counters). Shown on any edge whose pair has
   * counted spawns; clicking the edge opens the threaded conversation
   * dialog. The label doubles as tooltip and aria text.
   */
  convoCount: {
    label: (n: number): string =>
      n === 1
        ? '1 conversation passed through this edge'
        : `${n} conversations passed through this edge`,
  },
  resetLayoutConfirm: {
    header: 'Re-arrange layout?',
    // Full reset (the whole graph is visible): replaces every saved position.
    message: 'This replaces every saved node position with a fresh automatic layout.',
    // Scoped reset (a curated / filtered subset is visible): re-lays out only
    // the visible nodes and replaces their positions.
    messageVisible: 'This re-arranges the visible nodes and replaces their saved positions.',
    accept: 'Re-arrange',
    reject: 'Cancel',
  },
} as const;
