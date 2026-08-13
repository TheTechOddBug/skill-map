/**
 * `<sm-live-lens-controls>`, the Live lens cluster of the graph view's
 * bottom toolbar:
 *
 *   1. The lens toggle (always, while Real Time is on and the mode is
 *      not demo). Enter/exit orchestration lives in the graph view's
 *      `setupLiveLens` controller (viewport snapshot, camera restore),
 *      so the toggle only EMITS; everything else here talks to
 *      `LiveLensService` directly.
 *   2. While the lens is on: the linger-window selector (5 min or
 *      no-limit, a compact popover in the layout-toolbar idiom) and
 *      the reset button (clears the accumulated canvas, client-side
 *      watermark).
 *
 * The host renders as a transparent fragment (`display: contents` in
 * the stylesheet) so the buttons are direct flex items of the parent's
 * `.graph__toolbar` row, sharing its 2px gap and no-wrap guarantee.
 */

import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { PopoverModule } from 'primeng/popover';
import { TooltipModule } from 'primeng/tooltip';

import { LIVE_LENS_TEXTS } from '../../../../i18n/live-lens.texts';
import { ActivityPlaybackService } from '../../../../services/activity-playback';
import { ActivityRecorderService } from '../../../../services/activity-recorder';
import { LIVE_LENS_DEFAULT_WINDOW_MS, LiveLensService } from '../../../../services/live-lens';
import { NodeActivityService } from '../../../../services/node-activity';

@Component({
  selector: 'sm-live-lens-controls',
  imports: [ButtonModule, PopoverModule, TooltipModule],
  templateUrl: './live-lens-controls.html',
  styleUrl: './live-lens-controls.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveLensControls {
  protected readonly lens = inject(LiveLensService);
  protected readonly nodeActivity = inject(NodeActivityService);
  protected readonly playback = inject(ActivityPlaybackService);
  /** Read for the replay gate only: no tape, no replay control. */
  protected readonly recorder = inject(ActivityRecorderService);

  protected readonly texts = LIVE_LENS_TEXTS;
  protected readonly defaultWindowMs = LIVE_LENS_DEFAULT_WINDOW_MS;

  /** Enter/exit intent; the graph view routes it through `setupLiveLens.toggle()`. */
  readonly toggleLens = output<void>();

  /** Replay intent; the graph view orchestrates (may enter the lens first). */
  readonly toggleReplay = output<void>();

  /** The cluster renders only where the lens can ever produce frames. */
  protected readonly available = computed(
    () => this.lens.available() && this.nodeActivity.enabled(),
  );

  protected readonly windowIsInfinite = computed(
    () => this.lens.windowMs() === Number.POSITIVE_INFINITY,
  );

  /** Compact face for the window button (the popover carries the full labels). */
  protected readonly windowCompactLabel = computed(() =>
    this.windowIsInfinite()
      ? this.texts.window.compactInfinite
      : this.texts.window.compactFiveMinutes,
  );

  protected selectWindow(infinite: boolean): void {
    this.lens.setWindow(infinite ? Number.POSITIVE_INFINITY : this.defaultWindowMs);
  }

  protected reset(): void {
    this.lens.reset();
  }
}
