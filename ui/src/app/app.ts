import { ChangeDetectionStrategy, Component, computed, inject, isDevMode, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgOptimizedImage } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';

import { APP_TEXTS } from '../i18n/app.texts';
import { SETTINGS_TEXTS } from '../i18n/settings.texts';
import { THEME_TEXTS } from '../i18n/theme.texts';
import { UPDATE_CHECK_TEXTS } from '../i18n/update-check.texts';
import { CollectionLoaderService } from '../services/collection-loader';
import { analyzeLinks } from './views/graph-view/graph-layout';
import { ProjectInfoService } from './services/project-info';
import { ScanTriggerService } from './services/scan-trigger';
import { UpdateCheckService } from './services/update-check';
import { UsageTrackerService } from './services/usage-tracker';
import { ThemeService } from '../services/theme';
import { ProviderRegistryService, type IProviderUi } from '../services/provider-registry';
import { DemoBanner } from './components/demo-banner/demo-banner';
import { OversizedBanner } from './components/oversized-banner/oversized-banner';
import { SkippedFilesBanner } from './components/skipped-files-banner/skipped-files-banner';
import { ConnectionBanner } from './components/connection-banner/connection-banner';
import { SettingsModal } from './components/settings-modal/settings-modal';
/* DEBUG-SLOTS: remove with debug-slots.css. */
import { ViewContributionsHost } from './components/view-contributions-host/view-contributions-host';

@Component({
  selector: 'sm-root',
  imports: [RouterOutlet, ButtonModule, InputTextModule, TooltipModule, FormsModule, NgOptimizedImage, DemoBanner, OversizedBanner, SkippedFilesBanner, ConnectionBanner, SettingsModal, /* DEBUG-SLOTS */ ViewContributionsHost],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly loader = inject(CollectionLoaderService);
  private readonly theme = inject(ThemeService);
  private readonly projectInfo = inject(ProjectInfoService);
  private readonly providerRegistry = inject(ProviderRegistryService);
  private readonly scanTrigger = inject(ScanTriggerService);
  private readonly usageTracker = inject(UsageTrackerService);
  // `FilterUrlSyncService` and `DebugSlotsService` are eagerly
  // instantiated via `provideAppInitializer` in `app.config.ts`. They
  // self-wire on construction; the App component does not need to
  // reach into them.
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
    this.usageTracker.trackFeature('settings');
  }

  /**
   * Settings modal visibility handler. On close, re-probe the active
   * provider lens so the topbar chip reflects a lens switch made in
   * the Project section without needing a full page reload.
   */
  protected onSettingsVisibleChange(open: boolean): void {
    this.settingsOpen.set(open);
    if (!open) void this.projectInfo.reloadActiveProvider();
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
  /**
   * Briefly `true` after the chip is clicked and the install command
   * has been written to the clipboard. Drives the in-chip label + icon
   * swap (and the tooltip swap as a secondary signal) so the user gets
   * unambiguous feedback. Reverts ~2s later.
   */
  protected readonly updateChipCopied = signal(false);
  protected readonly updateChipText = computed(() =>
    this.updateChipCopied() ? UPDATE_CHECK_TEXTS.copiedLabel : UPDATE_CHECK_TEXTS.available,
  );
  protected readonly updateChipIcon = computed(() =>
    this.updateChipCopied() ? 'pi pi-check' : 'pi pi-download',
  );
  protected readonly updateChipTooltip = computed(() =>
    this.updateChipCopied()
      ? UPDATE_CHECK_TEXTS.copiedTooltip
      : UPDATE_CHECK_TEXTS.tooltip(this.updateCheck.latest() ?? ''),
  );
  protected readonly updateChipA11y = computed(() =>
    UPDATE_CHECK_TEXTS.a11yLabel(this.updateCheck.latest() ?? ''),
  );
  protected readonly npmLinkUrl = UPDATE_CHECK_TEXTS.npmLinkUrl;
  protected readonly npmLinkTooltip = UPDATE_CHECK_TEXTS.npmLinkTooltip;
  protected readonly npmLinkA11y = UPDATE_CHECK_TEXTS.npmLinkA11y;

  /**
   * Writes the npm install command (`npm i -g @skill-map/cli@latest`) to
   * the clipboard and toggles the chip into its "Copied!" tooltip state
   * for a couple of seconds. Errors are swallowed: the Clipboard API
   * needs a secure context (https / localhost), so a failure here is
   * non-actionable from the user's perspective.
   */
  protected async copyUpdateCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(UPDATE_CHECK_TEXTS.copyCommand);
      this.updateChipCopied.set(true);
      setTimeout(() => this.updateChipCopied.set(false), 2000);
    } catch {
      // Clipboard write blocked (insecure context or denied permission). No-op.
    }
  }
  protected readonly versionLabel = computed(() =>
    UPDATE_CHECK_TEXTS.versionLabel(this.updateCheck.current() ?? ''),
  );
  protected readonly versionTooltip = computed(() =>
    UPDATE_CHECK_TEXTS.versionTooltip(this.updateCheck.current() ?? ''),
  );
  protected readonly versionA11y = computed(() =>
    UPDATE_CHECK_TEXTS.versionA11yLabel(this.updateCheck.current() ?? ''),
  );
  /**
   * `true` when the BFF reported `/api/health.dev = true` (local
   * checkout, not an installed package). Drives the yellow `dev` chip
   * the template renders next to the version. Stays `false` until
   * health resolves so the chip never flickers in.
   */
  protected readonly isDevBuild = this.projectInfo.dev;

  /**
   * Active-lens chip for the topbar. Mirrors the card provider badge's
   * colors (`ProviderRegistryService` is the single source) so the lens
   * the user is viewing through reads identically up top and inside the
   * cards. `null` (chip hidden) when no lens is active.
   */
  protected readonly lensChip = computed<IProviderUi | null>(() =>
    this.providerRegistry.lensChip(this.projectInfo.activeProvider()),
  );
  protected readonly count = this.loader.count;
  /**
   * Link reconciliation between `scan.links.length` (raw extractor
   * output, same number the CLI prints) and the edges actually drawn
   * on the graph canvas. The two diverge when a link points at a
   * non-existent target, is a self-loop, or duplicates another link.
   * The topbar tooltip shows the breakdown so the operator does not
   * see "19 links" in the CLI and "13 edges" on the canvas as a bug.
   */
  protected readonly linkAnalysis = computed(() =>
    analyzeLinks(this.loader.nodes(), this.loader.scan()),
  );
  protected readonly linkCount = computed(() => this.linkAnalysis().raw);
  protected readonly mapInfoTooltip = computed(() =>
    APP_TEXTS.badge.mapInfo(this.count(), this.linkAnalysis()),
  );
  protected readonly mapInfoA11y = computed(() =>
    APP_TEXTS.badge.mapInfoA11y(this.count(), this.linkAnalysis()),
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
  protected readonly markSrc = computed(() => {
    if (this.theme.extraTheme() === 'matrix') return 'skill-map-mark-matrix.svg';
    return this.theme.resolved() === 'dark'
      ? 'skill-map-mark-light.svg'
      : 'skill-map-mark-dark.svg';
  });
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
