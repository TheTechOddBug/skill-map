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

import { computed, Injectable, signal } from '@angular/core';

import type { IUpdateStatusResponseApi } from '../../models/api';
import { readSkillMapModeFromMeta } from '../../services/data-source/runtime-mode';

@Injectable({ providedIn: 'root' })
export class UpdateCheckService {

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
   * One-shot fetch from `/api/update-status`. Silent on every failure
   * (network, non-2xx, JSON parse error) — only logs a `console.warn`.
   * Called once from `App.ngOnInit()`. No-op in demo mode (the demo
   * bundle is fully static; an `/api/update-status` fetch would 404).
   */
  async load(): Promise<void> {
    if (readSkillMapModeFromMeta() === 'demo') return;
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
