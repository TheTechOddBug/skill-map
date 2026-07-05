/**
 * `ActivityReadinessService`, app-level probe of the live-activity
 * hook install state for the ACTIVE lens (`GET /api/active-provider`
 * then `GET /api/activity/install?provider=<lens>`).
 *
 * Real-time node lighting cannot work without the hook, so the two
 * surfaces that flip the preference (the topbar bolt toggle and the
 * Settings > General switch) both gate on this one signal instead of
 * running their own probes. Refresh points:
 *
 *   - boot (constructor), so the topbar toggle renders its true state
 *     without waiting for Settings to open;
 *   - every `scan.completed`, the cheapest existing "project state
 *     may have changed" tick (an install performed from the CLI shows
 *     up on the next scan without a reload);
 *   - Settings close (`App.onSettingsVisibleChange`), because the
 *     Project section is where installs / lens switches happen.
 *
 * `null` = unknown (probe pending or failed) and consumers FAIL OPEN:
 * a transport hiccup must never lock a purely local rendering
 * preference. Concurrent `refresh()` calls coalesce onto the single
 * in-flight probe so a close-then-scan burst costs one round-trip.
 *
 * Lives in `app/services/` (not `services/`): it coordinates domain
 * reads for an app-shell concern (chrome gating), per the layering
 * rule in `context/ui.md`.
 */

import { DestroyRef, Injectable, inject, signal } from '@angular/core';

import { DATA_SOURCE } from '../../services/data-source/data-source.port';
import { WsEventStreamService } from '../../services/ws-event-stream';

@Injectable({ providedIn: 'root' })
export class ActivityReadinessService {
  private readonly dataSource = inject(DATA_SOURCE);

  private readonly _hookInstalled = signal<boolean | null>(null);
  /**
   * `true` = active lens's hook installed; `false` = supported but not
   * installed (or lens unsupported, the hook can never be there);
   * `null` = unknown, consumers fail open.
   */
  readonly hookInstalled = this._hookInstalled.asReadonly();

  /** Single in-flight probe; concurrent refreshes await the same one. */
  private inFlight: Promise<void> | null = null;

  constructor() {
    const events = inject(WsEventStreamService);
    const destroyRef = inject(DestroyRef);
    const sub = events.scanCompleted$.subscribe(() => {
      void this.refresh();
    });
    destroyRef.onDestroy(() => sub.unsubscribe());
    // Boot probe: the topbar toggle mounts before Settings ever opens.
    void this.refresh();
  }

  /**
   * Re-probe the install state. Coalescing: while a probe is in
   * flight, further calls return the same promise instead of stacking
   * duplicate request pairs.
   */
  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.probe().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async probe(): Promise<void> {
    try {
      const lens = await this.dataSource.getActiveProvider();
      const status = await this.dataSource.getActivityInstallStatus(lens.activeProvider);
      this._hookInstalled.set(status.supported ? status.installed : false);
    } catch {
      // Unknown, NOT locked: any failure (transport, demo quirks)
      // resolves to null so the gate fails open.
      this._hookInstalled.set(null);
    }
  }
}
