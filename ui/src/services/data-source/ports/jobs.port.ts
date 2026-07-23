/**
 * `IJobsPort`, the queue READ surface behind the workspace queue
 * inspector. Mirrors `GET /api/jobs?status=&extension=&node=`.
 *
 * One of the domain ports composed into `IDataSourcePort`
 * (`../data-source.port.ts`). Read-only by design: the cancel mutation
 * lives on `IActionsPort` (`cancelJob`), shared with the inspector
 * launcher's stop affordance, so a consumer never enqueues from here.
 */

import type { IJobApi, TJobStatusApi } from '../../../models/api';

/**
 * Query bag for `listJobs`, mirroring the `GET /api/jobs` filters. Every
 * field is optional; the BFF returns the whole queue when none are set.
 */
export interface IJobsQuery {
  /** Restrict to one lifecycle state. */
  status?: TJobStatusApi;
  /** Restrict to one qualified extension id (`<plugin>/<extension>`). */
  extension?: string;
  /** Restrict to one target node path. */
  node?: string;
}

export interface IJobsPort {
  /**
   * `GET /api/jobs`, the queue projection. Returns the registry-less
   * envelope's `items` (the `nonce`-stripped `PublicJob` rows); throws
   * `DataSourceError` on any 4xx/5xx so callers branch on `code`. Demo
   * mode returns `[]` (the static bundle has no queue).
   */
  listJobs(query?: IJobsQuery): Promise<IJobApi[]>;
}
