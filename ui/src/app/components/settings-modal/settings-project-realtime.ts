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
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';

import { SESSION_PURGE_TEXTS } from '../../../i18n/session-purge.texts';
import { DATA_SOURCE, type IDataSourcePort } from '../../../services/data-source/data-source.port';
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
import { CaptureLevelSelector } from '../capture-level-selector/capture-level-selector';
import { CaptureLevelService } from '../../../services/capture-level';
import { CAPTURE_LEVEL_TEXTS } from '../../../i18n/capture-level.texts';
import { ToggleRowDirective } from './toggle-row.directive';

@Component({
  selector: 'sm-settings-project-realtime',
  imports: [
    ButtonModule,
    CaptureLevelSelector,
    ConfirmDialogModule,
    FormsModule,
    ToggleRowDirective,
    ToggleSwitchModule,
    TooltipModule,
  ],
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
      if (this.visible()) {
        void this.activityReadiness.refresh();
        this.refreshJournalCount();
        // The Settings mirror can open without the Sessions tab ever
        // having hydrated the ladder: fetch the live level on open.
        void this.captureLevelSvc.refresh();
      }
    });
  }

  /** Capture-ladder mirror (spec provider-activity.md, Capture level). */
  protected readonly captureLevelSvc = inject(CaptureLevelService);
  protected readonly captureLevelTexts = CAPTURE_LEVEL_TEXTS;

  /**
   * Shell unlock line: the install-side half of the double opt-in runs
   * in the terminal, so the row shows the exact command with a Copy
   * button (the MCP registration row's dialect). Never hidden while
   * the lens supports the rung: once the opt-in is on it flips to the
   * `--no-shell` way back out (an absent line read as a bug in the
   * field, 2026-08-17). LENS-CONDITIONED (user report 2026-08-18: the
   * command hardcoded claude): the provider id and its shell
   * capability come from the shared readiness probe; a lens whose
   * provider declares no shell opt-in event renders the `unavailable`
   * line instead, and an unresolved probe renders nothing rather than
   * naming a wrong provider.
   */
  protected readonly shellUnlockHint = computed<string | null>(() => {
    const lens = this.activityReadiness.lensId();
    const optIn = this.activityReadiness.shellOptIn();
    if (lens === null || lens === '' || optIn === null) return null;
    if (!optIn) return this.captureLevelTexts.shellUnlock.unavailable(lens);
    return this.captureLevelSvc.shellCapture()
      ? this.captureLevelTexts.shellUnlock.hintOn
      : this.captureLevelTexts.shellUnlock.hint(lens);
  });

  /** The copyable opt-in command, `null` when the lens has no shell rung. */
  protected readonly shellUnlockCommand = computed<string | null>(() => {
    const lens = this.activityReadiness.lensId();
    if (lens === null || lens === '' || this.activityReadiness.shellOptIn() !== true) return null;
    return this.captureLevelTexts.shellUnlock.command(lens);
  });

  protected readonly shellCommandCopied = signal(false);

  protected async onCopyShellCommand(): Promise<void> {
    const command = this.shellUnlockCommand();
    if (command === null) return;
    this.usageTracker.trackFeature('shell-optin-copy', undefined, 'settings');
    try {
      await navigator.clipboard.writeText(command);
      this.shellCommandCopied.set(true);
      setTimeout(() => this.shellCommandCopied.set(false), 2000);
    } catch {
      // Clipboard blocked (insecure context / denied). Non-actionable, no-op.
    }
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
   * Session recording readout + the operator's FULL delete. Since the
   * replay trash went tape-only (2026-08-17), the two memories can
   * diverge, so this row reads BOTH: the browser tape (recorder
   * signals) and the project journal (session-file count fetched on
   * section open; defensive optional call, the settings specs mount
   * partial DATA_SOURCE stubs and demo mode has no journal). The delete
   * stays the ONE both-memories gesture (2026-08-16) behind the confirm
   * that names the analyzer-evidence cost; it must be available while
   * EITHER memory holds something, an empty tape with journal files on
   * disk was exactly the 2026-08-17 field bug.
   */
  private readonly recorder = inject(ActivityRecorderService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly purgeSvc = inject(SessionPurgeService);
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);

  protected readonly recordedCount = this.recorder.size;

  /** Journal session-file count (0 until fetched; demo mode stays 0). */
  protected readonly journalSessions = signal(0);

  private refreshJournalCount(): void {
    void this.dataSource
      .getSessionJournal?.()
      .then(({ sessions }) => this.journalSessions.set(sessions.length))
      .catch(() => {
        // Best-effort: the readout keeps its tape half.
      });
  }

  protected readonly recordingSummary = computed(() => {
    const events = this.recordedCount();
    const sessions = this.journalSessions();
    const parts: string[] = [];
    if (events > 0) {
      parts.push(
        SETTINGS_TEXTS.project.live.recording.tape(
          formatExactCount(events),
          formatStoredSize(this.recorder.storedChars()),
        ),
      );
    }
    if (sessions > 0) {
      parts.push(SETTINGS_TEXTS.project.live.recording.journal(sessions));
    }
    if (parts.length === 0) return SETTINGS_TEXTS.project.live.recording.empty;
    return parts.join(SETTINGS_TEXTS.project.live.recording.separator);
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
        // Optimistic: the journal wipe is fire-and-forget; the count
        // re-syncs on the next section open either way.
        this.journalSessions.set(0);
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
