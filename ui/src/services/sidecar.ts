/**
 * `SidecarService`, Step 9.6.5 UI half. Wraps the `POST /api/sidecar/bump`
 * endpoint and the `sidecar.bumped` WS event so consumers (the inspector
 * bump button, the card stale badge) talk to one cohesive surface.
 *
 * Responsibilities
 * ----------------
 *   - `bump(path, opts?)`, fire `POST /api/sidecar/bump` through the
 *     active data source and return the parsed envelope. Errors surface
 *     as `DataSourceError` so callers can branch on the BFF envelope code
 *     (`'sidecar-fresh'`, `'not-found'`, `'bad-query'`, ...).
 *   - On construction, subscribe to the BFF's WS stream and patch the
 *     in-memory node store via `CollectionLoaderService.patchSidecarFromBump`
 *     whenever a `sidecar.bumped` event lands. No full graph refetch,
 *     the inspector + card re-render reactively via Angular signals.
 *
 * The service is `providedIn: 'root'` and constructs eagerly on first
 * inject. The WS subscription is teardown-safe via `takeUntilDestroyed`.
 *
 * Demo mode: the data-source's `events()` returns `EMPTY` and `bumpSidecar()`
 * rejects with `'demo-readonly'`. The service stays inert in both cases.
 */

import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { CollectionLoaderService } from './collection-loader';
import {
  DATA_SOURCE,
  type IDataSourcePort,
  type ISidecarBumpOpts,
} from './data-source/data-source.port';
import { WsEventStreamService } from './ws-event-stream';
import type { ISidecarBumpedEnvelopeApi } from '../models/api';

export type { ISidecarBumpOpts } from './data-source/data-source.port';
export type { ISidecarBumpedEnvelopeApi } from '../models/api';

@Injectable({ providedIn: 'root' })
export class SidecarService {
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);
  private readonly wsEvents = inject(WsEventStreamService);
  private readonly loader = inject(CollectionLoaderService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Subscribe once to the typed `sidecar.bumped` stream and patch the
    // in-memory node store on every frame. Demo mode's stream is EMPTY
    // so this subscription completes immediately and never fires.
    this.wsEvents.sidecarBumped$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        this.loader.patchSidecarFromBump({
          nodePath: event.data.nodePath,
          version: event.data.version,
          status: event.data.status,
        });
      });
  }

  /**
   * `POST /api/sidecar/bump`. Returns the success envelope on 200; throws
   * a `DataSourceError` on any 4xx/5xx (the caller branches on `code`).
   *
   * The success path does NOT manually update the local store, the
   * `sidecar.bumped` WS event broadcast by the BFF feeds the same
   * subscription set up in the constructor, so the card and inspector
   * re-render via the same path the CLI / pre-commit hook would trigger.
   */
  async bump(nodePath: string, opts: ISidecarBumpOpts = {}): Promise<ISidecarBumpedEnvelopeApi> {
    return this.dataSource.bumpSidecar(nodePath, opts);
  }
}
