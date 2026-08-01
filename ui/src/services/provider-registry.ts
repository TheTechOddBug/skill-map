/**
 * `ProviderRegistryService`, runtime catalog of the Providers registered
 * in the current scope. Sibling of `KindRegistryService`.
 *
 * Fed by the `providerRegistry` field embedded in every payload-bearing
 * REST envelope (see
 * `spec/schemas/api/rest-envelope.schema.json#/properties/providerRegistry`):
 * the data source ingests the field on every fetch, this service stores
 * it as a signal-readable ordered list, and the topbar lens chip, the
 * lens-switcher dropdown, and the per-node provider chip read Provider
 * identity through it instead of a hardcoded dictionary.
 *
 * Replaces the former static `provider-ui.ts` dictionary. The day a user
 * plugin contributes its own Provider, its identity flows through here
 * automatically, no UI edit required.
 *
 * Unlike kind visuals (normalised across Providers so every `agent`
 * paints the same), Provider visuals are deliberately distinct: the chip
 * tells the user at a glance which platform a node came from.
 */

import { Injectable, computed, signal } from '@angular/core';

import type { IProviderRegistryApi, IProviderRegistryEntryApi } from '../models/api';
import { cssColorOrNull } from './css-guard';

/**
 * Render shape consumed by the chip templates (topbar lens chip,
 * per-node provider chip). A subset of the wire entry, the only fields
 * the chips paint.
 */
export interface IProviderUi {
  label: string;
  color: string;
  colorDark?: string;
}

/** Service-level entry: the wire entry plus its Provider id. */
export interface IProviderRegistryEntry extends IProviderRegistryEntryApi {
  id: string;
}

/**
 * Neutral fallback for a Provider id absent from the registry (a stale
 * envelope, or a node whose Provider was unregistered mid-session). Keeps
 * the chip readable rather than blank.
 */
const FALLBACK_COLOR = '#9ca3af';
const FALLBACK_COLOR_DARK = '#6b7280';

@Injectable({ providedIn: 'root' })
export class ProviderRegistryService {
  private readonly _entries = signal<readonly IProviderRegistryEntry[]>([]);

  /** Ordered list of registered Providers (manifest registration order). */
  readonly providers = this._entries.asReadonly();

  private readonly index = computed(() => {
    const map = new Map<string, IProviderRegistryEntry>();
    for (const entry of this._entries()) map.set(entry.id, entry);
    return map;
  });

  /**
   * Replace the registry with the catalog from the latest envelope.
   * Insertion order is preserved (V8 keeps own-string-key order). No-op
   * when the new payload is structurally equal to the current one.
   *
   * Colors are re-validated HERE, at the layer that owns the CSS sink
   * (the chips bind them into `[style.--provider-color]` custom
   * properties), rather than trusting the kernel's AJV manifest gate
   * upstream, mirroring `KindRegistryService`. An invalid value degrades
   * to the neutral fallback instead of dropping the entry, so a broken
   * manifest still renders a readable chip and can never smuggle a
   * `url(...)` beacon into the CSSOM (`context/ui.md` §No outbound
   * requests from author-controlled content).
   */
  ingest(payload: IProviderRegistryApi | null | undefined): void {
    if (!payload) return;
    const entries: IProviderRegistryEntry[] = [];
    for (const [id, raw] of Object.entries(payload)) {
      const entry: IProviderRegistryEntry = {
        ...raw,
        id,
        color: cssColorOrNull(raw.color) ?? FALLBACK_COLOR,
      };
      if (raw.colorDark !== undefined) {
        entry.colorDark = cssColorOrNull(raw.colorDark) ?? FALLBACK_COLOR_DARK;
      }
      entries.push(entry);
    }
    if (sameRegistry(this._entries(), entries)) return;
    this._entries.set(entries);
  }

  lookup(id: string): IProviderRegistryEntry | undefined {
    return this.index().get(id);
  }

  /**
   * Identity for the per-node card chip. Returns `null` when there is no
   * Provider id, or when the Provider is flagged `hideChip` (the
   * universal `markdown` fallback, carried by the majority of nodes, so
   * the chip would be noise). Unknown ids resolve to a neutral gray chip
   * with the raw id as label so a node whose Provider is not in the
   * registry still renders something readable.
   */
  cardChip(providerId: string | null | undefined): IProviderUi | null {
    if (!providerId) return null;
    const entry = this.lookup(providerId);
    if (!entry) return fallbackChip(providerId);
    if (entry.hideChip) return null;
    return toChip(entry);
  }

  /**
   * Identity for the topbar active-lens chip. Unlike the card chip it
   * shows EVERY active Provider, including the `hideChip` fallback,
   * because the user explicitly chose / detected that lens and wants to
   * see which one is active. Returns `null` only when there is no active
   * lens at all.
   */
  lensChip(providerId: string | null | undefined): IProviderUi | null {
    if (!providerId) return null;
    const entry = this.lookup(providerId);
    if (!entry) return fallbackChip(providerId);
    return toChip(entry);
  }
}

function toChip(entry: IProviderRegistryEntry): IProviderUi {
  const chip: IProviderUi = { label: entry.label, color: entry.color };
  if (entry.colorDark !== undefined) chip.colorDark = entry.colorDark;
  return chip;
}

function fallbackChip(providerId: string): IProviderUi {
  return { label: providerId, color: FALLBACK_COLOR, colorDark: FALLBACK_COLOR_DARK };
}

function sameRegistry(
  a: readonly IProviderRegistryEntry[],
  b: readonly IProviderRegistryEntry[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    // Entries are tiny (≤ 6 fields); a stringify compare is cheap and
    // catches label / color / hideChip changes without a field walk.
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
  }
  return true;
}
