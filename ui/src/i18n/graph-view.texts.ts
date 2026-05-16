/** UI strings for the GraphView. */
export const GRAPH_VIEW_TEXTS = {
  loading: 'Loading collection',
  errorTitle: 'Failed to load',
  emptyTitle: 'No nodes match',
  emptyDesc: 'Adjust or reset the filters above.',
  a11y: {
    toolbar: 'Graph controls',
    panel: 'Selected node details',
  },
  toolbar: {
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fitToScreen: 'Fit to screen',
    resetLayoutLabel: 'Reset layout',
    resetLayoutTooltip: 'Reset layout (re-run auto layout, clear saved positions)',
    /**
     * Inline graph-layout popovers anchored to the bottom toolbar.
     * The popovers are the only surface that exposes these knobs,
     * Settings → General used to mirror them but was retired once
     * the toolbar shipped (the user can live-tinker without opening
     * a modal). Labels here drive both the button `aria-label` /
     * tooltip and the popover items.
     */
    layoutAlgorithmLabel: 'Layout algorithm',
    layoutAlgorithmTooltip: 'Layout algorithm (balanced, stretched or organic)',
    layoutDirectionLabel: 'Layout direction',
    layoutDirectionTooltip: 'Layout direction (TB, BT, LR, RL)',
    layoutDirectionUnavailableTooltip:
      'Direction does not apply to the Organic layout. Switch to Balanced or Stretched to set it.',
    layoutSpacingLabel: 'Layout spacing',
    layoutSpacingTooltip: 'Layout spacing (compact, normal, spacious)',
    layoutSpacingUnavailableTooltip:
      'Spacing does not apply to the Organic layout. Switch to Balanced or Stretched to set it.',
    /**
     * Edge style popover, migrated from `Settings → General` so the
     * operator can switch connector shapes live without opening a
     * modal. Mirrors the layout-direction / layout-spacing pattern:
     * one toolbar button + an icon-row popover.
     */
    connectionTypeLabel: 'Edge style',
    connectionTypeTooltip: 'Edge style (orthogonal, straight, bezier or adaptive curve)',
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
  resetLayoutConfirm: {
    header: 'Reset layout?',
    message: 'Reset all node positions to the automatic layout. This cannot be undone.',
    accept: 'Reset',
    reject: 'Cancel',
  },
} as const;
