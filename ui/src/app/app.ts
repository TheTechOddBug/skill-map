import { ChangeDetectionStrategy, Component, OnInit, computed, inject, isDevMode, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { APP_TEXTS } from '../i18n/app.texts';
import { SETTINGS_TEXTS } from '../i18n/settings.texts';
import { THEME_TEXTS } from '../i18n/theme.texts';
import { UPDATE_CHECK_TEXTS } from '../i18n/update-check.texts';
import { CollectionLoaderService } from '../services/collection-loader';
import { DATA_SOURCE, DataSourceError } from '../services/data-source/data-source.port';
/* DEBUG-SLOTS: remove with debug-slots.css. */
import { DebugSlotsService } from './services/debug-slots';
import { UpdateCheckService } from './services/update-check';
import { FilterUrlSyncService } from '../services/filter-url-sync';
import { ThemeService } from '../services/theme';
import { DemoBanner } from './components/demo-banner/demo-banner';
import { SettingsModal } from './components/settings-modal/settings-modal';
/* DEBUG-SLOTS: remove with debug-slots.css. */
import { ViewContributionsHost } from './components/view-contributions-host/view-contributions-host';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ButtonModule, TooltipModule, DemoBanner, SettingsModal, /* DEBUG-SLOTS */ ViewContributionsHost],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly theme = inject(ThemeService);
  private readonly dataSource = inject(DATA_SOURCE);
  // Boot the URL ↔ filter sync (constructor-driven; the inject() call
  // is sufficient — the service self-wires its router subscription
  // and signal effects on construction).
  private readonly _filterUrlSync = inject(FilterUrlSyncService);
  /* DEBUG-SLOTS: construct on boot so it reads ?debug-slots / localStorage. */
  private readonly _debugSlots = inject(DebugSlotsService);
  protected readonly updateCheck = inject(UpdateCheckService);

  protected readonly texts = APP_TEXTS;
  protected readonly settingsTexts = SETTINGS_TEXTS;
  /**
   * Settings modal visibility. The modal is `@defer`-wrapped in the
   * template so its chunk (Dialog + ToggleSwitch + Message) only loads
   * on first open. Once loaded it stays mounted; subsequent opens flip
   * the signal and the modal's effect re-fetches the plugin list.
   */
  protected readonly settingsOpen = signal(false);

  protected openSettings(): void {
    this.settingsOpen.set(true);
  }

  /**
   * In-flight flag for the topbar refresh button. Prevents double-fires
   * (the button is also `disabled` while truthy) and drives the icon's
   * `pi-spin` class. Reset in `finally` so any error still re-enables
   * the button.
   */
  protected readonly scanning = signal(false);
  protected readonly scanError = signal<string | null>(null);

  protected async triggerScan(): Promise<void> {
    if (this.scanning()) return;
    this.scanning.set(true);
    this.scanError.set(null);
    try {
      await this.dataSource.runScan();
      // The route's broadcaster also emits `scan.completed` over WS,
      // which `CollectionLoaderService` already subscribes to. The
      // explicit `load()` here covers the demo path (no WS) and races
      // where the WS event arrives before this Promise resolves.
      await this.loader.load();
    } catch (err) {
      const message = err instanceof DataSourceError ? err.message
        : err instanceof Error ? err.message
        : String(err);
      this.scanError.set(message);
      console.warn(`triggerScan failed: ${message}`);
    } finally {
      this.scanning.set(false);
    }
  }
  protected readonly updateChipText = UPDATE_CHECK_TEXTS.available;
  protected readonly updateChipTooltip = computed(() =>
    UPDATE_CHECK_TEXTS.tooltip(this.updateCheck.latest() ?? ''),
  );
  protected readonly updateChipA11y = computed(() =>
    UPDATE_CHECK_TEXTS.a11yLabel(this.updateCheck.latest() ?? ''),
  );
  protected readonly versionLabel = computed(() =>
    UPDATE_CHECK_TEXTS.versionLabel(this.updateCheck.current() ?? ''),
  );
  protected readonly versionTooltip = computed(() =>
    UPDATE_CHECK_TEXTS.versionTooltip(this.updateCheck.current() ?? ''),
  );
  protected readonly versionA11y = computed(() =>
    UPDATE_CHECK_TEXTS.versionA11yLabel(this.updateCheck.current() ?? ''),
  );
  readonly count = this.loader.count;
  readonly linkCount = computed(() => this.loader.scan()?.links?.length ?? 0);
  protected readonly graphInfoTooltip = computed(() =>
    APP_TEXTS.badge.graphInfo(this.count(), this.linkCount()),
  );
  protected readonly graphInfoA11y = computed(() =>
    APP_TEXTS.badge.graphInfoA11y(this.count(), this.linkCount()),
  );
  /**
   * Project path surfaced under the brand mark. Prefers `/api/health`'s
   * `cwd` (the absolute project root, tilde-anonymised by the BFF) so
   * the user sees the real folder they're scanning. Falls back to the
   * first scan root for the demo path where `health.cwd` may be unset
   * or generic. Empty string suppresses the line entirely.
   */
  readonly rootLabel = computed(() => {
    const cwd = this.healthCwd();
    if (cwd && cwd !== '.') return cwd;
    const roots = this.loader.scan()?.roots ?? [];
    if (roots.length === 0) return '';
    const trimmed = roots[0].replace(/[\\/]+$/, '');
    if (!trimmed || trimmed === '.') return '';
    return trimmed;
  });
  private readonly healthCwd = signal<string | null>(null);
  protected readonly isDevMode = isDevMode();
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
    void this.loadHealth();
  }

  /**
   * One-shot fetch of `/api/health` so the topbar can surface the
   * project path under the brand mark. Failures are silent — the
   * `rootLabel()` computed falls back to `scan.roots` and ultimately
   * to an empty string, which hides the line.
   */
  private async loadHealth(): Promise<void> {
    try {
      const payload = await this.dataSource.health();
      this.healthCwd.set(payload.cwd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`App: /api/health probe failed (${msg})`);
    }
  }

  toggleTheme(): void {
    this.theme.toggle();
  }
}
