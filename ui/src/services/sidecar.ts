/**
 * `SidecarService` — Step 9.6.5 UI half. Wraps the `POST /api/sidecar/bump`
 * endpoint and the `sidecar.bumped` WS event so consumers (the inspector
 * bump button, the card stale badge) talk to one cohesive surface.
 *
 * Responsibilities
 * ----------------
 *   - `bump(path, opts?)` — fire `POST /api/sidecar/bump` and return
 *     the parsed envelope. Errors surface as `DataSourceError` so callers
 *     can branch on the BFF envelope code (`'sidecar-fresh'`, `'not-found'`,
 *     `'bad-query'`, …).
 *   - On construction, subscribe to the BFF's WS stream and patch the
 *     in-memory node store via `CollectionLoaderService.patchSidecarFromBump`
 *     whenever a `sidecar.bumped` event lands. No full graph refetch —
 *     the inspector + card re-render reactively via Angular signals.
 *
 * The service is `providedIn: 'root'` and constructs eagerly on first
 * inject. The WS subscription is teardown-safe via `takeUntilDestroyed`.
 *
 * Demo mode: the data-source's `events()` returns `EMPTY` and `bump()`
 * is never wired into the demo bundle; the service stays inert.
 */

import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';

import { CollectionLoaderService } from './collection-loader';
import { DATA_SOURCE, type IDataSourcePort, DataSourceError } from './data-source/data-source.port';
import type { IErrorEnvelopeApi } from '../models/api';
import {
  isSidecarBumpedEvent,
  type IWsSidecarBumpedEvent,
} from '../models/ws-event';

/**
 * Successful 200 envelope returned by `POST /api/sidecar/bump`.
 * Mirrors `src/server/routes/sidecar.ts:ISidecarBumpedEnvelope`.
 */
export interface ISidecarBumpedEnvelopeApi {
  schemaVersion: '1';
  kind: 'sidecar.bumped';
  value: {
    nodePath: string;
    version: number | null;
    status: 'fresh';
  };
  elapsedMs: number;
}

export interface ISidecarBumpOpts {
  /**
   * When true, force the bump on a fresh node (silent no-op per the
   * Action spec). UI default at 9.6.5 is `false` — the bump button is
   * disabled when the overlay reports `fresh`.
   */
  force?: boolean;
  /**
   * Consent for `.sm` sidecar writes in this project. The BFF gates the
   * first `.sm` write behind `allowEditSmFiles` (default `false`); when
   * the flag is still `false` and `confirm` is omitted / `false`, the
   * server answers 412 with `code: 'confirm-required'` and details
   * `{ key: 'allowEditSmFiles' }`. Callers re-issue with `confirm: true`
   * after the user has accepted the consent dialog; the server flips
   * the flag to `true` in `.skill-map/settings.local.json` (gitignored,
   * per-checkout) and proceeds with the bump.
   *
   * Omitted (`undefined`) is the normal first attempt; the field is
   * only added to the body when explicitly set so demo / fixture
   * captures stay clean.
   */
  confirm?: boolean;
}

@Injectable({ providedIn: 'root' })
export class SidecarService {
  private readonly http = inject(HttpClient);
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);
  private readonly loader = inject(CollectionLoaderService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Subscribe once to the BFF's WS stream and patch the in-memory
    // node store on every `sidecar.bumped` frame. Demo mode's `events()`
    // is `EMPTY` so this subscription completes immediately and never
    // fires.
    this.dataSource
      .events()
      .pipe(
        filter((event): boolean => isSidecarBumpedEvent(event)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        const e = event as unknown as IWsSidecarBumpedEvent;
        this.loader.patchSidecarFromBump({
          nodePath: e.data.nodePath,
          version: e.data.version,
          status: e.data.status,
        });
      });
  }

  /**
   * `POST /api/sidecar/bump`. Returns the success envelope on 200; throws
   * a `DataSourceError` on any 4xx/5xx (the caller branches on `code`).
   *
   * The success path does NOT manually update the local store — the
   * `sidecar.bumped` WS event broadcast by the BFF feeds the same
   * subscription set up in the constructor, so the card and inspector
   * re-render via the same path the CLI / pre-commit hook would trigger.
   */
  async bump(nodePath: string, opts: ISidecarBumpOpts = {}): Promise<ISidecarBumpedEnvelopeApi> {
    const body: Record<string, unknown> = { nodePath };
    if (opts.force !== undefined) body['force'] = opts.force;
    if (opts.confirm !== undefined) body['confirm'] = opts.confirm;
    try {
      return await firstValueFrom(
        this.http.post<ISidecarBumpedEnvelopeApi>('/api/sidecar/bump', body),
      );
    } catch (err) {
      throw translateError(err);
    }
  }
}

function translateError(err: unknown): DataSourceError {
  if (err instanceof DataSourceError) return err;
  if (err instanceof HttpErrorResponse) {
    const envelope = parseErrorEnvelope(err.error);
    if (envelope) {
      return new DataSourceError(
        envelope.error.code,
        envelope.error.message,
        envelope.error.details,
      );
    }
    return new DataSourceError('internal', err.message || 'Request failed.');
  }
  const message = err instanceof Error ? err.message : String(err);
  return new DataSourceError('internal', message);
}

function parseErrorEnvelope(value: unknown): IErrorEnvelopeApi | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v['ok'] !== false) return null;
  const err = v['error'];
  if (typeof err !== 'object' || err === null) return null;
  const e = err as Record<string, unknown>;
  if (typeof e['code'] !== 'string' || typeof e['message'] !== 'string') return null;
  return {
    ok: false,
    error: {
      code: e['code'],
      message: e['message'],
      details: e['details'],
    },
  };
}
