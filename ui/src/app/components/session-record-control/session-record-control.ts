/**
 * `<sm-session-record-control>`, the shared record / stop / exit-replay
 * control (user decision 2026-08-16): ONE button whose face follows the
 * live modes. While a replay runs it is the replay's exit (amber);
 * while recording it is Stop (with the blinking broadcast dot); idle it
 * is Record session, the only gesture that starts a capture, never
 * ambient.
 *
 * Mounted twice: at the top of the Sessions rail (its home, all three
 * faces) and above the Files rail's search (`stopOnly`: the idle face
 * hides, so Files only ever shows the way OUT of a running record /
 * replay, the two modes that visibly narrow that rail). Same component,
 * same testids; the two hosts are exclusive rail tabs, so the DOM never
 * carries both at once.
 *
 * Gestures route through `SESSION_RECORD_INTENT` (the workspace
 * forwards to the graph view, which owns the lens enter/exit) except
 * the replay exit, which talks to `ActivityPlaybackService` directly,
 * the transport-bar precedent.
 */

import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { SESSION_RECORD_CONTROL_TEXTS } from '../../../i18n/session-record-control.texts';
import { ActivityPlaybackService } from '../../../services/activity-playback';
import { ActivityRecorderService } from '../../../services/activity-recorder';
import { LiveLensService } from '../../../services/live-lens';
import { NodeActivityService } from '../../../services/node-activity';
import { SESSION_RECORD_INTENT } from '../../slots/session-record-intent';

@Component({
  selector: 'sm-session-record-control',
  imports: [ButtonModule, TooltipModule],
  templateUrl: './session-record-control.html',
  styleUrl: './session-record-control.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionRecordControl {
  protected readonly recorder = inject(ActivityRecorderService);
  protected readonly playback = inject(ActivityPlaybackService);
  private readonly liveLens = inject(LiveLensService);
  private readonly nodeActivity = inject(NodeActivityService);
  private readonly recordIntent = inject(SESSION_RECORD_INTENT);
  protected readonly texts = SESSION_RECORD_CONTROL_TEXTS;

  /**
   * Files-rail mode: render ONLY while something is on (recording or
   * replaying); the idle Record face stays exclusive to Sessions.
   */
  readonly stopOnly = input(false);

  protected readonly visible = computed(
    () => !this.stopOnly() || this.recorder.recording() || this.playback.active(),
  );

  /**
   * Recording needs frames to capture: the lens available (not demo)
   * AND Real Time on (the frame source; the recorder auto-stops when
   * it flips off).
   */
  private readonly recordAvailable = computed(
    () => this.liveLens.available() && this.nodeActivity.enabled(),
  );

  /** The control's face, one of three (see the class doc). */
  protected readonly face = computed(() => {
    if (this.playback.active()) {
      // Deliberately the recording stop's anatomy (stop glyph, stop
      // verb, dot + status beside) in the replay amber, so the two
      // stop faces read as the same gesture on different modes.
      return {
        label: this.texts.stopReplay,
        icon: 'pi pi-stop-circle',
        severity: 'secondary' as const,
        tooltip: this.texts.stopReplayTooltip,
        disabled: false,
      };
    }
    if (this.recorder.recording()) {
      return {
        label: this.texts.stop,
        icon: 'pi pi-stop-circle',
        severity: 'danger' as const,
        tooltip: this.texts.stopTooltip,
        disabled: false,
      };
    }
    const available = this.recordAvailable();
    return {
      label: this.texts.start,
      icon: 'pi pi-circle-fill',
      severity: 'danger' as const,
      tooltip: available ? this.texts.startTooltip : this.texts.unavailableTooltip,
      disabled: !available,
    };
  });

  /** The single gesture, routed per the face above. */
  protected onClick(): void {
    if (this.playback.active()) {
      this.playback.exit();
      return;
    }
    if (this.recorder.recording()) this.recordIntent.stopRecording();
    else this.recordIntent.startRecording();
  }
}
