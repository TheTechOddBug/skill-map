import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { TooltipModule } from 'primeng/tooltip';

import { LINK_KIND_PALETTE_TEXTS } from '../../../i18n/link-kind-palette.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { ALL_LINK_KINDS, FilterStoreService } from '../../../services/filter-store';
import { ProviderRegistryService } from '../../../services/provider-registry';
import { ProjectInfoService } from '../../services/project-info';
import { UsageTrackerService } from '../../services/usage-tracker';
import type { TLinkKindApi } from '../../../models/api';

/**
 * One palette entry per spec link kind. Either `icon` (PrimeIcons
 * class string, rendered as `<i>`) OR `text` (literal character,
 * rendered as a styled span). Mutually exclusive at the template
 * level. The choice per kind is intentional: kinds that surface from
 * a literal markdown glyph (`/`, `@`, the backtick) carry that exact
 * character so
 * the operator recognises the source syntax instantly; kinds that
 * live in `[text](path)` markdown (`references`) use a representative
 * PrimeIcon because their source has no single-glyph signature.
 *
 * The `invokes` glyph is the one that is NOT fixed: the invocation
 * syntax is lens-dependent (`/skill` on claude / antigravity, `$skill`
 * on codex), so its `text` + tooltip are resolved per active lens from
 * the Provider's `invocationSigil` (see the `entries` computed). The
 * catalog carries `/` as the static fallback.
 */
interface ILinkKindEntry {
  readonly kind: TLinkKindApi;
  readonly label: string;
  readonly tooltip: string;
  readonly icon?: string;
  readonly text?: string;
}

/**
 * Glyph the `invokes` entry falls back to when the active lens declares
 * no `invocationSigil` (or the registry has not loaded yet). Historically
 * the palette hardcoded `/`; under a lens with no `/`/`$` invocation
 * channel (`agent-skills`) there are no `invokes` edges anyway, so the
 * fallback is never actually painted.
 */
const DEFAULT_INVOCATION_SIGIL = '/';

const ENTRY_CATALOG: readonly ILinkKindEntry[] = [
  {
    kind: 'invokes',
    label: LINK_KIND_PALETTE_TEXTS.kinds.invokes,
    tooltip: LINK_KIND_PALETTE_TEXTS.tooltips.invokes(DEFAULT_INVOCATION_SIGIL),
    text: DEFAULT_INVOCATION_SIGIL,
  },
  {
    kind: 'references',
    label: LINK_KIND_PALETTE_TEXTS.kinds.references,
    tooltip: LINK_KIND_PALETTE_TEXTS.tooltips.references,
    icon: 'pi pi-link',
  },
  {
    kind: 'points',
    label: LINK_KIND_PALETTE_TEXTS.kinds.points,
    tooltip: LINK_KIND_PALETTE_TEXTS.tooltips.points,
    text: '`',
  },
  {
    kind: 'mentions',
    label: LINK_KIND_PALETTE_TEXTS.kinds.mentions,
    tooltip: LINK_KIND_PALETTE_TEXTS.tooltips.mentions,
    text: '@',
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
 *   - Icon-only chassis with tooltip (the closed catalog of 5 link
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
  private readonly providerRegistry = inject(ProviderRegistryService);
  private readonly projectInfo = inject(ProjectInfoService);
  private readonly usageTracker = inject(UsageTrackerService);

  protected readonly texts = LINK_KIND_PALETTE_TEXTS;

  /**
   * Invocation glyph for the active lens, joined from the lens id
   * (`ProjectInfoService.activeProvider`) against the Provider's
   * `invocationSigil` in the registry. `/` on claude / antigravity,
   * `$` on codex; falls back to `DEFAULT_INVOCATION_SIGIL` when the
   * active lens declares none or the registry has not loaded.
   */
  private readonly invocationSigil = computed<string>(() => {
    const active = this.projectInfo.activeProvider();
    if (!active) return DEFAULT_INVOCATION_SIGIL;
    return this.providerRegistry.lookup(active)?.invocationSigil ?? DEFAULT_INVOCATION_SIGIL;
  });

  /** Per-kind link counts derived from `scan().links`. Drives which buttons
   *  paint (kinds present in the project). NOT scoped to the node-curation:
   *  edge-kind visibility is orthogonal to which nodes are on the map, and
   *  `link.target` is not always a resolved node path, so intersecting it
   *  with the curated set wrongly dropped kinds. */
  private readonly counts = computed<ReadonlyMap<TLinkKindApi, number>>(() => {
    const scan = this.loader.scan();
    const counts = new Map<TLinkKindApi, number>();
    if (!scan) return counts;
    for (const link of scan.links) {
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
    const sigil = this.invocationSigil();
    return ENTRY_CATALOG.filter(
      (e) => (counts.get(e.kind) ?? 0) > 0 || explicitlyActive.has(e.kind),
    ).map((e) => (e.kind === 'invokes' ? this.withInvocationSigil(e, sigil) : e));
  });

  /**
   * Repaint the `invokes` entry's glyph + tooltip for the active lens's
   * invocation sigil. Returns the entry untouched when the sigil already
   * matches the catalog default, so non-codex lenses reuse the static
   * object (no needless allocation).
   */
  private withInvocationSigil(entry: ILinkKindEntry, sigil: string): ILinkKindEntry {
    if (sigil === DEFAULT_INVOCATION_SIGIL) return entry;
    return { ...entry, text: sigil, tooltip: this.texts.tooltips.invokes(sigil) };
  }

  constructor() {
    // Drop any whitelist entry whose kind just emptied in the data.
    // Without this, the button disappears (count = 0 hides the row)
    // and `selectedLinkKinds` would carry an unreachable kind forever,
    // filtering the canvas down to zero edges. The effect runs only
    // when the per-kind count map changes.
    effect(() => {
      const counts = this.counts();
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
    // The universe handed to the store is the SAME set the palette paints
    // toggles for (kinds with links in the loaded scan, plus any kind the
    // operator still has whitelisted). Passing the spec-fixed catalog
    // instead left absent kinds inside the whitelist, so the toggles never
    // reached the "all off" state and the filter bounced back to "every
    // kind visible" on the click that should have hidden the last one.
    const universe = this.entries().map((e) => e.kind);
    // Usage analytics (opt-in, default OFF): the edge-filter gesture rides
    // `ui.filter` with the closed-union link kind.
    this.usageTracker.trackFilter('link', kind);
    this.filters.toggleLinkKind(kind, universe);
  }
}
