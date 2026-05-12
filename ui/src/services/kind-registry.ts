/**
 * `KindRegistryService` — runtime catalog of node kinds the UI knows
 * how to render (Step 14.5.d).
 *
 * Replaces the pre-14.5.d `TNodeKind = 'skill' | 'agent' | …` closed
 * union and the static `--sm-kind-*` CSS vars in `styles.css`. The
 * registry is fed by every payload-bearing BFF envelope (see
 * `spec/schemas/api/rest-envelope.schema.json#/properties/kindRegistry`):
 * the data source ingests the field on every fetch, this service stores
 * it as a signal-readable map, and components / views read kind
 * presentation through `lookup()` / `labelOf()` / `colorOf()` /
 * `iconOf()` instead of switching on hardcoded literals.
 *
 * Cross-provider kind sharing: when two Providers declare the same
 * kind name (e.g. Claude `agent` and Gemini `agent`), the wire entry
 * carries both contributions under `providers`. The service flattens
 * the primary Provider's visuals onto each registered entry so
 * existing single-arg lookups (`labelOf('agent')`, `colorOf('agent')`)
 * keep working unchanged. The new `providersOf(name)` accessor
 * returns the full per-Provider map for surfaces that need
 * Provider-specific painting (e.g. node-card reading `node.provider`
 * to pick the matching color when several Providers share a kind).
 *
 * `applyCssVars()` injects `--sm-kind-<id>`, `--sm-kind-<id>-bg`, and
 * `--sm-kind-<id>-fg` (light + dark variants) onto the document via a
 * managed `<style id="sm-kind-vars">` tag. The vars derive from the
 * **primary** Provider's color — per-Provider painting picks colors
 * directly from `providersOf()` rather than inventing new CSS vars
 * per `(kind, provider)` pair.
 *
 * `ingest()` is idempotent — repeated calls with the same payload are
 * cheap (signal equality short-circuits to no-op).
 */

import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

import type { IKindRegistryEntryApi, IKindRegistryProviderUiApi } from '../models/api';
import { deriveTints } from './kind-tints';

/**
 * Service-level entry shape. Extends the wire entry with the kind
 * `name` (the key in the parent map) and flattens the primary
 * Provider's visuals onto the top level so existing single-arg
 * accessors (`labelOf`, `colorOf`, `iconOf`) keep working without
 * call-site changes.
 */
export interface IKindRegistryEntry {
  /** Kind name. Duplicated here so iterating `kinds()` keeps insertion order without a separate Map. */
  name: string;
  /** Provider whose visuals drive the primary CSS var. */
  primaryProviderId: string;
  /** Every Provider that contributed visuals for this kind name. */
  providers: Record<string, IKindRegistryProviderUiApi>;
  // --- Flattened from `providers[primaryProviderId]` for ergonomic single-arg lookups. ---
  label: string;
  color: string;
  colorDark?: string;
  emoji?: string;
  icon?: IKindRegistryProviderUiApi['icon'];
}

@Injectable({ providedIn: 'root' })
export class KindRegistryService {
  /**
   * Injected `Document` token (not the global). Keeps the service
   * testable (specs can swap a JSDOM doc) and SSR-safe (in a server
   * context Angular provides a no-op or platform-server document).
   */
  private readonly doc = inject(DOCUMENT);

  private readonly _entries = signal<readonly IKindRegistryEntry[]>([]);

  /** Ordered list of registered kinds. Insertion order = manifest declaration order = visual order. */
  readonly kinds = this._entries.asReadonly();

  /**
   * Quick lookup map. Computed from `_entries` so consumers can branch
   * `lookup(kindName) === undefined` without re-walking the array.
   */
  private readonly index = computed(() => {
    const map = new Map<string, IKindRegistryEntry>();
    for (const entry of this._entries()) {
      map.set(entry.name, entry);
    }
    return map;
  });

  /**
   * Replace the registry with the catalog from the latest envelope.
   * Insertion order in the input object is preserved (V8 preserves
   * own-string-key order). No-op when the new payload is structurally
   * equal to the current one.
   */
  ingest(payload: Record<string, IKindRegistryEntryApi> | null | undefined): void {
    if (!payload) return;
    const entries: IKindRegistryEntry[] = [];
    for (const [name, raw] of Object.entries(payload)) {
      const primary = raw.providers[raw.primaryProviderId];
      if (!primary) continue; // malformed entry; skip rather than crash
      const entry: IKindRegistryEntry = {
        name,
        primaryProviderId: raw.primaryProviderId,
        providers: raw.providers,
        label: primary.label,
        color: primary.color,
      };
      if (primary.colorDark !== undefined) entry.colorDark = primary.colorDark;
      if (primary.emoji !== undefined) entry.emoji = primary.emoji;
      if (primary.icon !== undefined) entry.icon = primary.icon;
      entries.push(entry);
    }
    const current = this._entries();
    if (sameRegistry(current, entries)) return;
    this._entries.set(entries);
    this.applyCssVars();
  }

  lookup(name: string): IKindRegistryEntry | undefined {
    return this.index().get(name);
  }

  labelOf(name: string): string {
    return this.lookup(name)?.label ?? name;
  }

  /**
   * Return the base color for a kind in the requested theme. Falls back
   * to a neutral gray when the kind isn't in the registry yet (first
   * paint while the boot fetch is in flight).
   */
  colorOf(name: string, theme: 'light' | 'dark' = 'light'): string {
    const entry = this.lookup(name);
    if (!entry) return '#9ca3af';
    if (theme === 'dark') return entry.colorDark ?? entry.color;
    return entry.color;
  }

  iconOf(name: string): IKindRegistryEntry['icon'] | undefined {
    return this.lookup(name)?.icon;
  }

  emojiOf(name: string): string | undefined {
    return this.lookup(name)?.emoji;
  }

  /**
   * Return the per-Provider visual contributions for a kind. Used by
   * surfaces that paint per-Provider (e.g. node-card picking the
   * right color when Claude and Gemini both declared `agent`):
   *
   *   const ui = registry.providersOf('agent')?.[node.provider];
   *   if (ui) cardStyle.background = ui.color;
   *
   * Returns `undefined` for unknown kinds. The map is non-empty when
   * the kind is registered (every entry carries at least the primary
   * Provider's contribution).
   */
  providersOf(name: string): Record<string, IKindRegistryProviderUiApi> | undefined {
    return this.lookup(name)?.providers;
  }

  /**
   * Inject `--sm-kind-<id>`, `--sm-kind-<id>-bg`, `--sm-kind-<id>-fg`
   * for light AND dark themes via a managed `<style id="sm-kind-vars">`
   * tag in `<head>`. Vars derive from the *primary* Provider's color —
   * per-Provider painting reads `providersOf()` directly rather than
   * inventing new vars per `(kind, provider)` pair.
   *
   * Bg / fg derived from the base color via `deriveTints`
   * (`kind-tints.ts`).
   *
   * Safe in SSR / tests: bails out when the injected `Document` has no
   * `<head>` (platform-server doc, JSDOM stub without head).
   */
  applyCssVars(): void {
    if (!this.doc.head) return;
    const styleEl = ensureStyleElement(this.doc);
    const lightDecls: string[] = [];
    const darkDecls: string[] = [];
    for (const entry of this._entries()) {
      const lightTints = deriveTints(entry.color, 'light');
      const darkBase = entry.colorDark ?? entry.color;
      const darkTints = deriveTints(darkBase, 'dark');
      lightDecls.push(`--sm-kind-${entry.name}: ${entry.color};`);
      lightDecls.push(`--sm-kind-${entry.name}-bg: ${lightTints.bg};`);
      lightDecls.push(`--sm-kind-${entry.name}-fg: ${lightTints.fg};`);
      darkDecls.push(`--sm-kind-${entry.name}: ${darkBase};`);
      darkDecls.push(`--sm-kind-${entry.name}-bg: ${darkTints.bg};`);
      darkDecls.push(`--sm-kind-${entry.name}-fg: ${darkTints.fg};`);
    }
    styleEl.textContent =
      `:root { ${lightDecls.join(' ')} } .app-dark { ${darkDecls.join(' ')} }`;
  }
}

const STYLE_EL_ID = 'sm-kind-vars';

function ensureStyleElement(doc: Document): HTMLStyleElement {
  let el = doc.getElementById(STYLE_EL_ID) as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement('style');
    el.id = STYLE_EL_ID;
    doc.head.appendChild(el);
  }
  return el;
}

function sameRegistry(a: readonly IKindRegistryEntry[], b: readonly IKindRegistryEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.name !== y.name) return false;
    if (x.primaryProviderId !== y.primaryProviderId) return false;
    // Stringify is fine here — entries are tiny (≤ a handful of providers, ≤ 6 fields each).
    if (JSON.stringify(x.providers) !== JSON.stringify(y.providers)) return false;
  }
  return true;
}
