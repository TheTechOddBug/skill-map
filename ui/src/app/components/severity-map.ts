/**
 * Shared PrimeNG `severity` mappings reused by multiple panels:
 *
 *   - `STABILITY_SEVERITY`, annotations panel, inspector view, files view
 *     (renders the stability tag chip).
 *   - `KIND_SEVERITY`, linked-nodes panel (renders the per-link kind tag).
 *   - `CONFIDENCE_SEVERITY`, linked-nodes panel (renders the per-link
 *     confidence tag).
 *
 * Hoisted out of the consumer files so a new severity-aware surface
 * imports one record instead of redeclaring the same map locally.
 * Surfaces that need additional sentinel keys (e.g. files-view's `'·'`
 * for missing stability) handle them inline at the call site.
 */

import type { TLinkConfidenceApi, TLinkKindApi } from '../../models/api';
import type { TStability } from '../../models/node';

export type TTagSeverity = 'success' | 'info' | 'warn' | 'danger' | 'secondary';

export const STABILITY_SEVERITY: Record<TStability, 'success' | 'info' | 'warn'> = {
  stable: 'success',
  experimental: 'info',
  deprecated: 'warn',
};

export const KIND_SEVERITY: Record<TLinkKindApi, 'info' | 'success' | 'warn' | 'danger' | 'secondary'> = {
  invokes: 'warn',
  references: 'info',
  mentions: 'secondary',
  supersedes: 'success',
};

/**
 * Bucket a numeric `[0..1]` link confidence into the legacy
 * three-tier label set. Mirrors the kernel-side `ConfidenceTier`
 * thresholds: `>= 0.75` → high, `>= 0.45` → medium, else low. Used
 * by chips and lists where a colour-coded categorical badge reads
 * better than a raw percent. After the Phase 4 migration there is
 * no `Record<>` keyed by string union, the buckets are derived on
 * the fly.
 */
export function confidenceTier(c: TLinkConfidenceApi): 'high' | 'medium' | 'low' {
  if (c >= 0.75) return 'high';
  if (c >= 0.45) return 'medium';
  return 'low';
}

export function confidenceSeverity(c: TLinkConfidenceApi): 'success' | 'info' | 'warn' {
  const tier = confidenceTier(c);
  if (tier === 'high') return 'success';
  if (tier === 'medium') return 'info';
  return 'warn';
}
