/**
 * `UpdateCheckService`, one-shot probe of the BFF's
 * `/api/update-status` endpoint, used by the topbar to surface a
 * passive "update available" chip when a newer `@skill-map/cli`
 * release has been recorded by the CLI's post-run hook.
 *
 * Wiring: `App.ngOnInit()` calls `load()` once at boot. The endpoint
 * always returns 200 with a payload mirroring
 * `IUpdateStatusResponse` on the BFF (`isOutdated: true` is the only
 * signal the UI uses). Failures are intentionally silent, the chip
 * simply stays hidden when we cannot resolve the status.
 *
 * **Demo mode is a no-op.** The static demo bundle has no BFF, so the
 * `/api/update-status` fetch would 404. The service short-circuits
 * when `SKILL_MAP_MODE === 'demo'` so the demo bundle stays fully
 * offline (the smoke test enforces both "no /api/* calls" and "no
 * console errors").
 *
 * No reactive polling: the CLI is responsible for refreshing the
 * cache; the UI reflects whatever the BFF reports on the next page
 * load. The service mirrors the signal-based shape used elsewhere
 * in `app/services/` (see `contributions-registry.ts`).
 */

import { computed, Injectable, inject, signal } from '@angular/core';

import { UPDATE_CHECK_TEXTS } from '../../i18n/update-check.texts';
import type { IUpdateStatusResponseApi } from '../../models/api';
import { DATA_SOURCE, type IDataSourcePort } from '../../services/data-source/data-source.port';

@Injectable({ providedIn: 'root' })
export class UpdateCheckService {
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);

  /** Latest known status, or `null` until the first fetch resolves. */
  readonly status = signal<IUpdateStatusResponseApi | null>(null);
  /** Convenience: derived signal, true when a newer version is available. */
  readonly isOutdated = computed(() => this.status()?.isOutdated === true);
  /** Convenience: derived signal, the new latest version string (or `null`). */
  readonly latest = computed(() => this.status()?.latest ?? null);
  /**
   * Convenience: derived signal, the CLI / server version this BFF is
   * running. `null` until the first fetch resolves. Surfaced by the
   * topbar so a screenshot from a tester is self-identifying.
   */
  readonly current = computed(() => this.status()?.current ?? null);

  /**
   * One-shot fetch through `IDataSourcePort.getUpdateStatus()`. Silent
   * on every failure (network, non-2xx, JSON parse error), only logs
   * a `console.warn`. Called once from `App.ngOnInit()`. Demo mode
   * resolves to a synthetic "up-to-date" snapshot so the topbar still
   * renders the current-version chip.
   */
  async load(): Promise<void> {
    try {
      const payload = await this.dataSource.getUpdateStatus();
      this.status.set(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(UPDATE_CHECK_TEXTS.fetchFailed(msg));
    }
  }
}
