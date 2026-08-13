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
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { PLAYBACK_BAR_TEXTS } from '../../../../i18n/playback-bar.texts';
import { ActivityPlaybackService } from '../../../../services/activity-playback';
import { ActivityRecorderService } from '../../../../services/activity-recorder';
import { pathBasenameForLink } from '../../../../services/path-basename';

@Component({
  selector: 'sm-playback-bar',
  imports: [ButtonModule, TooltipModule],
  templateUrl: './playback-bar.html',
  styleUrl: './playback-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaybackBar {
  protected readonly playback = inject(ActivityPlaybackService);
  private readonly recorder = inject(ActivityRecorderService);

  protected readonly texts = PLAYBACK_BAR_TEXTS;

  /** 1-based progress for humans (`0 / N` while before the first event). */
  protected readonly counter = computed(() =>
    this.texts.counter(this.playback.cursor() + 1, this.playback.total()),
  );

  protected readonly trimmed = computed(() => this.recorder.droppedCount() > 0);

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

  protected onSeek(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) this.playback.seek(value);
  }
}
