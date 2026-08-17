/**
 * `DismissedNotesService`, the one-time informational notes surface:
 * small dismissible callouts (the Sessions tab's recording intro today)
 * whose dismissal persists MACHINE-WIDE in `~/.skill-map/settings.json`
 * (`ui.dismissedNotes` via `PATCH /api/preferences`), so closing a note
 * once closes it on every project this operator opens.
 *
 * Until the preferences load, `isDismissed` answers `true` for every id
 * (notes render only after a POSITIVE "not dismissed"), so a slow or
 * failing fetch never flashes a note the operator already closed. The
 * data-source calls are defensive optional (`?.()`): unit stubs mount
 * partial ports, and demo mode simply keeps notes visible per session.
 */

import { Injectable, computed, inject, signal } from '@angular/core';

import { DATA_SOURCE, type IDataSourcePort } from './data-source/data-source.port';

@Injectable({ providedIn: 'root' })
export class DismissedNotesService {
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);

  private readonly loaded = signal(false);
  private readonly dismissed = signal<ReadonlySet<string>>(new Set());

  constructor() {
    void this.dataSource
      .getPreferences?.()
      .then((prefs) => {
        this.dismissed.set(new Set(prefs.ui?.dismissedNotes ?? []));
        this.loaded.set(true);
      })
      .catch(() => {
        // Best-effort: without the envelope, notes stay hidden (see doc).
      });
  }

  /** Reactive visibility for one note id (false only after a real load). */
  visible(id: string): ReturnType<typeof computed<boolean>> {
    return computed(() => this.loaded() && !this.dismissed().has(id));
  }

  /** Close a note: optimistic hide + machine-wide persist. */
  dismiss(id: string): void {
    const next = new Set(this.dismissed());
    next.add(id);
    this.dismissed.set(next);
    void this.dataSource
      .setPreferences?.({ ui: { dismissedNotes: [...next] } })
      .catch(() => {
        // Demo mode / dead server: the note stays hidden this session.
      });
  }
}
