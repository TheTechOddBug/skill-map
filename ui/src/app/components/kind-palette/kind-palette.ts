import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { TooltipModule } from 'primeng/tooltip';

import { KIND_PALETTE_TEXTS } from '../../../i18n/kind-palette.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { IssuePathsService } from '../../../services/issue-paths';
import { KindRegistryService } from '../../../services/kind-registry';
import { UsageTrackerService } from '../../services/usage-tracker';
import type { TNodeKind } from '../../../models/node';
import { KindIcon } from '../kind-icon/kind-icon';

interface IKindEntry {
  readonly kind: TNodeKind;
  readonly label: string;
  readonly count: number;
}

/**
 * Floating top-left palette for toggling node-kind visibility on the graph
 * view. Mirrors the layout of the call-center example's `flow-palette` in
 * Foblex/f-flow but adapted to PrimeIcons + the `--sm-kind-*` accent vars.
 *
 * Toggling delegates to `FilterStoreService.toggleKind`, so the palette
 * stays in sync with anything else reading the same kind-filter signal.
 *
 * Counts track the RENDERED MAP, the current branch (`loader.nodes()`),
 * so they grow / shrink with the folder selection and the active facets
 * instead of reflecting the whole scanned corpus. A kind chip shows iff
 * the branch currently renders at least one node of that kind.
 *
 * Step 14.5.d: the kind catalog comes from `KindRegistryService` (fed by
 * the BFF's `kindRegistry` envelope field) instead of a hardcoded enum.
 * A user-plugin Provider that declares a new kind shows up automatically.
 */
@Component({
  selector: 'sm-kind-palette',
  imports: [FormsModule, ToggleButtonModule, TooltipModule, KindIcon],
  templateUrl: './kind-palette.html',
  styleUrl: './kind-palette.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KindPalette {
  private readonly loader = inject(CollectionLoaderService);
  protected readonly filters = inject(FilterStoreService);
  private readonly kindRegistry = inject(KindRegistryService);
  private readonly issuePaths = inject(IssuePathsService);
  private readonly usageTracker = inject(UsageTrackerService);

  protected readonly texts = KIND_PALETTE_TEXTS;

  protected readonly entries = computed<readonly IKindEntry[]>(() => {
    // Everything is scoped to the RENDERED MAP, the current branch
    // (`loader.nodes()`). PRESENCE (branch, unfiltered) decides which kind
    // rows show and the toggle universe, so a kind that is on the map keeps
    // its toggle reachable even while another facet hides its nodes. The
    // DISPLAYED count is the branch filtered by the active search + facets,
    // EXCLUDING this palette's own kind facet (so toggling a kind off never
    // zeroes its own number) and honouring `searchAffectsMap` exactly the
    // way `<sm-graph-view>`'s `visibleNodes` does, so the number always
    // matches what the canvas renders.
    const branch = this.loader.nodes();
    const presence = new Map<string, number>();
    for (const n of branch) {
      presence.set(n.kind, (presence.get(n.kind) ?? 0) + 1);
    }
    const displayed = new Map<string, number>();
    const filtered = this.filters.apply(branch, this.issuePaths.bySeverity(), {
      includeKinds: false,
      includeSearch: this.filters.searchAffectsMap(),
    });
    for (const n of filtered) {
      displayed.set(n.kind, (displayed.get(n.kind) ?? 0) + 1);
    }
    // Hide rows whose branch presence is zero, the palette only surfaces
    // kinds the map actually renders nodes for. Kinds declared by enabled
    // Providers but absent from the current branch stay out of the way. The
    // toggle for a hidden kind would be a no-op anyway: visibility does not
    // bring nodes into being.
    return this.kindRegistry.kinds()
      .map((entry) => ({
        kind: entry.name,
        label: entry.label,
        count: displayed.get(entry.name) ?? 0,
      }))
      .filter((entry) => (presence.get(entry.kind) ?? 0) > 0);
  });

  /**
   * Favorites filter entry. Sits below the kind buttons in the palette
   * as a peer toggle (same compact pill chassis), but tied to the
   * `favoritesOnly` signal instead of `selectedKinds`. Visibility rule:
   * render when the user has any favorite OR when the filter is currently
   * active (so they can disable it after un-favoriting the last node).
   */
  protected readonly favoritesCount = computed(
    () => this.loader.nodes().filter((n) => n.isFavorite === true).length,
  );

  protected readonly showFavorites = computed(
    () => this.loader.hasAnyFavorites() || this.filters.favoritesOnly(),
  );

  protected readonly favoritesActive = computed(() => this.filters.favoritesOnly());

  isActive(kind: TNodeKind): boolean {
    return this.filters.isKindActive(kind);
  }

  toggle(kind: TNodeKind): void {
    // The universe passed to the store is the SAME set of kinds the
    // palette renders toggles for (kinds with > 0 nodes in the loaded
    // set). Without this, the store would default to the full registry,
    // and a registry kind that the palette intentionally hid (count 0)
    // would survive in the whitelist after the user toggled off every
    // visible kind, filtering down to zero matches.
    const universe = this.entries().map((e) => e.kind);
    // Usage analytics (opt-in, default OFF): the gesture rides `ui.filter`
    // with the kind name (third-party kinds collapse in the tracker).
    this.usageTracker.trackFilter('kind', kind);
    this.filters.toggleKind(kind, universe);
  }

  toggleFavoritesOnly(): void {
    this.usageTracker.trackFilter('favorites');
    this.filters.setFavoritesOnly(!this.filters.favoritesOnly());
  }
}
