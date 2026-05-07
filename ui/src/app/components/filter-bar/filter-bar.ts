import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { ButtonModule } from 'primeng/button';
import { ToggleButtonModule } from 'primeng/togglebutton';

import { FILTER_BAR_TEXTS } from '../../../i18n/filter-bar.texts';
import { STABILITY_LABELS } from '../../../i18n/stabilities.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import {
  ALL_STABILITIES,
  FilterStoreService,
} from '../../../services/filter-store';
import { KindRegistryService } from '../../../services/kind-registry';
import type { TNodeKind, TStability } from '../../../models/node';

@Component({
  selector: 'app-filter-bar',
  imports: [
    FormsModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    MultiSelectModule,
    ButtonModule,
    ToggleButtonModule,
  ],
  templateUrl: './filter-bar.html',
  styleUrl: './filter-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilterBar {
  private readonly store = inject(FilterStoreService);
  private readonly kindRegistry = inject(KindRegistryService);
  private readonly collection = inject(CollectionLoaderService);

  protected readonly texts = FILTER_BAR_TEXTS;

  /**
   * Hide the kind multi-select. The graph view renders a floating
   * `<app-kind-palette>` that exposes the same toggle (sharing the same
   * `FilterStoreService.selectedKinds` signal), so duplicating the
   * dropdown in the bar above is just noise. List view keeps it on
   * (default true).
   */
  readonly showKinds = input<boolean>(true);

  readonly searchText = this.store.searchText;
  readonly selectedKinds = this.store.selectedKinds;
  readonly selectedStabilities = this.store.selectedStabilities;
  readonly hasIssuesOnly = this.store.hasIssuesOnly;
  readonly staleOnly = this.store.staleOnly;
  readonly favoritesOnly = this.store.favoritesOnly;
  readonly isActive = this.store.isActive;

  /**
   * Show the favorites toggle iff the user has any favorite OR the
   * filter is currently active. The OR with `favoritesOnly` keeps the
   * toggle visible after the user un-favorites the last node so they
   * can disable the filter and recover the full list — without it the
   * toggle would vanish and the filter would silently still be on.
   */
  readonly showFavoritesToggle = computed(
    () => this.collection.hasAnyFavorites() || this.store.favoritesOnly(),
  );

  /**
   * Multi-select options derived from the runtime kind registry (Step
   * 14.5.d). Re-derived as a computed signal so a Provider that ships
   * a new kind mid-session (after `KindRegistryService.ingest`) shows
   * up in the dropdown without a component reload.
   */
  readonly kindOptions = computed(() =>
    this.kindRegistry.kinds().map((entry) => ({ label: entry.label, value: entry.name })),
  );
  readonly stabilityOptions = ALL_STABILITIES.map((s) => ({ label: STABILITY_LABELS[s], value: s }));

  onSearchChange(value: string): void {
    this.store.setSearchText(value);
  }

  onKindsChange(kinds: TNodeKind[]): void {
    this.store.setKinds(kinds);
  }

  onStabilitiesChange(values: TStability[]): void {
    this.store.setStabilities(values);
  }

  onIssuesToggle(value: boolean): void {
    this.store.setHasIssuesOnly(value);
  }

  onStaleOnlyToggle(value: boolean): void {
    this.store.setStaleOnly(value);
  }

  onFavoritesOnlyToggle(value: boolean): void {
    this.store.setFavoritesOnly(value);
  }

  reset(): void {
    this.store.reset();
  }
}
