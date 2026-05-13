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

  async load(): Promise<void> {
    try {
      const payload = await this.dataSource.health();
      this.status.set(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(PROJECT_INFO_TEXTS.healthFailed(msg));
    }
  }
}
