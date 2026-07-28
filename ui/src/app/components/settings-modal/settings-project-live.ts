/**
 * `<sm-settings-project-live>`, the "Live updates" row of the Settings
 * > Project section: whether the SPA keeps the map in sync with
 * `sm serve` at all (scan refreshes, live events, node activity),
 * `ui.liveUpdates` in `settings.local.json`.
 *
 * Display state comes from the feature owner's re-exposed preference
 * signal; writes go through `WsEventStreamService.setEnabled` so the
 * stored preference and the runtime behaviour (socket teardown /
 * reopen) apply atomically. Persistence is the project-preferences
 * PATCH via `LivePreferencesService`, which is why the row lives in
 * the Project section (its contract: every row is state that follows
 * the checkout).
 *
 * The dependent "Real-time node activity" row is the sibling
 * `<sm-settings-project-realtime>`; they are separate children so the
 * section can order the hook installer between them.
 */

import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import { WsEventStreamService } from '../../../services/ws-event-stream';
import { ToggleRowDirective } from './toggle-row.directive';

@Component({
  selector: 'sm-settings-project-live',
  imports: [FormsModule, ToggleRowDirective, ToggleSwitchModule],
  templateUrl: './settings-project-live.html',
  styleUrl: './settings-project-rows.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProjectLive {
  private readonly wsStream = inject(WsEventStreamService);

  readonly visible = input.required<boolean>();

  protected readonly texts = SETTINGS_TEXTS;

  protected readonly liveWsEnabled = this.wsStream.enabled;

  protected onLiveWsToggle(next: boolean): void {
    this.wsStream.setEnabled(next);
  }
}
