/**
 * `CollectionLoaderService` — top-level node store for the SPA.
 *
 * Step 14.3.a refactor: the service no longer fetches a runtime corpus
 * directly. It delegates to the injected `IDataSourcePort` (which talks
 * to the BFF in live mode, or to a precomputed bundle in demo mode at
 * 14.3.b). The exposed signals (`nodes`, `loading`, `error`, `count`,
 * `byKind`) keep their pre-refactor surface so list / graph / inspector
 * views consume them unchanged.
 *
 * Step 14.4.b reactive refresh: in live mode, the loader subscribes to
 * `dataSource.events()` and re-runs `load()` whenever a `scan.completed`
 * event lands. List / graph / inspector views re-render automatically
 * because they read from the `nodes()` / `scan()` signals.
 *
 * Concurrency: a refresh that arrives while one is already in flight
 * coalesces — `pending = true` is set, and the in-flight resolution
 * triggers a single follow-up. This avoids the "every event fires a new
 * `loadScan`" pile-up during a large workspace scan that emits multiple
 * `scan.completed` envelopes (single-node scans, in-flight reconnect
 * replays, etc.).
 *
 * The full `IScanResultApi` is also exposed via `scan()` so consumers
 * that need `links` / `issues` / `stats` (graph-view today; future
 * inspector cards) can read them without a second round-trip.
 *
 * Projection from `INodeApi` to `INodeView` (Step 14.5.a — slimmer):
 *   - `path`, `kind`, `frontmatter` come straight from the BFF row.
 *   - `body` is intentionally NOT projected here. The Inspector view
 *     fetches it on-demand via `dataSource.getNode(path, {includeBody: true})`
 *     because `/api/scan` doesn't ship body bytes (kernel persists
 *     `body_hash` only — see `src/server/node-body.ts` for rationale).
 *     List / graph / kind-palette never read the body, so paying the
 *     `fs.readFile` per row would be pure waste.
 *   - `mockSummary` was dropped at Step 14.5.a — it derived from
 *     `description` / `title` (already rendered in the inspector
 *     header) and the card it fed was a placeholder waiting for the
 *     real summarizer (LLM, wave 2). The header carries the same info.
 */

import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';

import type {
  INodeView,
  TFrontmatter,
} from '../models/node';
import type { INodeApi, IScanResultApi } from '../models/api';
import { DATA_SOURCE, type IDataSourcePort } from './data-source/data-source.port';

@Injectable({ providedIn: 'root' })
export class CollectionLoaderService {
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _nodes = signal<INodeView[]>([]);
  private readonly _scan = signal<IScanResultApi | null>(null);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  /**
   * Coalesce flag: set to `true` when a refresh arrives mid-flight. The
   * in-flight `load()` checks the flag in its `finally` and fires
   * exactly one follow-up regardless of how many events came in.
   */
  private pendingRefresh = false;

  readonly nodes = this._nodes.asReadonly();
  readonly scan = this._scan.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly count = computed(() => this._nodes().length);
  /**
   * Per-kind buckets — keyed by whatever kind names the active Providers
   * declared (Step 14.5.d). Built dynamically from the loaded nodes so a
   * user-plugin Provider that introduces a new kind (`'cursorRule'`,
   * `'daily'`, …) gets its own bucket without code changes here.
   */
  readonly byKind = computed(() => {
    const buckets = new Map<string, INodeView[]>();
    for (const node of this._nodes()) {
      const list = buckets.get(node.kind);
      if (list) {
        list.push(node);
      } else {
        buckets.set(node.kind, [node]);
      }
    }
    return buckets;
  });

  /**
   * `true` iff at least one node in the current collection is favorited.
   * Drives the visibility of the filter-bar's "Favorites only" toggle —
   * the toggle hides while no favorite exists so the filter row stays
   * uncluttered for first-time users (per the brief: "que no se muestre
   * el corazón si no hay favoritos"). The filter-store's
   * `favoritesOnly` signal stays orthogonal — when the toggle was on
   * and the user un-favorites the last node, the toggle should remain
   * visible long enough to let them turn it off; the filter-bar OR's
   * the two signals to avoid trapping the user with an empty list.
   */
  readonly hasAnyFavorites = computed(() =>
    this._nodes().some((n) => n.isFavorite === true),
  );

  constructor() {
    // Live-mode reactive refresh: every `scan.completed` event triggers
    // a re-fetch. Demo mode's `events()` is `EMPTY` so the subscription
    // immediately completes and never fires.
    //
    // We DON'T filter on `extractor.completed` / `rule.completed` /
    // `scan.progress` — re-fetching mid-scan would thrash the views
    // for no perceived benefit (the next `scan.completed` carries the
    // settled snapshot). Future work: per-Issue incremental updates
    // via `issue.added` / `issue.resolved` once the BFF emits them.
    this.dataSource
      .events()
      .pipe(
        filter((event) => event.type === 'scan.completed'),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        // Fire-and-forget — load() handles its own errors via the
        // `error()` signal. We don't await here because the subject's
        // `next` is synchronous and we don't want to block its dispatch
        // on a network round-trip.
        void this.load();
      });
  }

  /**
   * Step 9.6.5 — apply a `sidecar.bumped` WS event to the in-memory
   * node store without a full graph refetch. Sets the matching node's
   * `sidecar.status` to `'fresh'`, marks `present: true`, and updates
   * the `annotations.version`. No-op when the path is unknown — late
   * frames after a navigation away are tolerated.
   */
  /**
   * Apply an optimistic favorite toggle to the in-memory store. Used
   * internally by `toggleFavorite` to flip the card before the network
   * round-trip resolves; also exposed for tests and for any future
   * caller that needs to sync local state from a server-pushed event.
   * No-op when the path is unknown (defensive against stale event
   * references).
   */
  setFavoriteLocal(path: string, value: boolean): void {
    this._nodes.update((nodes) => {
      let touched = false;
      const next = nodes.map((node) => {
        if (node.path !== path) return node;
        if (node.isFavorite === value) return node;
        touched = true;
        return { ...node, isFavorite: value };
      });
      return touched ? next : nodes;
    });
  }

  /**
   * View-layer entry point — flips the card optimistically and fires
   * the matching `PUT/DELETE /api/favorites/:pathB64`. On failure the
   * local flag rolls back so the user sees the actual persisted state.
   * Returns the resolved final value (post-rollback if applicable) so
   * specs can assert on the outcome.
   */
  async toggleFavorite(path: string, value: boolean): Promise<boolean> {
    this.setFavoriteLocal(path, value);
    try {
      if (value) await this.dataSource.setFavorite(path);
      else await this.dataSource.unsetFavorite(path);
      return value;
    } catch (err) {
      // Roll back the optimistic flip and surface the error on the
      // shared `error()` signal so the toast / status bar can pick it
      // up. We don't re-throw — the caller (view) doesn't need to
      // handle it; the user sees the un-flip and the error toast.
      this.setFavoriteLocal(path, !value);
      const msg = err instanceof Error ? err.message : String(err);
      this._error.set(msg);
      return !value;
    }
  }

  patchSidecarFromBump(payload: { nodePath: string; version: number | null; status: 'fresh' }): void {
    this._nodes.update((nodes) => {
      let touched = false;
      const next = nodes.map((node) => {
        if (node.path !== payload.nodePath) return node;
        touched = true;
        const prev = node.sidecar;
        const annotations: Record<string, unknown> = {
          ...(prev?.annotations ?? {}),
        };
        if (payload.version !== null) annotations['version'] = payload.version;
        // R15 closure (2026-05-07) — preserve the parsed `root`
        // overlay across bump patches. The WS event only carries the
        // new version number; everything else (`for.*`, `audit.*`,
        // plugin namespaces) stays as the BFF last shipped it.
        return {
          ...node,
          sidecar: {
            present: true,
            status: payload.status,
            annotations,
            ...(prev?.root === undefined ? {} : { root: prev.root }),
          },
        };
      });
      return touched ? next : nodes;
    });
  }

  async load(): Promise<void> {
    if (this._loading()) {
      // A refresh is in flight. Mark as pending so the in-flight load's
      // `finally` fires exactly one follow-up. This collapses N
      // back-to-back `scan.completed` events into at most one extra
      // round-trip per in-flight load.
      this.pendingRefresh = true;
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    try {
      const scan = await this.dataSource.loadScan();
      this._scan.set(scan);
      this._nodes.set(scan.nodes.map(projectNode));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._error.set(msg);
    } finally {
      this._loading.set(false);
      if (this.pendingRefresh) {
        this.pendingRefresh = false;
        // Defer to a microtask so the loading/false notification flushes
        // through any sync subscribers before the next `load()` flips
        // it back to true.
        queueMicrotask(() => {
          void this.load();
        });
      }
    }
  }
}

/**
 * Project a `INodeApi` (BFF / spec shape) into the `INodeView` shape
 * consumed by list / graph / inspector views. Body bytes are NOT in
 * the projection — see the file-level docstring for the rationale.
 *
 * Catalog curation 2026-05-07: the loader no longer synthesises a
 * `metadata: {...}` block on the projected frontmatter. The canonical
 * home for skill-map-invented annotation fields (version, stability,
 * tags, …) is the `.sm` sidecar surfaced via `view.sidecar.annotations`.
 * Legacy `.md` files that still carry a top-level `metadata:` block
 * flow through unchanged via `additionalProperties: true` on the base
 * schema — consumers that need the legacy fallback read it through the
 * frontmatter's index signature (`(fm['metadata'] as Record<string,
 * unknown>)?.[…]`).
 */
function projectNode(api: INodeApi): INodeView {
  // Step 14.5.d: kinds are open per Provider. The UI no longer collapses
  // unknown kinds to `'note'` — the registry resolves rendering by kind
  // name, so the projection passes the value through unchanged.
  const kind = api.kind;
  const frontmatter = (api.frontmatter ?? {}) as Partial<TFrontmatter>;
  const fm: TFrontmatter = {
    ...(frontmatter as Record<string, unknown>),
    name: typeof frontmatter.name === 'string' ? frontmatter.name : api.title ?? '',
    description:
      typeof frontmatter.description === 'string'
        ? frontmatter.description
        : api.description ?? '',
  } as TFrontmatter;

  const view: INodeView = {
    path: api.path,
    kind,
    provider: api.provider,
    frontmatter: fm,
    linksOutCount: api.linksOutCount,
    linksInCount: api.linksInCount,
    externalRefsCount: api.externalRefsCount,
    bytesTotal: api.bytes?.total,
    tokensTotal: api.tokens?.total,
    bodyHash: api.bodyHash,
    frontmatterHash: api.frontmatterHash,
    isFavorite: api.isFavorite === true,
  };
  if (api.sidecar) view.sidecar = { ...api.sidecar };
  return view;
}
