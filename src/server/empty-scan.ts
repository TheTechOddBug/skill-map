/**
 * `emptyScanResult()`, the canonical empty `ScanResult` the BFF hands
 * back when the project DB file is absent (never scanned).
 *
 * Mirrors the shape `scans.load()` / `scans.loadMeta()` produce against
 * an empty migrated DB so every read-side surface (`GET /api/scan`, the
 * MCP `skillmap://graph` resource) returns a structurally identical
 * payload on a cold boot as on a populated DB. A real scan overwrites
 * every field on the next run.
 *
 * Shared (not inlined per route) so the DB-absent shape has exactly one
 * definition; a drift between two copies would surface as two different
 * "empty" payloads across the REST and MCP surfaces.
 */

import type { ScanResult } from '../kernel/index.js';

export function emptyScanResult(): ScanResult {
  return {
    schemaVersion: 1,
    scannedAt: Date.now(),
    roots: ['.'],
    providers: [],
    // Surface the design defaults so consumers read the same field shape
    // on cold boot as on populated DBs. 5000 mirrors `scan.maxScan` (the
    // walk ceiling) and 256 mirrors `scan.maxNodes` (the render cap),
    // both from `src/config/defaults.json`.
    scanCeiling: 5000,
    scanTruncated: false,
    maxRenderNodes: 256,
    nodes: [],
    links: [],
    issues: [],
    stats: {
      filesWalked: 0,
      filesSkipped: 0,
      nodesCount: 0,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
}
