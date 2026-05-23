/**
 * Kernel-side strings emitted by `kernel/adapters/sqlite/*` and the
 * scan-query parser (`kernel/scan/query.ts`). Same `tx(template, vars)`
 * convention as every other `kernel/i18n/*.texts.ts` peer.
 *
 * These are error messages from the storage adapter and the export-
 * query parser. Some of them surface as user-visible CLI errors via
 * `cli/commands/*` `formatErrorMessage(err)` paths; keeping them in
 * the catalog makes the future translator pipeline trivial.
 */

export const STORAGE_TEXTS = {
  scanPersistInvalidScannedAt:
    'persistScanResult: invalid scannedAt {{value}} (expected non-negative integer ms)',

  findNodesInvalidSortBy:
    'findNodes: invalid sortBy "{{sortBy}}". Allowed: {{allowed}}.',

  findNodesInvalidLimit:
    'findNodes: invalid limit {{value}}; expected positive integer.',

  /**
   * Defensive wrapper around the enum-parser throws (`parseConfidence`
   * / `parseLinkKind` / `parseSeverity`) inside `loadScanResult`. The
   * raw parser message ("Invalid Confidence value 0.5 at scan_links
   * ...") lands at the operator with zero context when the underlying
   * cause is version skew (an older CLI reading a newer DB whose
   * `scan_meta` row was lost to a manual reset, so the version check
   * could not classify the skew). This wrapper preserves the original
   * cause string and points the operator at the recovery path. The
   * happy-path check, comparing `scan_meta.scanned_by_version` to the
   * runtime `VERSION`, lives in `core/sqlite/db-version-check.ts`; this
   * is the last-line defence for the case the meta row was wiped.
   */
  scanLoadDbVersionLoadWrapped:
    'Failed to read scan rows ({{cause}}). The DB may have been written by an incompatible skill-map CLI; try `sm scan` to rewrite it, or delete `.skill-map/` and re-scan.',
} as const;

export const QUERY_TEXTS = {
  exportQueryInvalidToken:
    'invalid token "{{token}}": expected key=value (e.g. kind=skill, has=issues, path=foo/*).',

  exportQueryDuplicateKey:
    'key "{{key}}" appears more than once; combine values with a comma instead (e.g. kind=skill,agent).',

  exportQueryEmptyValues: 'key "{{key}}" has no values.',

  exportQueryUnknownKey:
    'unknown key "{{key}}". Valid keys: kind, has, path.',

  exportQueryEmptyKind:
    'kind="" is not a valid node kind (empty).',

  exportQueryUnsupportedHas:
    'has="{{value}}" is not supported. Valid: {{allowed}}. (findings / summary land at Steps 10 / 11.)',
} as const;
