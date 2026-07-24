/**
 * `<sm-tutorial-reminder-banner>`, a centered nudge in the topbar shown
 * to a first-time user, one message at a time: the Quick Start nudge
 * (step 0), then the `sm tutorial` nudge (step 1). Each dismiss advances
 * to the next step instead of hiding the whole reminder outright, so the
 * SECOND message only appears on the invocation after the first was
 * dismissed; dismissing the last step hides the reminder for good.
 *
 * The step persists to `.skill-map/settings.local.json` via the
 * `tutorialReminderStep` project-local config key (read at boot through
 * `getProjectPreferences`, written on dismiss through
 * `setProjectPreferences`). Gitignored + per-checkout, so it survives a
 * browser-storage wipe and resumes at the right step on this checkout.
 *
 * Emits `quickStartMentioned` whenever step 0 (the Quick Start nudge) is
 * showing, so the host shell can mark its own Quick Start button while
 * this reminder is pointing at it (see `app.ts` / `app.html`).
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';

import { TUTORIAL_REMINDER_TEXTS } from '../../../i18n/tutorial-reminder-banner.texts';
import { DATA_SOURCE, type IDataSourcePort } from '../../../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../../../services/data-source/runtime-mode';

const LAST_STEP = TUTORIAL_REMINDER_TEXTS.steps.length - 1;

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

  private readonly step = signal<number>(0);

  /** The message for the current step, clamped to the last defined one. */
  protected readonly current = computed(
    () => this.texts.steps[Math.min(this.step(), LAST_STEP)],
  );

  /**
   * Flips true only once the project preferences load AND the step is
   * still within the defined messages. Starting hidden (rather than
   * shown-then-hidden) avoids a flash for users past the last step.
   */
  protected readonly visible = signal<boolean>(false);

  /**
   * Step 0 is the only message that mentions Quick Start by name; the
   * shell topbar marks its Quick Start button while this is `true` so
   * the reminder and the button it's pointing at read as one nudge.
   */
  private readonly mentionsQuickStart = computed(() => this.visible() && this.step() === 0);

  readonly quickStartMentioned = output<boolean>();

  constructor() {
    void this.load();
    effect(() => this.quickStartMentioned.emit(this.mentionsQuickStart()));
  }

  async dismiss(): Promise<void> {
    const next = this.step() + 1;
    this.visible.set(false);
    try {
      await this.dataSource.setProjectPreferences({ tutorialReminderStep: next });
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
      const step = prefs.tutorialReminderStep ?? 0;
      this.step.set(step);
      this.visible.set(step <= LAST_STEP);
    } catch {
      // If preferences cannot be read, keep the banner hidden rather than
      // risk nagging against a broken backend.
    }
  }
}
