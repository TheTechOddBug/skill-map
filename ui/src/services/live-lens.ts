/**
 * `LiveLensService`, domain state for the graph's "Live lens" mode: a
 * toggleable observational lens that narrows the map to the nodes the
 * AI runtime is executing RIGHT NOW plus the recently-executed ones
 * inside a configurable linger window.
 *
 * Membership is a client-side WATERMARK, no server mutation involved:
 *
 *   liveSet = activePaths() ∪ { p : lastSeen(p) > max(now - windowMs, resetAt) }
 *   lastSeen(p) = max(stats().get(p)?.lastStartAt ?? 0, localLastActiveAt.get(p) ?? 0)
 *
 *   - `activePaths()` covers "executing right now" (a long-running
 *     agent's counted `lastStartAt` can predate any window, the union
 *     keeps it lit regardless).
 *   - `stats().lastStartAt` is the reactive recency source that
 *     survives a page refresh (hydrated from `GET /api/activity/summary`).
 *   - `localLastActiveAt` stamps the moment a path LEAVES the active
 *     set, covering the linger after a sticky claim whose counted start
 *     is stale (sticky counts once per owner, so `lastStartAt` alone
 *     under-reports long agents).
 *   - `resetAt` is the reset watermark: `reset()` stamps "now" and the
 *     accumulated recency clears client-side. Currently-executing nodes
 *     remain by definition (they ride `activePaths`), and any
 *     re-execution re-adds a node.
 *
 * `windowMs` defaults to 5 minutes; `Number.POSITIVE_INFINITY` is the
 * "no limit" mode where everything executed since the last reset
 * accumulates. The value persists per browser
 * (`sm.live.lens-window`, same habit-not-project-state reasoning as
 * `sm.live.follow-activity`); `active` and `resetAt` are deliberately
 * session-only, auto-restoring a narrowed canvas on boot would read as
 * "my map is gone".
 *
 * Expiry reactivity: ONE self-rearming `setTimeout` scheduled at the
 * earliest upcoming linger expiry (the `NodeActivityService.publish`
 * discipline), armed only while the lens is active in timed mode. The
 * timer bumps a tick signal the membership computed reads; membership
 * publishes a new Set only when it actually changed, so OnPush
 * consumers stay quiet through no-op re-evaluations.
 *
 * Curation-independent data: the lens shows every executing node in
 * the corpus, including ones the curated map excludes, so the service
 * keeps its own node / link cache fed by
 * `loadBranch({ include: [...membership], excludeRoot: true })`, the
 * same wire the curation compiler produces. Fetches fire only when the
 * membership contains an uncached path, debounced, always with the
 * FULL membership as the include list so the response carries the
 * links among every pair of live nodes (a missing-paths-only fetch
 * would drop cross-links to already-cached members). Cost is
 * proportional to the live set, never the corpus. A failed fetch is
 * swallowed: the lens is a progressive layer, the next membership
 * change retries.
 *
 * The service is the STATE seam only. Camera, layout, and the parallel
 * graph pipeline live in the graph view's `setupLiveLens` controller;
 * nothing here touches persisted positions, map views, or curation.
 */

import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';

import type { ILinkApi, INodeApi, IScanResultApi } from '../models/api';
import type { INodeView } from '../models/node';
import { AgentSpawnService } from './agent-spawn';
import { CollectionLoaderService, projectNode } from './collection-loader';
import { DATA_SOURCE, type IDataSourcePort } from './data-source/data-source.port';
import { SKILL_MAP_MODE } from './data-source/runtime-mode';
import { NodeActivityService } from './node-activity';
import { NodeActivityStatsService } from './node-activity-stats';

/** Default linger: alive while executing, plus 5 minutes after. */
export const LIVE_LENS_DEFAULT_WINDOW_MS = 5 * 60_000;

/** localStorage key for the per-browser window preference. */
const LENS_WINDOW_KEY = 'sm.live.lens-window';

/** Serialized form of the infinite window in localStorage. */
const INFINITE_SENTINEL = 'infinite';

/** Debounce collapsing a burst of membership growth into one fetch. */
const LENS_FETCH_DEBOUNCE_MS = 300;

/**
 * Prune horizon for the local departure stamps. Generously wider than
 * the default window so flipping 5 min -> infinite mid-session keeps
 * recent stamps; entries this old are covered by `stats().lastStartAt`
 * for every counted start anyway. Bounded by corpus size regardless.
 */
const LOCAL_STAMP_PRUNE_MS = 60 * 60_000;

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Safety cap on each observed-relation map. Relations are pruned only
 * by `reset()` (so flipping 5 min -> no-limit resurfaces older links,
 * "links that happened do not evaporate"), which leaves the maps
 * unbounded in a pathological session; past the cap the OLDEST entries
 * drop first. A few thousand distinct pairs is far beyond any real
 * project.
 */
const OBSERVED_RELATIONS_CAP = 2000;

/**
 * A link the lens actually SAW happen: an MCP invocation (caller ->
 * target, labeled with the tool) or an agent spawn (parent node ->
 * child node). Unlike the live overlays (60s invocation TTL, spawn
 * dies on its end frame), these persist under the lens watermark: they
 * stay rendered while both endpoints are lens members and their last
 * sighting is inside the window, and only `reset()` hard-clears them.
 */
export interface IObservedInvocation {
  /** Stable key, `<caller>>><target>` (the invocation-overlay idiom). */
  key: string;
  caller: string;
  target: string;
  /** Latest tool label seen for the pair. */
  label: string;
  lastSeenAt: number;
}

export interface IObservedSpawn {
  /** Stable key, `<parent>>><child>`. */
  key: string;
  parent: string;
  child: string;
  /** Latest live spawnId seen for the pair (the conversation-click anchor). */
  lastSpawnId: string;
  lastSeenAt: number;
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function linkKeyOf(link: ILinkApi): string {
  return `${link.source}|${link.target}|${link.kind}`;
}

/** Upsert into an observed-relation map with the oldest-first cap. */
function upsertObserved<T extends { lastSeenAt: number }>(
  map: ReadonlyMap<string, T>,
  key: string,
  value: T,
): Map<string, T> {
  const next = new Map(map);
  next.delete(key); // re-insert at the tail so Map order stays oldest-first
  next.set(key, value);
  if (next.size > OBSERVED_RELATIONS_CAP) {
    const oldest = next.keys().next().value;
    if (oldest !== undefined) next.delete(oldest);
  }
  return next;
}

@Injectable({ providedIn: 'root' })
export class LiveLensService {
  private readonly nodeActivity = inject(NodeActivityService);
  private readonly activityStats = inject(NodeActivityStatsService);
  private readonly agentSpawns = inject(AgentSpawnService);
  private readonly loader = inject(CollectionLoaderService);
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);
  private readonly mode = inject(SKILL_MAP_MODE);
  private readonly destroyRef = inject(DestroyRef);

  /** False in demo mode: the feature hides entirely (the WS stream is EMPTY). */
  readonly available = computed(() => this.mode !== 'demo');

  private readonly _active = signal(false);
  /** Lens on/off. Session-only by design (see module doc). */
  readonly active = this._active.asReadonly();

  private readonly _windowMs = signal<number>(readStoredWindow());
  /** Linger window in ms; `Number.POSITIVE_INFINITY` = accumulate until reset. */
  readonly windowMs = this._windowMs.asReadonly();

  /** Reset watermark (unix ms). 0 = never reset this session. */
  private readonly _resetAt = signal(0);

  /** Bumped by the expiry timer to force a membership re-evaluation. */
  private readonly expiryTick = signal(0);
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Unix-ms stamp per path of the moment it last LEFT the active set.
   * Local to the page lifetime; after a refresh the hydrated
   * `stats().lastStartAt` carries the recency side with slightly
   * coarser times.
   */
  private readonly _lastActiveAt = signal<ReadonlyMap<string, number>>(new Map());

  /**
   * Observed-relation memories (see the interfaces above). Stamped by
   * always-on effects so entering the lens shows links from just
   * before the toggle; pruned ONLY by the safety cap and read-filtered
   * by the watermark, so flipping the window to no-limit resurfaces
   * older sightings instead of losing them (unlike the node departure
   * stamps, these have no server-side recency to fall back on).
   */
  private readonly _observedInvocations = signal<ReadonlyMap<string, IObservedInvocation>>(
    new Map(),
  );
  private readonly _observedSpawns = signal<ReadonlyMap<string, IObservedSpawn>>(new Map());
  /** Cached links whose BOTH endpoints executed together, keyed `source|target`. */
  private readonly _observedSpinePairs = signal<
    ReadonlyMap<string, { source: string; target: string; lastSeenAt: number }>
  >(new Map());

  /** Corpus-wide node cache for the lens (curation-independent). */
  private readonly _nodeCache = signal<ReadonlyMap<string, INodeApi>>(new Map());
  /** Links seen among live nodes, cumulative, keyed by source|target|kind. */
  private readonly _linkCache = signal<ReadonlyMap<string, ILinkApi>>(new Map());

  private fetchTimer: ReturnType<typeof setTimeout> | null = null;
  private fetching = false;
  private pendingFetch = false;

  /**
   * The live set (see module doc for the watermark formula). Empty
   * while the lens is off, so every downstream computed collapses
   * cheaply. Custom equality keeps Set identity across no-op
   * re-evaluations (OnPush discipline).
   */
  readonly membership = computed<ReadonlySet<string>>(
    () => {
      if (!this._active()) return EMPTY_SET;
      this.expiryTick();
      const active = this.nodeActivity.activePaths();
      const stats = this.activityStats.stats();
      const local = this._lastActiveAt();
      const floor = this.floorAt(Date.now());
      const next = new Set(active);
      for (const [path, s] of stats) {
        if (s.lastStartAt > floor) next.add(path);
      }
      for (const [path, at] of local) {
        if (at > floor) next.add(path);
      }
      return next;
    },
    { equal: setsEqual },
  );

  /**
   * Lens node views, sorted by path so the downstream topology
   * fingerprint is stable under Set iteration order. Paths whose fetch
   * is still in flight are simply absent for a beat; the cache write
   * re-ticks this computed.
   */
  readonly lensNodes = computed<INodeView[]>(() => {
    const membership = this.membership();
    const cache = this._nodeCache();
    const views: INodeView[] = [];
    for (const path of [...membership].sort()) {
      const api = cache.get(path);
      if (api) views.push(projectNode(api));
    }
    return views;
  });

  /**
   * Synthetic branch-shaped scan for the lens pipeline: the cached
   * `scanMeta()` scalars fused with the live nodes and the cached links
   * whose BOTH endpoints are live (same trick as `loader.scan()`).
   * Issues stay empty: the lens narrates activity, not diagnostics, and
   * its filter stub never reads the severity index.
   */
  readonly lensScan = computed<IScanResultApi | null>(() => {
    const meta = this.loader.scanMeta();
    if (!meta) return null;
    const membership = this.membership();
    const cache = this._nodeCache();
    const nodes: INodeApi[] = [];
    for (const path of [...membership].sort()) {
      const api = cache.get(path);
      if (api) nodes.push(api);
    }
    const links: ILinkApi[] = [];
    for (const link of this._linkCache().values()) {
      if (membership.has(link.source) && membership.has(link.target)) links.push(link);
    }
    return { ...meta, nodes, links, issues: [] };
  });

  /**
   * Observed MCP invocations currently visible on the lens: sighted
   * inside the watermark AND both endpoints are members (an expired
   * node takes its links with it). Empty while the lens is off. These
   * REPLACE the live invocation overlay in lens mode, so the edge and
   * its label survive the 60s live TTL instead of evaporating.
   */
  readonly observedInvocations = computed<readonly IObservedInvocation[]>(() => {
    if (!this._active()) return [];
    this.expiryTick();
    const membership = this.membership();
    const floor = this.floorAt(Date.now());
    const out: IObservedInvocation[] = [];
    for (const inv of this._observedInvocations().values()) {
      if (inv.lastSeenAt <= floor) continue;
      if (!membership.has(inv.caller) || !membership.has(inv.target)) continue;
      out.push(inv);
    }
    return out;
  });

  /**
   * Observed node-to-node spawns under the same visibility rule. In
   * lens mode these keep the dashed spawn edge (or the spawn-active
   * dress on the hosting static edge) after the live spawn ended.
   */
  readonly observedSpawns = computed<readonly IObservedSpawn[]>(() => {
    if (!this._active()) return [];
    this.expiryTick();
    const membership = this.membership();
    const floor = this.floorAt(Date.now());
    const out: IObservedSpawn[] = [];
    for (const spawn of this._observedSpawns().values()) {
      if (spawn.lastSeenAt <= floor) continue;
      if (!membership.has(spawn.parent) || !membership.has(spawn.child)) continue;
      out.push(spawn);
    }
    return out;
  });

  /**
   * `source|target` keys of static links whose both endpoints were
   * seen executing TOGETHER, filtered like the other relations. In
   * lens mode the executing-spine treatment stays on these edges
   * permanently instead of switching off with the live glow.
   */
  readonly observedSpinePairs = computed<ReadonlySet<string>>(
    () => {
      if (!this._active()) return EMPTY_SET;
      this.expiryTick();
      const membership = this.membership();
      const floor = this.floorAt(Date.now());
      const out = new Set<string>();
      for (const [key, pair] of this._observedSpinePairs()) {
        if (pair.lastSeenAt <= floor) continue;
        if (!membership.has(pair.source) || !membership.has(pair.target)) continue;
        out.add(key);
      }
      return out;
    },
    { equal: setsEqual },
  );

  constructor() {
    // Departure stamps: when a path leaves the active set, record the
    // moment so the linger window has a truthful anchor for claims
    // whose counted start is stale. Always on (cheap), so entering the
    // lens immediately shows activity from before the toggle.
    let prevActive: ReadonlySet<string> = new Set();
    effect(() => {
      const current = this.nodeActivity.activePaths();
      const departed: string[] = [];
      for (const path of prevActive) {
        if (!current.has(path)) departed.push(path);
      }
      prevActive = current;
      if (departed.length === 0) return;
      const now = Date.now();
      this._lastActiveAt.update((map) => {
        const next = new Map(map);
        for (const path of departed) next.set(path, now);
        for (const [path, at] of next) {
          if (now - at > LOCAL_STAMP_PRUNE_MS) next.delete(path);
        }
        return next;
      });
    });

    // Lens state invariant: Real Time off means no frames, an active
    // lens would be a dead canvas lying about liveness. The graph
    // controller reacts to the flip for its camera restore.
    effect(() => {
      if (!this.nodeActivity.enabled() && this._active()) this._active.set(false);
    });

    // Observed-relation stamps (always-on, like the departure stamps).
    // Re-running while a relation stays live keeps refreshing its
    // sighting, so the frozen stamp IS the departure time.
    effect(() => {
      const invocations = this.nodeActivity.activeInvocations();
      if (invocations.length === 0) return;
      const now = Date.now();
      this._observedInvocations.update((map) => {
        let next: Map<string, IObservedInvocation> | null = null;
        for (const inv of invocations) {
          if (inv.caller === null) continue; // bare main-session call, no edge
          const key = `${inv.caller}>>${inv.target}`;
          next = upsertObserved(next ?? map, key, {
            key,
            caller: inv.caller,
            target: inv.target,
            label: inv.detail,
            lastSeenAt: now,
          });
        }
        return next ?? map;
      });
    });

    effect(() => {
      const spawns = this.agentSpawns.spawnEdges();
      if (spawns.length === 0) return;
      const now = Date.now();
      this._observedSpawns.update((map) => {
        let next: Map<string, IObservedSpawn> | null = null;
        for (const spawn of spawns) {
          const parent = spawn.parentNodePath;
          const child = spawn.childNodePath;
          // Node-to-node only: session anchors and unresolved capsules
          // are overlay chrome without a stable scanned endpoint.
          if (parent === undefined || child === undefined) continue;
          const key = `${parent}>>${child}`;
          next = upsertObserved(next ?? map, key, {
            key,
            parent,
            child,
            lastSpawnId: spawn.spawnId,
            lastSeenAt: now,
          });
        }
        return next ?? map;
      });
    });

    // Spine sightings: a cached link whose both endpoints execute
    // together. Bounded by the link cache (which only ever holds links
    // among live nodes), so the scan is tiny.
    effect(() => {
      const active = this.nodeActivity.activePaths();
      if (active.size < 2) return;
      const links = this._linkCache();
      if (links.size === 0) return;
      const now = Date.now();
      // Untracked self-read: this effect WRITES the map below, so a
      // tracked read of it here would re-trigger the effect on its own
      // write, an infinite loop.
      const current = untracked(() => this._observedSpinePairs());
      let next: Map<string, { source: string; target: string; lastSeenAt: number }> | null =
        null;
      for (const link of links.values()) {
        if (!active.has(link.source) || !active.has(link.target)) continue;
        next = upsertObserved(next ?? current, `${link.source}|${link.target}`, {
          source: link.source,
          target: link.target,
          lastSeenAt: now,
        });
      }
      if (next) this._observedSpinePairs.set(next);
    });

    // Single self-rearming expiry timer (timed mode only): wake at the
    // earliest upcoming linger expiry, bump the tick, re-evaluate.
    // Reading `expiryTick` re-runs this effect after each firing so the
    // next-earliest deadline re-arms.
    effect(() => {
      this.expiryTick();
      this.clearExpiryTimer();
      if (!this._active()) return;
      const windowMs = this._windowMs();
      if (windowMs === Number.POSITIVE_INFINITY) return;
      const active = this.nodeActivity.activePaths();
      const stats = this.activityStats.stats();
      const local = this._lastActiveAt();
      const resetAt = this._resetAt();
      const now = Date.now();
      const floor = Math.max(now - windowMs, resetAt);
      let earliest = Number.POSITIVE_INFINITY;
      const consider = (path: string, lastSeen: number): void => {
        if (active.has(path)) return; // no expiry while executing
        if (lastSeen <= floor) return; // already outside the window
        earliest = Math.min(earliest, lastSeen + windowMs);
      };
      for (const [path, s] of stats) consider(path, this.lastSeenOf(path, s.lastStartAt, local));
      for (const [path, at] of local) {
        if (!stats.has(path)) consider(path, at);
      }
      // Observed relations expire on their own clock too: a link can
      // age out of the window while both its endpoints stay members
      // (the nodes re-executed, the link did not recur).
      const considerStamp = (lastSeen: number): void => {
        if (lastSeen <= floor) return;
        earliest = Math.min(earliest, lastSeen + windowMs);
      };
      for (const inv of this._observedInvocations().values()) considerStamp(inv.lastSeenAt);
      for (const spawn of this._observedSpawns().values()) considerStamp(spawn.lastSeenAt);
      for (const pair of this._observedSpinePairs().values()) considerStamp(pair.lastSeenAt);
      if (earliest === Number.POSITIVE_INFINITY) return;
      const delay = Math.max(earliest - now, 0) + 16;
      this.expiryTimer = setTimeout(() => {
        this.expiryTimer = null;
        this.expiryTick.update((t) => t + 1);
      }, delay);
    });

    // Membership growth fetch: any live path missing from the cache
    // schedules a debounced full-membership branch fetch.
    effect(() => {
      const membership = this.membership();
      const cache = this._nodeCache();
      let missing = false;
      for (const path of membership) {
        if (!cache.has(path)) {
          missing = true;
          break;
        }
      }
      if (!missing) return;
      if (this.fetchTimer !== null) clearTimeout(this.fetchTimer);
      this.fetchTimer = setTimeout(() => {
        this.fetchTimer = null;
        void this.fetchLiveNodes();
      }, LENS_FETCH_DEBOUNCE_MS);
    });

    this.destroyRef.onDestroy(() => {
      this.clearExpiryTimer();
      if (this.fetchTimer !== null) clearTimeout(this.fetchTimer);
    });
  }

  setActive(value: boolean): void {
    if (!this.available()) return;
    if (this._active() === value) return;
    this._active.set(value);
  }

  setWindow(ms: number): void {
    if (this._windowMs() === ms) return;
    this._windowMs.set(ms);
    writeStoredWindow(ms);
  }

  /**
   * Clear the accumulated canvas: everything whose recency predates
   * this moment drops out. Client-only watermark, never mutates the
   * server accumulator. Executing nodes stay by definition.
   */
  reset(): void {
    this._resetAt.set(Date.now());
  }

  private lastSeenOf(
    path: string,
    lastStartAt: number,
    local: ReadonlyMap<string, number>,
  ): number {
    return Math.max(lastStartAt, local.get(path) ?? 0);
  }

  /** The watermark floor: recency at or below it is outside the lens. */
  private floorAt(now: number): number {
    const windowMs = this._windowMs();
    const resetAt = this._resetAt();
    return windowMs === Number.POSITIVE_INFINITY ? resetAt : Math.max(now - windowMs, resetAt);
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  /**
   * Fetch the FULL current membership as an include-scoped branch and
   * fold the response into both caches. Coalesces: a membership change
   * mid-flight queues exactly one follow-up.
   */
  private async fetchLiveNodes(): Promise<void> {
    if (this.fetching) {
      this.pendingFetch = true;
      return;
    }
    const membership = this.membership();
    if (membership.size === 0) return;
    this.fetching = true;
    try {
      const branch = await this.dataSource.loadBranch({
        include: [...membership].sort(),
        exclude: [],
        excludeRoot: true,
      });
      this._nodeCache.update((cache) => {
        const next = new Map(cache);
        for (const node of branch.nodes) next.set(node.path, node);
        return next;
      });
      if (branch.links.length > 0) {
        this._linkCache.update((cache) => {
          const next = new Map(cache);
          for (const link of branch.links) next.set(linkKeyOf(link), link);
          return next;
        });
      }
    } catch (err) {
      console.warn('live-lens: fetching live nodes failed', err);
    } finally {
      this.fetching = false;
      if (this.pendingFetch) {
        this.pendingFetch = false;
        queueMicrotask(() => {
          void this.fetchLiveNodes();
        });
      }
    }
  }
}

function readStoredWindow(): number {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LENS_WINDOW_KEY);
  } catch {
    return LIVE_LENS_DEFAULT_WINDOW_MS;
  }
  if (raw === INFINITE_SENTINEL) return Number.POSITIVE_INFINITY;
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : LIVE_LENS_DEFAULT_WINDOW_MS;
}

function writeStoredWindow(ms: number): void {
  try {
    localStorage.setItem(
      LENS_WINDOW_KEY,
      ms === Number.POSITIVE_INFINITY ? INFINITE_SENTINEL : String(ms),
    );
  } catch {
    // Quota exceeded or storage blocked, swallow (matches the other
    // preference services).
  }
}
