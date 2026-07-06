/**
 * `<sm-settings-project-realtime>`, the "Real-time node activity" row
 * of the Settings > Project section: whether executing nodes light up
 * on the map, `ui.realtimeActivity` in `settings.local.json`.
 *
 * Subordinate to two gates, each with its own hint:
 *   - "Live updates" (the sibling `<sm-settings-project-live>` row):
 *     no live channel, no activity frames;
 *   - the ACTIVE lens's activity hook (installed by the sibling
 *     `<sm-settings-project-hook>` row): known-missing disables the
 *     toggle; `null` = unknown FAILS OPEN, a probe hiccup never locks
 *     a local rendering preference.
 *
 * Display state comes from the feature owner's re-exposed preference
 * signal; writes go through `NodeActivityService.setEnabled` so the
 * stored preference and the runtime behaviour (lit-set clear) apply
 * atomically. On `(visible) === true` it re-probes the shared
 * hook-install state (coalesces with any probe already in flight).
 */

import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import { NodeActivityService } from '../../../services/node-activity';
import { WsEventStreamService } from '../../../services/ws-event-stream';
import { ActivityReadinessService } from '../../services/activity-readiness';

@Component({
  selector: 'sm-settings-project-realtime',
  imports: [FormsModule, ToggleSwitchModule],
  templateUrl: './settings-project-realtime.html',
  styleUrl: './settings-project-rows.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProjectRealtime {
  private readonly wsStream = inject(WsEventStreamService);
  private readonly nodeActivity = inject(NodeActivityService);
  private readonly activityReadiness = inject(ActivityReadinessService);

  readonly visible = input.required<boolean>();

  protected readonly texts = SETTINGS_TEXTS;

  protected readonly liveWsEnabled = this.wsStream.enabled;
  protected readonly liveActivityEnabled = this.nodeActivity.enabled;

  /**
   * Whether the ACTIVE lens's live-activity hook is installed. Owned by
   * the shared `ActivityReadinessService` (the same signal gates the
   * topbar Real Time toggle); re-probed on every section open so a hook
   * installed from the row above (or the CLI) reflects here without a
   * reload.
   */
  protected readonly activityHookInstalled = this.activityReadiness.hookInstalled;

  constructor() {
    effect(() => {
      if (this.visible()) void this.activityReadiness.refresh();
    });
  }

  protected onLiveActivityToggle(next: boolean): void {
    this.nodeActivity.setEnabled(next);
  }
}
