/**
 * `IDataSourcePort`, the abstract data-source contract every concrete
 * implementation must satisfy. Mirrors the BFF surface, split by
 * domain into composed ports (`./ports/*.port.ts`):
 *
 *   - `ICorpusPort`   scan corpus reads + favorites (`corpus.port.ts`)
 *   - `IPluginsPort`  plugin catalog + toggles + trust (`plugins.port.ts`)
 *   - `ISettingsPort` preferences / ignore / lens / update (`settings.port.ts`)
 *   - `IActivityPort` live-activity + capture (`activity.port.ts`)
 *   - `IAgentPort`    agent-process-skill install management (`agent.port.ts`)
 *   - `IActionsPort`  sidecar-writing actions (`actions.port.ts`)
 *
 * plus `events()`, the cross-domain live channel, declared here on the
 * composition itself.
 *
 * Consumers keep injecting the COMPOSED port via the `DATA_SOURCE`
 * token, and every port / query / option type re-exports from this
 * module, so the split is invisible at the call sites; it exists so
 * each domain's contract (and its endpoint documentation) grows in its
 * own file instead of one 600-line interface, and so a consumer that
 * wants a narrower dependency can type against a single domain port.
 * The two adapters (`rest-data-source.ts`, `static-data-source.ts`)
 * stay single classes: they satisfy the whole composition, which is
 * exactly the BFF-mirror shape they exist to provide.
 *
 * The SPA depends on this port; the factory (`data-source.factory.ts`)
 * picks an implementation based on the runtime mode token.
 *
 * Type names use `*Port` for the abstract contracts and `I*` prefix for
 * option bags, per the project's type naming convention (AGENTS.md).
 */

import { InjectionToken } from '@angular/core';
import type { Observable } from 'rxjs';

import type { IWsEvent } from '../../models/ws-event';
import type { IActionsPort } from './ports/actions.port';
import type { IActivityPort } from './ports/activity.port';
import type { IAgentPort } from './ports/agent.port';
import type { ICorpusPort } from './ports/corpus.port';
import type { IJobsPort } from './ports/jobs.port';
import type { IPluginsPort } from './ports/plugins.port';
import type { ISettingsPort } from './ports/settings.port';

export type {
  ICorpusPort,
  INodesQuery,
  ILinksQuery,
  IIssuesQuery,
  TGraphFormat,
} from './ports/corpus.port';
export type { IPluginsPort, TPluginItem, IPluginChange } from './ports/plugins.port';
export type { IJobsPort, IJobsQuery } from './ports/jobs.port';
export type { ISettingsPort } from './ports/settings.port';
export type { IActivityPort } from './ports/activity.port';
export type { IAgentPort } from './ports/agent.port';
export type {
  IActionsPort,
  ISidecarBumpOpts,
  IActionDispatchOpts,
} from './ports/actions.port';

export interface IDataSourcePort
  extends ICorpusPort,
    IPluginsPort,
    ISettingsPort,
    IActivityPort,
    IAgentPort,
    IActionsPort,
    IJobsPort {
  /**
   * WebSocket-backed event stream. In live mode, returns the
   * `WsEventStreamService` multicast observable that connects to `/ws`
   * on first subscribe. In demo mode, returns `EMPTY` (no live updates
   *, the static bundle is immutable).
   *
   * Cross-domain by nature (scan, activity, sidecar, and action events
   * all ride the same socket), so it lives on the composition rather
   * than inside any single domain port.
   *
   * Consumers narrow events by `event.type`; unknown types MUST be
   * skipped silently per `spec/job-events.md` forward-compat rule.
   */
  events(): Observable<IWsEvent>;
}

/**
 * Injection token consumers use to resolve the active `IDataSourcePort`.
 * The factory (`dataSourceFactory`) provides this in `app.config.ts`.
 */
export const DATA_SOURCE = new InjectionToken<IDataSourcePort>('DATA_SOURCE');

/**
 * Error thrown by the data-source layer when the BFF returns an error
 * envelope (`{ ok: false, error: { code, message } }`) or when the
 * transport itself fails. The `code` mirrors the BFF's envelope code
 * so callers can branch on it.
 */
export class DataSourceError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'DataSourceError';
    this.code = code;
    this.details = details;
  }
}
