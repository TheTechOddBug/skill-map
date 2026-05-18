import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { TooltipModule } from 'primeng/tooltip';

import { KIND_PALETTE_TEXTS } from '../../../i18n/kind-palette.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { KindRegistryService } from '../../../services/kind-registry';
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
 * and the existing `<sm-filter-bar>` `kinds` multi-select stay in sync
 * through the same signal, pick whichever the user prefers.
 *
 * Counts are total loaded nodes per kind (not "visible", those would
 * shrink to 0 when this palette deactivates a kind, which is confusing).
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
  private readonly filters = inject(FilterStoreService);
  private readonly kindRegistry = inject(KindRegistryService);

  protected readonly texts = KIND_PALETTE_TEXTS;

  protected readonly entries = computed<readonly IKindEntry[]>(() => {
    const counts = new Map<string, number>();
    for (const n of this.loader.nodes()) {
      counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    }
    // Hide rows whose count is zero, the palette only surfaces kinds
    // the current scan actually emitted nodes for. Kinds declared by
    // enabled Providers but not present in the loaded set stay out of
    // the way (e.g. `mcp` when no skill references an MCP server,
    // `command` in a scope that has only agents). The toggle for a
    // hidden kind would be a no-op anyway: turning visibility on or
    // off does not bring nodes into existence.
    return this.kindRegistry.kinds()
      .map((entry) => ({
        kind: entry.name,
        label: entry.label,
        count: counts.get(entry.name) ?? 0,
      }))
      .filter((entry) => entry.count > 0);
  });

  /**
   * Favorites filter entry. Sits below the kind buttons in the palette
   * as a peer toggle (same compact pill chassis), but tied to the
   * `favoritesOnly` signal instead of `selectedKinds`. Visibility
   * mirrors the filter-bar rule: render when the user has any favorite
   * OR when the filter is currently active (so they can disable it
   * after un-favoriting the last node).
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
    this.filters.toggleKind(kind);
  }

  toggleFavoritesOnly(): void {
    this.filters.setFavoritesOnly(!this.filters.favoritesOnly());
  }
}
