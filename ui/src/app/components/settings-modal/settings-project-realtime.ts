/**
 * `<sm-settings-project-realtime>`, the "Real-time node activity" row
 * of the Settings > Project section: whether executing nodes light up
 * on the map, `ui.realtimeActivity` in `settings.local.json`. Also
 * hosts the "Flash on file changes" row right below it
 * (`ui.changeSpark`, the change spark) and the runtime sub-agents row.
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
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { SESSION_PURGE_TEXTS } from '../../../i18n/session-purge.texts';
import { SessionPurgeService } from '../../../services/session-purge';
import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import { UsageTrackerService } from '../../services/usage-tracker';
import { ActivityRecorderService } from '../../../services/activity-recorder';
import { formatExactCount } from '../../../services/format-count';
import { LivePreferencesService } from '../../../services/live-preferences';
import { NodeActivityService } from '../../../services/node-activity';
import { NodeSparkService } from '../../../services/node-spark';
import { WsEventStreamService } from '../../../services/ws-event-stream';
import { ActivityReadinessService } from '../../services/activity-readiness';
import { ToggleRowDirective } from './toggle-row.directive';

@Component({
  selector: 'sm-settings-project-realtime',
  imports: [ButtonModule, ConfirmDialogModule, FormsModule, ToggleRowDirective, ToggleSwitchModule],
  providers: [ConfirmationService],
  templateUrl: './settings-project-realtime.html',
  styleUrl: './settings-project-rows.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProjectRealtime {
  private readonly usageTracker = inject(UsageTrackerService);
  private readonly wsStream = inject(WsEventStreamService);
  private readonly nodeActivity = inject(NodeActivityService);
  private readonly nodeSpark = inject(NodeSparkService);
  private readonly activityReadiness = inject(ActivityReadinessService);
  private readonly livePrefs = inject(LivePreferencesService);

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
    this.usageTracker.trackFeature('realtime-activity', next, 'settings');
    this.nodeActivity.setEnabled(next);
  }

  /**
   * Change spark (`ui.changeSpark`): writes through the feature owner
   * (`NodeSparkService.setEnabled`, which clears the live sparks on
   * disable), mirroring the activity toggle above. Subordinate to Live
   * updates only, never to the activity toggle or the hook state (the
   * spark rides scan frames, no hook involved).
   */
  protected readonly changeSparkEnabled = this.nodeSpark.enabled;

  protected onChangeSparkToggle(next: boolean): void {
    this.usageTracker.trackFeature('change-spark', next);
    this.nodeSpark.setEnabled(next);
  }

  /**
   * Runtime sub-agent capsules (`ui.showRuntimeAgents`). Behaviour
   * owner is the graph's overlay projection, which reads the preference
   * signal directly (no runtime state to clear), so the row writes the
   * preference setter itself, mirroring the follow-activity shape.
   */
  protected readonly showRuntimeAgents = this.livePrefs.showRuntimeAgents;

  protected onShowRuntimeAgentsToggle(next: boolean): void {
    this.usageTracker.trackFeature('runtime-agents', next);
    this.livePrefs.setShowRuntimeAgents(next);
  }

  /**
   * Live lens replay tape. Not a preference: a readout of what this
   * browser is holding plus the operator's delete. Since 2026-08-16 the
   * delete is ONE gesture over BOTH memories (the browser tape and the
   * project session journal, via `SessionPurgeService`) behind a
   * confirm that names the analyzer-evidence cost; the operator
   * decides.
   */
  private readonly recorder = inject(ActivityRecorderService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly purgeSvc = inject(SessionPurgeService);

  protected readonly recordedCount = this.recorder.size;

  protected readonly recordingSummary = computed(() => {
    const events = this.recordedCount();
    if (events === 0) return SETTINGS_TEXTS.project.live.recording.empty;
    return SETTINGS_TEXTS.project.live.recording.summary(
      formatExactCount(events),
      formatStoredSize(this.recorder.storedChars()),
    );
  });

  protected onDeleteRecording(): void {
    // No usage event: `TUsageFeatureSurface` is a CLOSED taxonomy
    // (spec/telemetry.md), and a new member is a spec change, not a
    // side effect of adding a button.
    this.confirmation.confirm({
      header: SESSION_PURGE_TEXTS.confirmHeader,
      message: SESSION_PURGE_TEXTS.confirmMessage,
      acceptLabel: SESSION_PURGE_TEXTS.confirmAccept,
      rejectLabel: SESSION_PURGE_TEXTS.confirmReject,
      acceptButtonProps: { severity: 'danger' },
      rejectButtonProps: { severity: 'secondary' },
      accept: () => {
        this.purgeSvc.purge();
      },
    });
  }
}

/**
 * Stored size for the readout. The recorder meters UTF-16 characters
 * (what the browser charges against the quota); one ASCII character is
 * one byte on disk, so the KB figure reads true for path / owner /
 * tool-name payloads and errs low only for non-ASCII ones.
 */
function formatStoredSize(chars: number): string {
  if (chars < 1024) return `${chars} B`;
  const kb = chars / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
