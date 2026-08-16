/**
 * `<sm-playback-bar>`, the replay transport of the Live lens: exit,
 * play/pause, single-event stepping, the scrubber, the `k / N`
 * readout, and the ticker narrating the cursor event. Mounted by the
 * graph view only while `ActivityPlaybackService.active`; talks to
 * that service directly (the transport IS the service's surface; only
 * ENTERING replay needs orchestration, which stays in the graph view
 * because it may have to enter the lens first).
 *
 * The scrubber is a native `<input type="range">` on purpose: fully
 * keyboard-accessible out of the box, and the amber accent rides
 * `accent-color` with zero vendor styling.
 */

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';

import { PLAYBACK_BAR_TEXTS } from '../../../../i18n/playback-bar.texts';
import { SESSION_PURGE_TEXTS } from '../../../../i18n/session-purge.texts';
import { ActivityPlaybackService } from '../../../../services/activity-playback';
import { ActivityRecorderService } from '../../../../services/activity-recorder';
import { pathBasenameForLink } from '../../../../services/path-basename';
import { SessionPurgeService } from '../../../../services/session-purge';

@Component({
  selector: 'sm-playback-bar',
  imports: [ButtonModule, ConfirmDialogModule, TooltipModule],
  providers: [ConfirmationService],
  templateUrl: './playback-bar.html',
  styleUrl: './playback-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaybackBar {
  protected readonly playback = inject(ActivityPlaybackService);
  protected readonly recorder = inject(ActivityRecorderService);

  protected readonly texts = PLAYBACK_BAR_TEXTS;

  /** 1-based progress for humans (`0 / N` while before the first event). */
  protected readonly counter = computed(() =>
    this.texts.counter(this.playback.cursor() + 1, this.playback.total()),
  );

  protected readonly trimmed = computed(() => this.recorder.droppedCount() > 0);

  /**
   * Wall-clock `HH:MM:SS` (local) of the cursor event, rendered at the
   * caption's left so the operator knows WHEN the narrated step
   * executed (user request 2026-08-16). Empty before step 0, so the
   * chip only shows while a frame is under the cursor; tabular-nums in
   * CSS keeps its width stable across frames.
   */
  protected readonly captionTime = computed(() => {
    const event = this.playback.tape()[this.playback.cursor()];
    if (event === undefined) return '';
    const at = new Date(event.tMs);
    return this.texts.captionTime(pad2(at.getHours()), pad2(at.getMinutes()), pad2(at.getSeconds()));
  });

  /**
   * Elapsed `(mm:ss)` (hours prepended past one) from the tape's FIRST
   * event to the cursor event (user request 2026-08-16): how deep into
   * the session the narrated step happened. On a session-scoped replay
   * the tape starts at that session's first frame, so the offset reads
   * as time since the session began; unscoped, since recording began.
   */
  protected readonly captionElapsed = computed(() => {
    const tape = this.playback.tape();
    const event = tape[this.playback.cursor()];
    const first = tape[0];
    if (event === undefined || first === undefined) return '';
    const totalSeconds = Math.max(0, Math.floor((event.tMs - first.tMs) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const rest = `${pad2(Math.floor((totalSeconds % 3600) / 60))}:${pad2(totalSeconds % 60)}`;
    return this.texts.captionElapsed(hours > 0 ? `${hours}:${rest}` : rest);
  });

  /** The ticker line for the cursor event (empty before step 0). */
  protected readonly caption = computed(() => {
    const caption = this.playback.state().caption;
    if (caption === null) return '';
    switch (caption.kind) {
      case 'start':
        return this.texts.caption.start(pathBasenameForLink(caption.path), caption.detail);
      case 'end':
        return this.texts.caption.end(pathBasenameForLink(caption.path));
      case 'owner-end':
        return this.texts.caption.ownerEnd;
      case 'session-end':
        return this.texts.caption.sessionEnd;
      case 'spawn':
        return this.texts.caption.spawn(
          caption.parent === undefined ? '' : pathBasenameForLink(caption.parent),
          caption.childName ?? (caption.child === undefined ? '' : pathBasenameForLink(caption.child)),
          caption.phase,
        );
      default:
        return '';
    }
  });

  protected togglePlay(): void {
    if (this.playback.playing()) this.playback.pause();
    else this.playback.play();
  }

  private readonly confirmation = inject(ConfirmationService);
  private readonly purgeSvc = inject(SessionPurgeService);

  /**
   * Contextual shortcut for the Settings row's delete: the recording is
   * kept until the operator drops it, and the moment you decide it is
   * junk is usually while watching it. Leaving the replay is NOT done
   * here: `ActivityPlaybackService` stands the mode down whenever the
   * recording goes empty, wherever the delete came from. Confirmed
   * since 2026-08-16: one gesture also wipes the project session
   * journal (the observed-relations evidence), so the dialog names
   * that cost and the operator decides.
   */
  protected deleteRecording(): void {
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

  protected onSeek(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) this.playback.seek(value);
  }
}

/** Two-digit zero pad for the time stamps above. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
