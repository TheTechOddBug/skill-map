/**
 * `IMapViewsPort`, the named map-views surface (`spec/map-views.md`):
 * committed `.skill-map/views/<slug>.json` documents capturing the
 * map's visibility overrides plus manually pinned node positions.
 * Mirrors `/api/map-views` and `/api/map-views/:slug`.
 *
 * One of the domain ports composed into `IDataSourcePort`
 * (`../data-source.port.ts`).
 */

import type { IMapViewApi, IMapViewsEnvelopeApi } from '../../../models/api';

export interface IMapViewsPort {
  /**
   * List every readable view. Mirrors `GET /api/map-views`, which reads
   * the `views/` directory fresh on every request; a file that fails
   * parse or schema validation lands in `skipped` (basename) instead of
   * failing the list. Demo mode returns an empty envelope (the static
   * bundle ships no views).
   */
  getMapViews(): Promise<IMapViewsEnvelopeApi>;

  /**
   * Create or replace one view (upsert, last-write-wins; git is the
   * merge and review layer). Mirrors `PUT /api/map-views/:slug`; the
   * body is the FULL MapView document and the server re-serializes it
   * into the canonical form (`spec/map-views.md` §Canonical
   * serialization), round-tripping `groups` verbatim. Response is the
   * refreshed `GET` envelope. Throws `DataSourceError` on 4xx / 5xx;
   * demo mode rejects with `code: 'demo-readonly'`.
   */
  putMapView(slug: string, view: IMapViewApi): Promise<IMapViewsEnvelopeApi>;

  /**
   * Remove one view file. Mirrors `DELETE /api/map-views/:slug`
   * (malformed slug 400 `bad-query`, absent slug 404 `not-found`).
   * Response is the refreshed `GET` envelope. Demo mode rejects with
   * `code: 'demo-readonly'`.
   */
  deleteMapView(slug: string): Promise<IMapViewsEnvelopeApi>;
}
