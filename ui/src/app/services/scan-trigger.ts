/**
 * `ScanTriggerService`, shared owner of the manual-scan trigger.
 *
 * Two callers exercise the same flow today:
 *
 *   - `App` (`app.ts`), the topbar refresh button.
 *   - `SettingsPlugins` (`components/settings-modal/settings-plugins.ts`):
 *     buffered modal applies pending plugin toggles and immediately
 *     requests a scan so the graph reflects the new state.
 *
 * Previously the flow lived on `App` itself and `SettingsPlugins` would
 * have had to reach into the App component (or duplicate the wiring) to
 * fire a scan after a `PATCH /api/plugins`. Centralising it here keeps
 * the in-flight `scanning` signal authoritative across both surfaces:
 * the topbar spinner reacts to a modal-driven scan, and a topbar refresh
 * is rejected while a modal-apply scan is still running.
 *
 * Behaviour mirrors the pre-refactor `App.triggerScan` body:
 *
 *   1. Short-circuit when a scan is already in flight (prevents
 *      double-fires and matches the historic guard that disables the
 *      topbar button while `scanning()` is truthy).
 *   2. Flip `scanning` to `true`, clear `scanError`.
 *   3. POST `/api/scan` via the data-source port. The BFF route
 *      broadcasts `scan.completed` over `/ws` and the
 *      `CollectionLoaderService` already subscribes, the explicit
 *      `loader.load()` afterwards covers the demo path (no WS) and
 *      races where the WS event arrives before the POST promise
 *      resolves.
 *   4. On error, persist the message on `scanError` and surface a
 *      console warning. The signal is what the topbar / settings
 *      modal renders to the user.
 *   5. Reset `scanning` in `finally` so any failure still re-enables
 *      the trigger.
 */

import { Injectable, inject, signal } from '@angular/core';

import { SCAN_TRIGGER_TEXTS } from '../../i18n/scan-trigger.texts';
import { CollectionLoaderService } from '../../services/collection-loader';
import { DATA_SOURCE, DataSourceError } from '../../services/data-source/data-source.port';

@Injectable({ providedIn: 'root' })
export class ScanTriggerService {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly loader = inject(CollectionLoaderService);

  private readonly scanningState = signal(false);
  private readonly scanErrorState = signal<string | null>(null);

  /**
   * In-flight flag. `true` while `run()` is awaiting `runScan()` /
   * `loader.load()`. Topbar uses it for the spinner + disabled state;
   * the settings modal can read it to keep its "Apply" button busy.
   * Read-only: `run()` owns every transition (the idempotency guard
   * relies on no consumer flipping it externally).
   */
  readonly scanning = this.scanningState.asReadonly();

  /**
   * Last error message, or `null` after a successful run. Cleared on
   * the next `run()` start. Renderers should treat a populated value
   * as advisory, the underlying state may still be partial.
   */
  readonly scanError = this.scanErrorState.asReadonly();

  /**
   * Fire-and-forget scan trigger. Idempotent while `scanning()` is
   * truthy (concurrent calls resolve immediately without enqueuing).
   * Resolves once the data-source returns and the loader has been
   * refreshed; errors are caught and surfaced via `scanError`.
   */
  async run(): Promise<void> {
    if (this.scanning()) return;
    this.scanningState.set(true);
    this.scanErrorState.set(null);
    try {
      await this.dataSource.runScan();
      // The route's broadcaster also emits `scan.completed` over WS,
      // which `CollectionLoaderService` already subscribes to. The
      // explicit `load()` here covers the demo path (no WS) and races
      // where the WS event arrives before this Promise resolves.
      await this.loader.load();
    } catch (err) {
      const message = err instanceof DataSourceError ? err.message
        : err instanceof Error ? err.message
        : String(err);
      this.scanErrorState.set(message);
      console.warn(SCAN_TRIGGER_TEXTS.scanFailed(message));
    } finally {
      this.scanningState.set(false);
    }
  }
}
