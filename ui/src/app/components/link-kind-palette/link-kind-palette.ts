import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { TooltipModule } from 'primeng/tooltip';

import { LINK_KIND_PALETTE_TEXTS } from '../../../i18n/link-kind-palette.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { ALL_LINK_KINDS, FilterStoreService } from '../../../services/filter-store';
import { MapVisibilityService } from '../../../services/map-visibility';
import type { TLinkKindApi } from '../../../models/api';

/**
 * One palette entry per spec link kind. Either `icon` (PrimeIcons
 * class string, rendered as `<i>`) OR `text` (literal character,
 * rendered as a styled span). Mutually exclusive at the template
 * level. The choice per kind is intentional: kinds that surface from
 * a literal markdown glyph (`/`, `@`) carry that exact character so
 * the operator recognises the source syntax instantly; kinds that
 * live in sidecar YAML (`supersedes`) or in `[text](path)` markdown
 * (`references`) use a representative PrimeIcon because their
 * source has no single-glyph signature.
 */
interface ILinkKindEntry {
  readonly kind: TLinkKindApi;
  readonly label: string;
  readonly tooltip: string;
  readonly icon?: string;
  readonly text?: string;
}

const ENTRY_CATALOG: readonly ILinkKindEntry[] = [
  {
    kind: 'invokes',
    label: LINK_KIND_PALETTE_TEXTS.kinds.invokes,
    tooltip: LINK_KIND_PALETTE_TEXTS.tooltips.invokes,
    text: '/',
  },
  {
    kind: 'references',
    label: LINK_KIND_PALETTE_TEXTS.kinds.references,
    tooltip: LINK_KIND_PALETTE_TEXTS.tooltips.references,
    icon: 'pi pi-link',
  },
  {
    kind: 'mentions',
    label: LINK_KIND_PALETTE_TEXTS.kinds.mentions,
    tooltip: LINK_KIND_PALETTE_TEXTS.tooltips.mentions,
    text: '@',
  },
  {
    kind: 'supersedes',
    label: LINK_KIND_PALETTE_TEXTS.kinds.supersedes,
    tooltip: LINK_KIND_PALETTE_TEXTS.tooltips.supersedes,
    icon: 'pi pi-angle-double-right',
  },
];

// Self-check: every catalog entry must be in the spec-fixed universe;
// trips immediately during development if a manual edit drifts the
// catalog away from `ALL_LINK_KINDS`.
for (const e of ENTRY_CATALOG) {
  if (!ALL_LINK_KINDS.includes(e.kind)) {
    throw new Error(`link-kind-palette: unknown link kind "${e.kind}"`);
  }
}

/**
 * Floating palette for toggling edge-kind visibility on the graph
 * view. Sibling of `<sm-kind-palette>` / `<sm-severity-palette>`,
 * stacks last in the `.graph__filter-stack` wrapper.
 *
 * Differences vs the node-kind palette:
 *   - No counter, the operator cares about visibility, not totals.
 *   - Icon-only chassis with tooltip (the closed catalog of 4 link
 *     kinds is easy to memorise; counts would clutter without adding
 *     information).
 *
 * Per-entry visibility: a button only renders if the loaded scan has
 * at least one link of that kind. Kinds whose count drops to zero
 * disappear from the toolbar (no zero-row dead toggle); if the kind
 * was the currently active whitelist value, the button stays so the
 * operator can still turn the filter off (mirror of the
 * favourites / severity escape hatch). The whole palette hides when
 * every kind would be filtered out.
 */
@Component({
  selector: 'sm-link-kind-palette',
  imports: [FormsModule, ToggleButtonModule, TooltipModule],
  templateUrl: './link-kind-palette.html',
  styleUrl: './link-kind-palette.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkKindPalette {
  private readonly loader = inject(CollectionLoaderService);
  private readonly filters = inject(FilterStoreService);
  private readonly mapVisibility = inject(MapVisibilityService);

  protected readonly texts = LINK_KIND_PALETTE_TEXTS;

  /** Raw per-kind link counts over the whole scan. Drives the auto-clear
   *  effect: only a kind that truly vanished from the DATA is dropped from
   *  the whitelist, not one merely hidden by the files-rail curation. */
  private readonly rawCounts = computed<ReadonlyMap<TLinkKindApi, number>>(() => {
    const scan = this.loader.scan();
    const counts = new Map<TLinkKindApi, number>();
    if (!scan) return counts;
    for (const link of scan.links) counts.set(link.kind, (counts.get(link.kind) ?? 0) + 1);
    return counts;
  });

  /** Per-kind link counts within the map's curated scope (both endpoints in
   *  scope), so curating from the files rail reshapes which buttons paint. */
  private readonly counts = computed<ReadonlyMap<TLinkKindApi, number>>(() => {
    const scan = this.loader.scan();
    const counts = new Map<TLinkKindApi, number>();
    if (!scan) return counts;
    for (const link of scan.links) {
      if (!this.mapVisibility.inScope(link.source) || !this.mapVisibility.inScope(link.target)) {
        continue;
      }
      counts.set(link.kind, (counts.get(link.kind) ?? 0) + 1);
    }
    return counts;
  });

  /**
   * Catalog entries the toolbar should paint right now. Filters out
   * kinds with no links in the loaded scan, but keeps a kind whose
   * count is zero IF the operator currently has it on the whitelist
   * (otherwise turning the filter off would mean editing the URL by
   * hand). Mirrors `<sm-kind-palette>`'s "hide unless active" rule.
   */
  protected readonly entries = computed<readonly ILinkKindEntry[]>(() => {
    const counts = this.counts();
    const selected = this.filters.selectedLinkKinds();
    const explicitlyActive = new Set<TLinkKindApi>(selected);
    return ENTRY_CATALOG.filter(
      (e) => (counts.get(e.kind) ?? 0) > 0 || explicitlyActive.has(e.kind),
    );
  });

  constructor() {
    // Drop any whitelist entry whose kind just emptied in the data.
    // Without this, the button disappears (count = 0 hides the row)
    // and `selectedLinkKinds` would carry an unreachable kind forever,
    // filtering the canvas down to zero edges. The effect runs only
    // when the per-kind count map changes.
    effect(() => {
      const counts = this.rawCounts();
      const selected = this.filters.selectedLinkKinds();
      const next = selected.filter((k) => (counts.get(k) ?? 0) > 0);
      if (next.length !== selected.length) {
        this.filters.setLinkKinds(next);
      }
    });
  }

  isActive(kind: TLinkKindApi): boolean {
    return this.filters.isLinkKindActive(kind);
  }

  toggle(kind: TLinkKindApi): void {
    this.filters.toggleLinkKind(kind);
  }
}
