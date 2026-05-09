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
