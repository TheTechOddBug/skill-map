/**
 * Drift detection for sidecar `.sm` files (Step 9.6.2).
 *
 * Compares the hashes captured the last time a sidecar was bumped
 * (`for.bodyHash` / `for.frontmatterHash` from the parsed sidecar)
 * against the live node hashes computed during the current scan.
 *
 * Returns one of four states:
 *
 *   - `'fresh'`             — both hashes match; sidecar is up to date.
 *   - `'stale-body'`        — body changed since last bump.
 *   - `'stale-frontmatter'` — frontmatter changed since last bump.
 *   - `'stale-both'`        — both changed since last bump.
 *
 * Stale state is **derived**, never stored persistently — pure
 * function over hashes already on the node. The `scan_nodes.sidecar_status`
 * column caches the result for fast queries but the kernel re-derives
 * it on every scan.
 */

import type { SidecarStatus } from '../types.js';

export function computeDriftStatus(args: {
  storedBodyHash: string;
  storedFrontmatterHash: string;
  liveBodyHash: string;
  liveFrontmatterHash: string;
}): SidecarStatus {
  const bodyDrift = args.storedBodyHash !== args.liveBodyHash;
  const fmDrift = args.storedFrontmatterHash !== args.liveFrontmatterHash;
  if (bodyDrift && fmDrift) return 'stale-both';
  if (bodyDrift) return 'stale-body';
  if (fmDrift) return 'stale-frontmatter';
  return 'fresh';
}
