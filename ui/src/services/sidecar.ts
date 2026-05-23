/**
 * `SidecarService`, Step 9.6.5 UI half. Stateless wrapper around the
 * `POST /api/sidecar/bump` endpoint so consumers (the inspector bump
 * button) talk through one cohesive surface instead of importing the
 * data-source port directly.
 *
 * The matching WS subscription (`sidecar.bumped` → in-memory patch)
 * lives in `CollectionLoaderService` next to the `scan.completed`
 * subscription, the loader owns the node store, so every cross-cutting
 * mutator subscribes from inside rather than reaching in from here.
 *
 * Demo mode: `bumpSidecar()` rejects with `'demo-readonly'`. This
 * service stays inert by virtue of the rejection.
 */

import { Injectable, inject } from '@angular/core';

import {
  DATA_SOURCE,
  type IDataSourcePort,
  type ISidecarBumpOpts,
} from './data-source/data-source.port';
import type { ISidecarBumpedEnvelopeApi } from '../models/api';

export type { ISidecarBumpOpts } from './data-source/data-source.port';
export type { ISidecarBumpedEnvelopeApi } from '../models/api';

@Injectable({ providedIn: 'root' })
export class SidecarService {
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);

  /**
   * `POST /api/sidecar/bump`. Returns the success envelope on 200; throws
   * a `DataSourceError` on any 4xx/5xx (the caller branches on `code`).
   *
   * The success path does NOT manually update the local store, the
   * `sidecar.bumped` WS event broadcast by the BFF feeds the loader's
   * subscription (see `CollectionLoaderService` constructor), so the
   * card and inspector re-render via the same path the CLI / pre-commit
   * hook would trigger.
   */
  async bump(nodePath: string, opts: ISidecarBumpOpts = {}): Promise<ISidecarBumpedEnvelopeApi> {
    return this.dataSource.bumpSidecar(nodePath, opts);
  }
}
