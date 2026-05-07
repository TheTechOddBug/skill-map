/**
 * UI strings for `<sm-inspector-debug-panel>` — surfaces the diagnostic
 * fields catalog curation hides by default (`for.path`, hash diffs,
 * `resolvedAs`, sidecar overlay enums). Toggled via the small `i`
 * button in the inspector header; off by default.
 */
export const INSPECTOR_DEBUG_PANEL_TEXTS = {
  header: 'Debug',
  toggleAriaLabel: 'Toggle debug panel',
  fields: {
    forPath: 'for.path',
    bodyHashStored: 'for.bodyHash (stored)',
    bodyHashLive: 'node.bodyHash (live)',
    frontmatterHashStored: 'for.frontmatterHash (stored)',
    frontmatterHashLive: 'node.frontmatterHash (live)',
    resolvedProvider: 'for.resolvedAs.provider',
    resolvedKind: 'for.resolvedAs.kind',
    sidecarStatus: 'sidecar.status',
    sidecarPresent: 'sidecar.present',
  },
  diffMarker: '!=',
} as const;
