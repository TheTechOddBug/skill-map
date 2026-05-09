import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { APP_TEXTS } from '../i18n/app.texts';
import { THEME_TEXTS } from '../i18n/theme.texts';
import { UPDATE_CHECK_TEXTS } from '../i18n/update-check.texts';
import { CollectionLoaderService } from '../services/collection-loader';
/* DEBUG-SLOTS: remove with debug-slots.css. */
import { DebugSlotsService } from './services/debug-slots';
import { UpdateCheckService } from './services/update-check';
import { FilterUrlSyncService } from '../services/filter-url-sync';
import { ThemeService } from '../services/theme';
import { DemoBanner } from './components/demo-banner/demo-banner';
/* DEBUG-SLOTS: remove with debug-slots.css. */
import { ViewContributionsHost } from './components/view-contributions-host/view-contributions-host';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ButtonModule, TooltipModule, DemoBanner, /* DEBUG-SLOTS */ ViewContributionsHost],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly theme = inject(ThemeService);
  // Boot the URL ↔ filter sync (constructor-driven; the inject() call
  // is sufficient — the service self-wires its router subscription
  // and signal effects on construction).
  private readonly _filterUrlSync = inject(FilterUrlSyncService);
  /* DEBUG-SLOTS: construct on boot so it reads ?debug-slots / localStorage. */
  private readonly _debugSlots = inject(DebugSlotsService);
  protected readonly updateCheck = inject(UpdateCheckService);

  protected readonly texts = APP_TEXTS;
  protected readonly updateChipText = UPDATE_CHECK_TEXTS.available;
  protected readonly updateChipTooltip = computed(() =>
    UPDATE_CHECK_TEXTS.tooltip(this.updateCheck.latest() ?? ''),
  );
  protected readonly updateChipA11y = computed(() =>
    UPDATE_CHECK_TEXTS.a11yLabel(this.updateCheck.latest() ?? ''),
  );
  readonly count = this.loader.count;
  readonly rootLabel = computed(() => {
    const roots = this.loader.scan()?.roots ?? [];
    if (roots.length === 0) return '';
    const trimmed = roots[0].replace(/[\\/]+$/, '');
    if (!trimmed || trimmed === '.') return '';
    const segments = trimmed.split(/[\\/]/);
    return segments[segments.length - 1] ?? '';
  });
  readonly themeMode = this.theme.mode;
  readonly markSrc = computed(() =>
    this.theme.resolved() === 'dark'
      ? 'skill-map-mark-light.svg'
      : 'skill-map-mark-dark.svg',
  );
  readonly themeIcon = computed(() => {
    switch (this.themeMode()) {
      case 'auto':
        return 'pi pi-desktop';
      case 'light':
        return 'pi pi-sun';
      case 'dark':
        return 'pi pi-moon';
    }
  });
  readonly themeLabel = computed(() => {
    switch (this.themeMode()) {
      case 'auto':
        return THEME_TEXTS.toggleToLight;
      case 'light':
        return THEME_TEXTS.toggleToDark;
      case 'dark':
        return THEME_TEXTS.toggleToAuto;
    }
  });
  readonly themeTooltip = computed(() => {
    switch (this.themeMode()) {
      case 'auto':
        return THEME_TEXTS.currentAuto;
      case 'light':
        return THEME_TEXTS.currentLight;
      case 'dark':
        return THEME_TEXTS.currentDark;
    }
  });

  ngOnInit(): void {
    void this.loader.load();
    void this.updateCheck.load();
  }

  toggleTheme(): void {
    this.theme.toggle();
  }
}
