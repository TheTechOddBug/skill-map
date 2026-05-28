/**
 * `ProjectInfoService`, owns a one-shot probe of `/api/health` and
 * exposes the result as signals. Today's only consumer is the topbar
 * brand line (`App.rootLabel`), but anything that wants the project
 * root or BFF version reads the same source.
 *
 * Demo mode resolves through the active `IDataSourcePort` which already
 * returns a sensible health snapshot for the static bundle, so this
 * service stays uniform regardless of the runtime mode.
 *
 * Errors are intentionally silent. `cwd()` returns `null` until the
 * fetch resolves; consumers (`App.rootLabel`) fall back to other
 * sources when null.
 */

import { Injectable, computed, inject, signal } from '@angular/core';

import { PROJECT_INFO_TEXTS } from '../../i18n/project-info.texts';
import type { IHealthResponseApi } from '../../models/api';
import { DATA_SOURCE, type IDataSourcePort } from '../../services/data-source/data-source.port';

@Injectable({ providedIn: 'root' })
export class ProjectInfoService {
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);
  private readonly status = signal<IHealthResponseApi | null>(null);

  readonly cwd = computed<string | null>(() => this.status()?.cwd ?? null);
  readonly implVersion = computed<string | null>(() => this.status()?.implVersion ?? null);
  /**
   * `true` when `/api/health` reported `dev: true`, the BFF is running
   * from a local checkout of the skill-map repo rather than an
   * installed package. Drives the topbar `dev` chip so the operator
   * can tell at a glance whether they're hitting their own build.
   * `false` for both "published" and "health not yet loaded" so the
   * chip stays hidden until we have a positive signal.
   */
  readonly dev = computed<boolean>(() => this.status()?.dev === true);

  /**
   * Active provider lens id (`claude`, `gemini`, `markdown`, …) or
   * `null` when no lens is detected / configured. Drives the topbar
   * lens chip. Loaded alongside `/api/health` in `load()`; failure is
   * silent (the chip just stays hidden).
   */
  private readonly activeProviderState = signal<string | null>(null);
  readonly activeProvider = computed<string | null>(() => this.activeProviderState());

  async load(): Promise<void> {
    try {
      const payload = await this.dataSource.health();
      this.status.set(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(PROJECT_INFO_TEXTS.healthFailed(msg));
    }
    await this.reloadActiveProvider();
  }

  /**
   * Re-probe the active provider lens. Called at boot (via `load()`)
   * and again when the Settings modal closes, so a lens switch in the
   * Project section reflects in the topbar chip without a page reload.
   * Best-effort: a failure leaves the previous value (and the chip)
   * untouched.
   */
  async reloadActiveProvider(): Promise<void> {
    try {
      const lens = await this.dataSource.getActiveProvider();
      this.activeProviderState.set(lens.activeProvider);
    } catch {
      // Lens probe is best-effort; a failure leaves the chip as-is.
    }
  }
}
