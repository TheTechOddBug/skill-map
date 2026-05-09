/**
 * `UpdateCheckService` — one-shot probe of the BFF's
 * `/api/update-status` endpoint, used by the topbar to surface a
 * passive "update available" chip when a newer `@skill-map/cli`
 * release has been recorded by the CLI's post-run hook.
 *
 * Wiring: `App.ngOnInit()` calls `load()` once at boot. The endpoint
 * always returns 200 with a payload mirroring
 * `IUpdateStatusResponse` on the BFF (`isOutdated: true` is the only
 * signal the UI uses). Failures are intentionally silent — the chip
 * simply stays hidden when we cannot resolve the status.
 *
 * No reactive polling: the CLI is responsible for refreshing the
 * cache; the UI reflects whatever the BFF reports on the next page
 * load. The service mirrors the signal-based shape used elsewhere
 * in `app/services/` (see `contributions-registry.ts`).
 */

import { computed, Injectable, signal } from '@angular/core';

import type { IUpdateStatusResponseApi } from '../../models/api';

@Injectable({ providedIn: 'root' })
export class UpdateCheckService {
  /** Latest known status, or `null` until the first fetch resolves. */
  readonly status = signal<IUpdateStatusResponseApi | null>(null);
  /** Convenience: derived signal, true when a newer version is available. */
  readonly isOutdated = computed(() => this.status()?.isOutdated === true);
  /** Convenience: derived signal, the new latest version string (or `null`). */
  readonly latest = computed(() => this.status()?.latest ?? null);

  /**
   * One-shot fetch from `/api/update-status`. Silent on every failure
   * (network, non-2xx, JSON parse error) — only logs a `console.warn`.
   * Called once from `App.ngOnInit()`.
   */
  async load(): Promise<void> {
    try {
      const res = await globalThis.fetch('/api/update-status');
      if (!res.ok) {
        console.warn(`UpdateCheckService: /api/update-status returned HTTP ${res.status}`);
        return;
      }
      const payload = (await res.json()) as IUpdateStatusResponseApi;
      this.status.set(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`UpdateCheckService: fetch failed (${msg})`);
    }
  }
}
