/**
 * `<sm-connection-banner>`, top-of-shell banner shown only when the live
 * WS connection to `sm serve` has been lost, i.e. the reconnect loop in
 * `WsEventStreamService` exhausted `MAX_RECONNECT_ATTEMPTS` and flipped
 * `connectionState` to `'lost'`.
 *
 * Visibility is gated on two signals:
 *
 *   1. `SKILL_MAP_MODE === 'live'`. In demo mode the socket never opens,
 *      `connectionState` stays `'connecting'`, and the banner is inert.
 *   2. `connectionState() === 'lost'`. Transient `'reconnecting'` states
 *      (a routine `sm serve` restart reattaches within a couple of
 *      seconds) deliberately render nothing, so the banner only appears
 *      once the connection is genuinely gone.
 *
 * There is no dismiss button: the banner self-hides the moment the
 * connection is restored (`connectionState` returns to `'open'`), so it
 * never lingers after a successful reconnect. The Reconnect button calls
 * `WsEventStreamService.reconnect()`, which resets the backoff and
 * resumes delivery to existing subscribers without a re-subscribe.
 */

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { CONNECTION_BANNER_TEXTS } from '../../../i18n/connection-banner.texts';
import { SKILL_MAP_MODE } from '../../../services/data-source/runtime-mode';
import { WsEventStreamService } from '../../../services/ws-event-stream';

@Component({
  selector: 'sm-connection-banner',
  templateUrl: './connection-banner.html',
  styleUrl: './connection-banner.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionBanner {
  private readonly mode = inject(SKILL_MAP_MODE);
  private readonly ws = inject(WsEventStreamService);

  protected readonly texts = CONNECTION_BANNER_TEXTS;

  /**
   * Combine mode gate + connection state into a single boolean the
   * template binds against. Computed so Angular caches it and re-checks
   * only when `connectionState` changes.
   */
  protected readonly visible = computed<boolean>(
    () => this.mode === 'live' && this.ws.connectionState() === 'lost',
  );

  reconnect(): void {
    this.ws.reconnect();
  }
}
