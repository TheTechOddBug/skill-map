/**
 * Shared PrimeNG `severity` mappings reused by multiple panels:
 *
 *   - `STABILITY_SEVERITY`, annotations panel, inspector view, list view
 *     (renders the stability tag chip).
 *   - `KIND_SEVERITY`, linked-nodes panel (renders the per-link kind tag).
 *   - `CONFIDENCE_SEVERITY`, linked-nodes panel (renders the per-link
 *     confidence tag).
 *
 * Hoisted out of the consumer files so a new severity-aware surface
 * imports one record instead of redeclaring the same map locally.
 * Surfaces that need additional sentinel keys (e.g. list-view's `'—'`
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

export const CONFIDENCE_SEVERITY: Record<TLinkConfidenceApi, 'success' | 'info' | 'warn'> = {
  high: 'success',
  medium: 'info',
  low: 'warn',
};
