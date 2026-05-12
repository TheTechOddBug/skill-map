import { ChangeDetectionStrategy, Component, computed, inject, isDevMode, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { APP_TEXTS } from '../i18n/app.texts';
import { SETTINGS_TEXTS } from '../i18n/settings.texts';
import { THEME_TEXTS } from '../i18n/theme.texts';
import { UPDATE_CHECK_TEXTS } from '../i18n/update-check.texts';
import { CollectionLoaderService } from '../services/collection-loader';
/* DEBUG-SLOTS: remove with debug-slots.css. */
import { DebugSlotsService } from './services/debug-slots';
import { ProjectInfoService } from './services/project-info';
import { ScanTriggerService } from './services/scan-trigger';
import { UpdateCheckService } from './services/update-check';
import { FilterUrlSyncService } from '../services/filter-url-sync';
import { ThemeService } from '../services/theme';
import { DemoBanner } from './components/demo-banner/demo-banner';
import { SettingsModal } from './components/settings-modal/settings-modal';
/* DEBUG-SLOTS: remove with debug-slots.css. */
import { ViewContributionsHost } from './components/view-contributions-host/view-contributions-host';

@Component({
  selector: 'sm-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ButtonModule, TooltipModule, NgOptimizedImage, DemoBanner, SettingsModal, /* DEBUG-SLOTS */ ViewContributionsHost],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly loader = inject(CollectionLoaderService);
  private readonly theme = inject(ThemeService);
  private readonly projectInfo = inject(ProjectInfoService);
  private readonly scanTrigger = inject(ScanTriggerService);
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
   * In-flight flag for the topbar refresh button. Owned by
   * `ScanTriggerService` so the modal-apply flow shares the same
   * state (the topbar spinner reacts to either trigger, and concurrent
   * triggers are rejected against a single source of truth). Template
   * reads `scanning()` / `scanError()` via these accessors.
   */
  protected readonly scanning = this.scanTrigger.scanning;
  protected readonly scanError = this.scanTrigger.scanError;

  protected triggerScan(): Promise<void> {
    return this.scanTrigger.run();
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
  protected readonly count = this.loader.count;
  protected readonly linkCount = computed(() => this.loader.scan()?.links?.length ?? 0);
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
  protected readonly rootLabel = computed(() => {
    const cwd = this.projectInfo.cwd();
    if (cwd && cwd !== '.') return cwd;
    const roots = this.loader.scan()?.roots ?? [];
    if (roots.length === 0) return '';
    const trimmed = roots[0].replace(/[\\/]+$/, '');
    if (!trimmed || trimmed === '.') return '';
    return trimmed;
  });
  protected readonly isDevMode = isDevMode();
  protected readonly themeMode = this.theme.mode;
  protected readonly markSrc = computed(() =>
    this.theme.resolved() === 'dark'
      ? 'skill-map-mark-light.svg'
      : 'skill-map-mark-dark.svg',
  );
  protected readonly themeIcon = computed(() => {
    switch (this.themeMode()) {
      case 'auto':
        return 'pi pi-desktop';
      case 'light':
        return 'pi pi-sun';
      case 'dark':
        return 'fa-regular fa-moon';
    }
  });
  protected readonly themeLabel = computed(() => {
    switch (this.themeMode()) {
      case 'auto':
        return THEME_TEXTS.toggleToLight;
      case 'light':
        return THEME_TEXTS.toggleToDark;
      case 'dark':
        return THEME_TEXTS.toggleToAuto;
    }
  });
  protected readonly themeTooltip = computed(() => {
    switch (this.themeMode()) {
      case 'auto':
        return THEME_TEXTS.currentAuto;
      case 'light':
        return THEME_TEXTS.currentLight;
      case 'dark':
        return THEME_TEXTS.currentDark;
    }
  });

  protected toggleTheme(): void {
    this.theme.toggle();
  }
}
