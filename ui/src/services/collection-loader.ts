/**
 * `CollectionLoaderService`, top-level data store for the SPA.
 *
 * Lazy-loading refactor: the loader no longer hydrates the whole corpus
 * in one `/api/scan` round-trip. It fires THREE fetches in parallel at
 * boot and re-fires them on a WS `scan.completed` refresh:
 *
 *   1. `dataSource.loadScanMeta()` (`GET /api/scan?meta=1`), the scalar
 *      meta + `stats` counts with EMPTY node / link / issue arrays.
 *      Feeds the header and the scan-truncated / skipped-files banners
 *      via `scanMeta()`.
 *   2. `dataSource.loadFolders()` (`GET /api/folders`), the whole-corpus
 *      lite node list (`{ path, kind, linksInCount, linksOutCount,
 *      tokensTotal, modifiedAtMs, errorCount, warnCount }`). Feeds the
 *      folders tree, text search, kind filter, the per-folder severity
 *      badges, and the rail's leaf data columns via `liteNodes()` (and
 *      the projected `liteNodeViews()` the filter chain consumes).
 *   3. `dataSource.loadBranch([...selection])` (`GET /api/branch`), the
 *      server-capped UNION of the subtrees under the map SELECTION (the
 *      prefixes + leaf paths the rail checkboxes wrote into
 *      `MapVisibilityService`); an empty selection = whole corpus root.
 *      The graph map renders this via `branch()` and the projected
 *      `nodes()`.
 *
 * The map selection is the single map control. An `effect` watches
 * `MapVisibilityService.paths()` and DEBOUNCE-fetches the branch (~150ms)
 * so a burst of checkbox clicks fires one request; the meta + folders
 * stay cached. The whole corpus is never hydrated in one payload, and
 * folders are sent as PREFIXES (not expanded leaf sets) so the request
 * stays small.
 *
 * Surface kept stable for downstream views:
 *   - `scan()` is a synthetic `IScanResultApi` that fuses the cached
 *     `scanMeta()` scalars with the current `branch()` nodes / links /
 *     issues, so graph-side consumers (`resolveTopology`, `analyzeLinks`,
 *     `IssuePathsService`, the link-kind palette) read it unchanged. It
 *     is BRANCH-scoped: the graph shows exactly the fetched union.
 *   - `nodes()` is the `INodeView[]` projection of the current branch.
 *     The graph, its palettes, the inspector, and node-tags read it.
 *
 * Single-node detail (inspector) keeps its existing per-node lazy fetch
 * (`dataSource.getNode(path, { include: 'body' })`); the loader does not
 * change that path.
 *
 * Concurrency: a refresh (boot or WS) that arrives while one is already
 * in flight coalesces, `pendingRefresh = true` collapses N back-to-back
 * `scan.completed` events into at most one follow-up.
 */

import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, filter } from 'rxjs';

import type {
  INodeView,
  TFrontmatter,
  TSidecarStatus,
} from '../models/node';
import type {
  IBranchResponseApi,
  IFolderNodeLite,
  INodeApi,
  IScanResultApi,
} from '../models/api';
import { DATA_SOURCE, type IDataSourcePort } from './data-source/data-source.port';
import {
  compileOverridesToWire,
  overridesKey,
  type TOverrideMap,
} from './map-overrides';
import { MapVisibilityService } from './map-visibility';
import { WsEventStreamService } from './ws-event-stream';

/** Debounce (ms) collapsing a burst of selection checkbox clicks into one fetch. */
const SELECTION_FETCH_DEBOUNCE_MS = 150;

/**
 * Debounce for the `job.completed`-driven corpus refresh: an ALL run
 * drains several records in a burst; one trailing reload is enough (the
 * server folds are read-time, the last reload sees everything).
 */
const JOB_COMPLETED_REFRESH_DEBOUNCE_MS = 500;

/**
 * Qualified id of the built-in bump Action. The only `action.applied`
 * broadcast whose report the branch store can patch in place.
 */
const BUMP_ACTION_ID = 'core/node-bump';

/**
 * Read `annotations.version` off a `core/node-bump` report. Returns
 * `undefined` when the report does not carry a usable version, which
 * tells the caller to leave the branch untouched rather than stamping a
 * guess (the report shape is Action-defined and travels as `unknown`).
 */
function bumpedVersionOf(report: unknown): number | null | undefined {
  if (typeof report !== 'object' || report === null) return undefined;
  const version = (report as Record<string, unknown>)['version'];
  if (version === null) return null;
  return typeof version === 'number' ? version : undefined;
}

@Injectable({ providedIn: 'root' })
export class CollectionLoaderService {
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);
  private readonly wsEvents = inject(WsEventStreamService);
  private readonly selection = inject(MapVisibilityService);
  private readonly destroyRef = inject(DestroyRef);

  /** Scalar scan meta + stats (empty node / link / issue arrays). */
  private readonly _scanMeta = signal<IScanResultApi | null>(null);
  /** Whole-corpus lite node list (folders tree + filters source). */
  private readonly _liteNodes = signal<IFolderNodeLite[]>([]);
  /** Current branch payload (the graph map's node / link / issue set). */
  private readonly _branch = signal<IBranchResponseApi | null>(null);
  /** Projected branch nodes (the map's `INodeView[]`). */
  private readonly _branchNodes = signal<INodeView[]>([]);

  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  /**
   * Debounce handle for the selection-driven branch fetch. Cleared and
   * re-armed on every selection change so a burst of checkbox clicks
   * fires exactly one `/api/branch` round-trip. Cancelled on destroy.
   */
  private selectionFetchTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Serialized selection (`paths` joined) the loader last FETCHED. The
   * selection effect skips when the current selection still equals this,
   * so the effect's eager initial run does not double-fetch the branch
   * the boot `load()` already covered, and a no-op selection write never
   * re-fetches. Updated by every `load()` / `loadBranch()`.
   */
  private lastFetchedSelectionKey: string | null = null;

  /**
   * Coalesce flag: set to `true` when a refresh arrives mid-flight. The
   * in-flight `load()` checks the flag in its `finally` and fires
   * exactly one follow-up regardless of how many events came in.
   */
  private pendingRefresh = false;

  /**
   * `true` once the WS has opened at least once. Gates the reconnect
   * re-seed so the FIRST open (covered by the normal startup `load()`)
   * doesn't double-fetch; only subsequent re-opens trigger a refresh.
   */
  private wsConnectedBefore = false;

  // --- public signal surface ------------------------------------------------

  readonly scanMeta = this._scanMeta.asReadonly();
  readonly liteNodes = this._liteNodes.asReadonly();
  readonly branch = this._branch.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /**
   * The map's node set: the current branch projected to `INodeView[]`.
   * The graph view, its palettes, the inspector, and node-tags read
   * this. Carries `isFavorite` / `sidecar` / `tags` (the branch payload
   * decorates them; the lite folders list does not).
   */
  readonly nodes = this._branchNodes.asReadonly();

  /**
   * Synthetic `IScanResultApi` for the graph-side consumers that still
   * read `loader.scan()` (topology resolution, link analysis, issue
   * indexing). Fuses the cached `scanMeta()` scalars with the current
   * branch nodes / links / issues, so it is BRANCH-scoped: the graph
   * only ever shows one branch. `null` until the first meta lands.
   */
  readonly scan = computed<IScanResultApi | null>(() => {
    const meta = this._scanMeta();
    if (!meta) return null;
    const branch = this._branch();
    return {
      ...meta,
      nodes: branch?.nodes ?? [],
      links: branch?.links ?? [],
      issues: branch?.issues ?? [],
    };
  });

  /**
   * The whole-corpus lite node list projected into a minimal
   * `INodeView[]` (path + kind, empty frontmatter), so the existing
   * folders-tree + filter-chain machinery (`buildTree`,
   * `FilterStoreService.apply`) consumes it unchanged. Text search over
   * name / description / tags / favorites degrades to path + kind at the
   * rail level, the lite projection carries only those two fields; the
   * map (branch) keeps the full per-node search surface.
   */
  readonly liteNodeViews = computed<INodeView[]>(() =>
    this._liteNodes().map(projectLiteNode),
  );

  readonly count = computed(() => this._branchNodes().length);
  /** Whole-corpus node count, from the lite list. */
  readonly corpusCount = computed(() => this._liteNodes().length);

  /**
   * Per-kind buckets over the current branch, keyed by whatever kind
   * names the active Providers declared. Built dynamically so a
   * user-plugin Provider that introduces a new kind gets its own bucket
   * without code changes here.
   */
  readonly byKind = computed(() => {
    const buckets = new Map<string, INodeView[]>();
    for (const node of this._branchNodes()) {
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
   * `true` iff at least one node in the current BRANCH is favorited.
   * Drives the visibility of the kind-palette's "Favorites only" pill on
   * the map. Branch-scoped, mirroring the rest of the graph facets.
   */
  readonly hasAnyFavorites = computed(() =>
    this._branchNodes().some((n) => n.isFavorite === true),
  );

  constructor() {
    // Seed the last-fetched key to the CURRENT scope so the selection
    // effect's eager initial run is a no-op (the boot `load()` already
    // fetches this scope); only a genuine post-boot change re-fetches.
    this.lastFetchedSelectionKey = overridesKey(this.selection.overrides());

    // Live-mode reactive refresh: every `scan.completed` event re-fires
    // the three boot fetches. Demo mode's `events()` is `EMPTY` so the
    // subscription never fires.
    this.wsEvents.scanCompleted$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        void this.load();
      });

    // A completed job lands findings / summaries / tag write-throughs
    // whose read-time folds ride the node corpus (the card's aggregate
    // severity chips fold fresh open findings in on `/api/scan` /
    // `/api/branch`), so the corpus must refresh on `job.completed` too,
    // NOT only on scans (user report 2026-07-22: AI-action warnings
    // missing from the card until an F5). Debounced: a burst of records
    // (an ALL run draining) coalesces into one reload, and `load()`
    // itself coalesces concurrent refreshes.
    this.wsEvents.jobEvents$
      .pipe(
        filter((e) => e.type === 'job.completed'),
        debounceTime(JOB_COMPLETED_REFRESH_DEBOUNCE_MS),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        void this.load();
      });

    // `action.applied` stream applied directly to the in-memory branch
    // store (the loader owns the node list). Only `core/node-bump`
    // carries a sidecar version the branch can patch in place; every
    // other Action's report is opaque here, so it is ignored rather
    // than guessed at.
    this.wsEvents.actionApplied$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (event.data.actionId !== BUMP_ACTION_ID) return;
        const version = bumpedVersionOf(event.data.report);
        if (version === undefined) return;
        this.patchSidecarFromBump({
          nodePath: event.data.nodePath,
          version,
          status: 'fresh',
        });
      });

    // Re-seed on reconnect. `/ws` is a best-effort delta channel (the
    // server does not replay missed events), so a `scan.completed`
    // emitted while the socket was down is lost. On RE-STABILISE, run a
    // full `load()` to resync. The FIRST stable open is skipped (startup
    // already loads). Keyed on `stableConnected`, NOT raw `'open'`, so a
    // flapping connection does not storm the three fetches.
    effect(() => {
      if (!this.wsEvents.stableConnected()) return;
      if (this.wsConnectedBefore) void this.load();
      this.wsConnectedBefore = true;
    });

    // The map scope overrides drive the branch. A change to the rail's
    // checkbox state DEBOUNCE-fetches the scoped branch (~150ms) so a
    // burst of clicks fires one request. Skips when the scope still
    // matches what was last fetched (the effect's eager initial run and
    // the boot `load()` both leave that key set), so neither
    // double-fetches.
    effect(() => {
      const overrides = this.selection.overrides();
      if (overridesKey(overrides) === this.lastFetchedSelectionKey) return;
      if (this.selectionFetchTimer !== null) clearTimeout(this.selectionFetchTimer);
      this.selectionFetchTimer = setTimeout(() => {
        this.selectionFetchTimer = null;
        void this.loadBranch(overrides);
      }, SELECTION_FETCH_DEBOUNCE_MS);
    });

    this.destroyRef.onDestroy(() => {
      if (this.selectionFetchTimer !== null) clearTimeout(this.selectionFetchTimer);
    });
  }

  /**
   * Apply an optimistic favorite toggle to the in-memory branch store.
   * No-op when the path is not in the current branch.
   */
  setFavoriteLocal(path: string, value: boolean): void {
    this._branchNodes.update((nodes) => {
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
   * View-layer entry point, flips the card optimistically and fires
   * the matching `PUT/DELETE /api/favorites/:pathB64`. On failure the
   * local flag rolls back so the user sees the actual persisted state.
   * Returns the resolved final value (post-rollback if applicable).
   */
  async toggleFavorite(path: string, value: boolean): Promise<boolean> {
    this.setFavoriteLocal(path, value);
    try {
      if (value) await this.dataSource.setFavorite(path);
      else await this.dataSource.unsetFavorite(path);
      return value;
    } catch (err) {
      this.setFavoriteLocal(path, !value);
      const msg = err instanceof Error ? err.message : String(err);
      this._error.set(msg);
      return !value;
    }
  }

  patchSidecarFromBump(payload: { nodePath: string; version: number | null; status: 'fresh' }): void {
    this._branchNodes.update((nodes) => {
      let touched = false;
      const next = nodes.map((node) => {
        if (node.path !== payload.nodePath) return node;
        touched = true;
        const prev = node.sidecar;
        const annotations: Record<string, unknown> = {
          ...(prev?.annotations ?? {}),
        };
        if (payload.version !== null) annotations['version'] = payload.version;
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

  /**
   * Boot / refresh: fire the three lazy fetches in parallel. The meta +
   * folders re-prime the header / tree, and the branch re-renders the
   * current map selection (empty selection = whole-corpus root).
   * Coalesces concurrent refreshes.
   */
  async load(): Promise<void> {
    if (this._loading()) {
      this.pendingRefresh = true;
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    const overrides = this.selection.overrides();
    this.lastFetchedSelectionKey = overridesKey(overrides);
    try {
      const [meta, lite, branch] = await Promise.all([
        this.dataSource.loadScanMeta(),
        this.dataSource.loadFolders(),
        this.dataSource.loadBranch(compileOverridesToWire(overrides)),
      ]);
      this._scanMeta.set(meta);
      this._liteNodes.set(lite);
      this.applyBranch(branch);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._error.set(msg);
    } finally {
      this._loading.set(false);
      if (this.pendingRefresh) {
        this.pendingRefresh = false;
        queueMicrotask(() => {
          void this.load();
        });
      }
    }
  }

  /**
   * Re-fetch just the branch for the given override scope (the
   * debounced selection effect's worker). Keeps the cached meta +
   * folders. Shares the loading / coalesce bookkeeping with `load()` so
   * a scope change mid-boot does not race.
   */
  private async loadBranch(overrides: TOverrideMap): Promise<void> {
    if (this._loading()) {
      this.pendingRefresh = true;
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    this.lastFetchedSelectionKey = overridesKey(overrides);
    try {
      const branch = await this.dataSource.loadBranch(compileOverridesToWire(overrides));
      this.applyBranch(branch);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._error.set(msg);
    } finally {
      this._loading.set(false);
      if (this.pendingRefresh) {
        this.pendingRefresh = false;
        queueMicrotask(() => {
          void this.load();
        });
      }
    }
  }

  /** Set the branch payload + its projected node views in one write. */
  private applyBranch(branch: IBranchResponseApi): void {
    this._branch.set(branch);
    this._branchNodes.set(branch.nodes.map(projectNode));
  }
}


/**
 * Project a lite folders-list row into a minimal `INodeView`. The
 * `/api/folders` row carries no frontmatter / body, so the frontmatter
 * is stubbed with empty `name` / `description` so the filter chain +
 * tree builder run unchanged. It DOES carry the cheap scalar node
 * columns (`linksInCount` / `linksOutCount` / `tokensTotal` /
 * `modifiedAtMs`), so they flow through to the files-view rail's leaf
 * data columns. The wire shape uses `null` for "no value" (virtual /
 * derived nodes); `INodeView` uses `undefined`, so the nullable pair is
 * coerced.
 */
function projectLiteNode(lite: IFolderNodeLite): INodeView {
  const view: INodeView = {
    path: lite.path,
    kind: lite.kind,
    frontmatter: { name: '', description: '' } as TFrontmatter,
    linksInCount: lite.linksInCount,
    linksOutCount: lite.linksOutCount,
    tokensTotal: lite.tokensTotal ?? undefined,
    modifiedAtMs: lite.modifiedAtMs ?? undefined,
  };
  // Surface the sidecar drift status so the files rail flags staleness per
  // row (the stale-clock icon reads `node.sidecar`). Falsy (null, or an
  // absent field on an older payload) => no overlay, so the row reads as
  // not-stale; a non-empty status string is always truthy.
  if (lite.sidecarStatus) {
    view.sidecar = { present: true, status: lite.sidecarStatus as TSidecarStatus };
  }
  return view;
}

/**
 * Project a `INodeApi` (BFF / spec shape) into the `INodeView` consumed
 * by the graph / inspector / palettes. Body bytes are NOT projected, the
 * inspector fetches the body on demand. Catalog-curation 2026-05-07: no
 * synthesised `metadata` block, annotations live in the `.sm` sidecar.
 */
function projectNode(api: INodeApi): INodeView {
  const kind = api.kind;
  const frontmatter = (api.frontmatter ?? {}) as Partial<TFrontmatter>;
  const fm: TFrontmatter = {
    ...(frontmatter as Record<string, unknown>),
    name: typeof frontmatter.name === 'string' ? frontmatter.name : '',
    description:
      typeof frontmatter.description === 'string' ? frontmatter.description : '',
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
    modifiedAtMs: api.modifiedAtMs ?? undefined,
    bodyHash: api.bodyHash,
    frontmatterHash: api.frontmatterHash,
    isFavorite: api.isFavorite === true,
  };
  if (api.sidecar) view.sidecar = { ...api.sidecar };
  if (api.contributions) view.contributions = [...api.contributions];
  return view;
}
