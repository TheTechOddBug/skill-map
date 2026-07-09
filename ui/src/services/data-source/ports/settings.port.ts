/**
 * `ISettingsPort`, the preferences / configuration surface: per-machine
 * preferences, project-scope preferences, `.skillmapignore`, the active
 * provider lens, and the update-check status. Mirrors
 * `/api/preferences`, `/api/project-preferences`, `/api/project-ignore`,
 * `/api/active-provider` (+ `/accept-markers`), `/api/update-status`.
 *
 * One of the domain ports composed into `IDataSourcePort`
 * (`../data-source.port.ts`).
 */

import type {
  IActiveProviderApi,
  IActiveProviderPutEnvelopeApi,
  IPreferencesApi,
  IPreferencesPatchApi,
  IProjectIgnoreApi,
  IProjectIgnorePatchApi,
  IProjectPreferencesApi,
  IProjectPreferencesPatchApi,
  IUpdateStatusResponseApi,
} from '../../../models/api';

export interface ISettingsPort {
  /**
   * Read the per-machine preferences envelope (today: `updateCheck.enabled`,
   * persisted at `~/.skill-map/settings.json`, the single home-reads
   * exception). Mirrors `GET /api/preferences`. Demo mode returns a
   * sensible default (no static fixture; the demo bundle is read-only).
   */
  getPreferences(): Promise<IPreferencesApi>;

  /**
   * Persist a partial patch of the per-machine preferences envelope.
   * Mirrors `PATCH /api/preferences`. Returns the post-write envelope
   * so the UI can replace its state in one shot. Throws
   * `DataSourceError` on 4xx / 5xx; demo mode rejects with
   * `code: 'demo-readonly'`.
   */
  setPreferences(patch: IPreferencesPatchApi): Promise<IPreferencesApi>;

  /**
   * Read the project-scope preferences envelope (today: the three
   * privacy-sensitive `scan.*` keys). Mirrors
   * `GET /api/project-preferences`. Demo mode returns the shipped
   * defaults so the Settings UI renders without errors.
   */
  getProjectPreferences(): Promise<IProjectPreferencesApi>;

  /**
   * Persist a partial patch of the project-scope preferences
   * envelope. Mirrors `PATCH /api/project-preferences`. Writes that
   * EXPAND a surface MUST set `confirm: true` in the patch body,
   * otherwise the BFF rejects with 412 `confirm-required` (surfaces
   * as `DataSourceError` with code `confirm-required` and a `paths`
   * field listing what the change would expose). Two surface-
   * expanding sub-keys ride this route: `scan.referencePaths` (disk
   * access outside the project) and `scan.followExternalSymlinks`
   * (following out-of-tree symlinks). Demo mode rejects every write
   * with `code: 'demo-readonly'`.
   */
  setProjectPreferences(patch: IProjectPreferencesPatchApi): Promise<IProjectPreferencesApi>;

  /**
   * Read the active `.skillmapignore` patterns (project-root file).
   * Mirrors `GET /api/project-ignore`. Comments and blank lines are
   * filtered server-side; only the active pattern list is on the
   * wire. Demo mode returns `{ patterns: [] }`.
   */
  getProjectIgnore(): Promise<IProjectIgnoreApi>;

  /**
   * Replace the active `.skillmapignore` patterns. Mirrors
   * `PATCH /api/project-ignore`. The server preserves any comments
   * and blank lines from the prior file; new patterns append at the
   * end. Validation (non-empty, no control chars, no duplicates) is
   * enforced server-side, the UI rejects locally too to give an
   * immediate error. Demo mode rejects with `code: 'demo-readonly'`.
   */
  setProjectIgnore(patch: IProjectIgnorePatchApi): Promise<IProjectIgnoreApi>;

  /**
   * Read the active provider lens envelope. Mirrors
   * `GET /api/active-provider`. Carries the resolved lens (always a
   * concrete id, `markdown` when no marker is present), the filesystem
   * auto-detected provider list, the source the value came from, and
   * `selectable` (the enabled Provider ids the dropdown may offer).
   * Used by the Settings UI's Project section to render the lens
   * dropdown. Demo mode returns
   * `{ activeProvider: 'markdown', detected: [], source: 'default', selectable: [] }`.
   */
  getActiveProvider(): Promise<IActiveProviderApi>;

  /**
   * Switch the active provider lens. Mirrors
   * `PUT /api/active-provider`. The server atomically drops the
   * scan_* DB zone after persisting the new lens (see
   * `spec/architecture.md` §Active Provider Lens), the response
   * envelope's `switch.dropped` field reports what was cleared so
   * the UI can prompt the operator to run `sm scan`. Demo mode
   * rejects with `code: 'demo-readonly'`.
   */
  setActiveProvider(activeProvider: string): Promise<IActiveProviderPutEnvelopeApi>;

  /**
   * Reconcile the persisted provider-marker snapshot with what the
   * filesystem currently shows, clearing any pending drift. Mirrors
   * `POST /api/active-provider/accept-markers` (no request body). Returns
   * the SAME refreshed `GET /api/active-provider` envelope, now with
   * `markerDrift: null`. This is the "Dismiss" action behind the
   * provider-marker drift notice: it clears the drift permanently and
   * only re-surfaces if a later, different marker change occurs. Demo
   * mode is a read-only no-op that returns the baked envelope unchanged.
   */
  acceptActiveProviderMarkers(): Promise<IActiveProviderApi>;

  /**
   * `GET /api/update-status`. Always 200 in live mode. Demo mode
   * returns a synthetic "up-to-date" snapshot so the topbar renders
   * cleanly without an `/api/*` round-trip.
   */
  getUpdateStatus(): Promise<IUpdateStatusResponseApi>;
}
