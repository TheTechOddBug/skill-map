/**
 * `<sm-tutorial-reminder-banner>`, a centered nudge in the topbar that
 * reminds first-time users to run the interactive tutorial.
 *
 * Dismissal persists to `.skill-map/settings.local.json` via the
 * `tutorialReminderDismissed` project-local config key (read at boot
 * through `getProjectPreferences`, written on dismiss through
 * `setProjectPreferences`). Gitignored + per-checkout, so it survives a
 * browser-storage wipe and never nags again on this checkout.
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import { TUTORIAL_REMINDER_TEXTS } from '../../../i18n/tutorial-reminder-banner.texts';
import { DATA_SOURCE, type IDataSourcePort } from '../../../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../../../services/data-source/runtime-mode';

@Component({
  selector: 'sm-tutorial-reminder-banner',
  imports: [ButtonModule],
  templateUrl: './tutorial-reminder-banner.html',
  styleUrl: './tutorial-reminder-banner.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TutorialReminderBanner {
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);
  private readonly mode = inject(SKILL_MAP_MODE);

  protected readonly texts = TUTORIAL_REMINDER_TEXTS;

  /**
   * Flips true only once the project preferences load AND the dismissal
   * flag is unset. Starting hidden (rather than shown-then-hidden) avoids
   * a flash for users who already dismissed it on this checkout.
   */
  protected readonly visible = signal<boolean>(false);

  constructor() {
    void this.load();
  }

  async dismiss(): Promise<void> {
    this.visible.set(false);
    try {
      await this.dataSource.setProjectPreferences({ tutorialReminderDismissed: true });
    } catch {
      // Best-effort: demo mode is read-only (the static bundle cannot
      // persist) and a transient BFF error should not un-hide the banner.
      // It stays dismissed for this session regardless.
    }
  }

  private async load(): Promise<void> {
    // Demo mode cannot run `sm tutorial` (static bundle, no CLI), and the
    // demo-banner already carries the install nudge, so suppress this one.
    if (this.mode === 'demo') return;
    try {
      const prefs = await this.dataSource.getProjectPreferences();
      this.visible.set(!prefs.tutorialReminderDismissed);
    } catch {
      // If preferences cannot be read, keep the banner hidden rather than
      // risk nagging against a broken backend.
    }
  }
}
