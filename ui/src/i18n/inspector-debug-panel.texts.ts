/**
 * UI strings for `<sm-inspector-debug-panel>`, surfaces the diagnostic
 * fields catalog curation hides by default (`for.path`, hash diffs,
 * `resolvedAs`, sidecar overlay enums). Toggled via the small `i`
 * button in the inspector header; off by default.
 *
 * Refinement (2026-05-07): the panel always renders the full row set
 * when toggled on. Rows whose source is missing show `(absent)`; the
 * `resolvedAs.*` rows use `(not set)` instead because `resolvedAs` is
 * opt-in and missing it is the common case (not a bug).
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
  /** Marker for rows whose source value is absent (no sidecar / null). */
  absentMarker: '(absent)',
  /** Marker for `resolvedAs.*` rows, opt-in, so absent is the default. */
  notSetMarker: '(not set)',
} as const;
