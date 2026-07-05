/**
 * Live spawn-relation state (`spec/provider-activity.md` §WS event:
 * `agent.spawn`).
 *
 * Consumes the pre-filtered `agentSpawn$` stream (plus the terminal
 * owner-scoped ends of `nodeActivity$`) and maintains the set of
 * spawns happening RIGHT NOW, which the graph view projects into
 * ephemeral dashed edges (parent agent -> child agent) and virtual
 * session anchors when the spawner is the main context.
 *
 * Edge lifetime is UI-owned, mirroring custody:
 *
 * - `phase: 'start'` draws (upserts by `spawnId`; frames are stateless
 *   and self-contained, so a late-joining `handoff` can also create).
 * - `phase: 'handoff'` consolidates (merges `childOwner` /
 *   `childNodePath` once the async child's identity is known).
 * - Release: the explicit `end` frame, OR the `node.activity`
 *   owner-scoped end whose `owner` equals `childOwner`, OR the sticky
 *   TTL sweep as the crash safety net. PAUSE IS NOT END (mirrors the
 *   custody rule in spec §WS event): Claude fires an owner-scoped stop
 *   when an agent merely pauses awaiting its own spawn, so a child
 *   owner's stop only releases when that owner PARENTS no live spawn;
 *   otherwise it counts as a heartbeat and the terminal stop (which
 *   arrives after every descendant unwound) does the release.
 * - Heartbeat: any activity signal from an owner refreshes the decay
 *   window of every spawn that owner participates in.
 *
 * Session anchors: a spawn whose frame carries NO `parentNodePath` was
 * spawned by a session (the structural discriminator, owner strings
 * are never parsed). Each distinct session owner gets a page-lifetime
 * ordinal ("Session 1", "Session 2", ...) so two parallel sessions
 * stay visually apart; the registry survives Real Time off/on cycles,
 * only F5 renumbers.
 *
 * While the Real Time preference is off the state clears and frames
 * drop (an effect watches the pref), mirroring `NodeActivityService`.
 *
 * Performance: frames buffer and flush once per animation frame; the
 * published arrays swap reference only when the flush actually
 * changed something.
 */

import { DestroyRef, Injectable, InjectionToken, effect, inject, signal } from '@angular/core';

import type { IWsAgentSpawnData, IWsNodeActivityData } from '../models/ws-event';
import { LivePreferencesService } from './live-preferences';
import { scheduleFrame } from './schedule-frame';
import { WsEventStreamService } from './ws-event-stream';

/**
 * Decay window for a spawn with no explicit end (a crashed runtime
 * that never sent the end frame / terminal stop). Mirrors the sticky
 * lifecycle window of `NodeActivityService`: spawns are meant to end
 * via their end frame or the child's owner-scoped end; the sweep is
 * only the safety net. Injectable so tests can shorten it.
 */
export const AGENT_SPAWN_TTL_MS = new InjectionToken<number>('AGENT_SPAWN_TTL_MS', {
  providedIn: 'root',
  factory: () => 5 * 60_000,
});

/** One live spawn, as the graph overlay consumes it. */
export interface ISpawnView {
  spawnId: string;
  parentOwner: string;
  /** Scanned parent agent's node path; `undefined` for session parents. */
  parentNodePath?: string;
  /**
   * Derived client-side: the session owner key when the spawner is a
   * session (`parentNodePath` absent on the wire). Never parsed, only
   * used as the session-anchor grouping key.
   */
  parentSession?: string;
  childKind?: string;
  childName?: string;
  childNodePath?: string;
  childOwner?: string;
}

/** One live session anchor (a main context that spawned something). */
export interface ISessionView {
  /** Opaque session owner key. */
  owner: string;
  /** Page-lifetime ordinal, drives the "Session N" label. */
  ordinal: number;
}

/** Internal entry: the view plus its decay bookkeeping. */
interface ISpawnEntry {
  view: ISpawnView;
  expiresAt: number;
}

@Injectable({ providedIn: 'root' })
export class AgentSpawnService {
  private readonly ttlMs = inject(AGENT_SPAWN_TTL_MS);
  private readonly prefs = inject(LivePreferencesService);
  private readonly destroyRef = inject(DestroyRef);

  /** Live spawns by spawnId. */
  private readonly entries = new Map<string, ISpawnEntry>();

  /**
   * Session owner -> ordinal, assigned on first sight and stable for
   * the page lifetime (NOT cleared on disable or when the last spawn
   * of a session ends, so a session that spawns again keeps its
   * number). F5 renumbers by design.
   */
  private readonly sessionOrdinals = new Map<string, number>();
  private nextSessionOrdinal = 1;

  /** Rule-9 coalescing buffers: frames land here, signals mutate once per frame. */
  private pendingSpawns: IWsAgentSpawnData[] = [];
  private pendingActivity: IWsNodeActivityData[] = [];
  private flushScheduled = false;
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly _spawnEdges = signal<readonly ISpawnView[]>([]);
  /** Live spawns, one per drawable (or countable) relation. */
  readonly spawnEdges = this._spawnEdges.asReadonly();

  private readonly _sessionNodes = signal<readonly ISessionView[]>([]);
  /** Session anchors with at least one live spawn, ordinal-sorted. */
  readonly sessionNodes = this._sessionNodes.asReadonly();

  constructor() {
    const events = inject(WsEventStreamService);
    const spawnSub = events.agentSpawn$.subscribe((event) => this.enqueueSpawn(event.data));
    const activitySub = events.nodeActivity$.subscribe((event) =>
      this.enqueueActivity(event.data),
    );
    this.destroyRef.onDestroy(() => {
      spawnSub.unsubscribe();
      activitySub.unsubscribe();
      if (this.sweepTimer !== null) clearTimeout(this.sweepTimer);
    });

    // Real Time off: drop everything immediately (the edges are live
    // signals, like the glow) and keep dropping frames while disabled.
    // The ordinal registry deliberately survives (see its docstring).
    effect(() => {
      if (this.prefs.activityEnabled()) return;
      this.pendingSpawns = [];
      this.pendingActivity = [];
      this.entries.clear();
      this.publish(Date.now());
    });
  }

  private enqueueSpawn(data: IWsAgentSpawnData): void {
    if (!this.prefs.activityEnabled()) return;
    this.pendingSpawns.push(data);
    this.scheduleFlush();
  }

  private enqueueActivity(data: IWsNodeActivityData): void {
    if (!this.prefs.activityEnabled()) return;
    // Only two shapes matter here: owner heartbeats and terminal
    // owner-scoped ends. Both need an owner; everything else is noise
    // for this service.
    if (data.owner === undefined) return;
    this.pendingActivity.push(data);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    scheduleFrame(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    const spawns = this.pendingSpawns;
    const activity = this.pendingActivity;
    this.pendingSpawns = [];
    this.pendingActivity = [];
    const now = Date.now();
    for (const data of spawns) {
      this.applySpawn(data, now);
    }
    for (const data of activity) {
      this.applyActivity(data, now);
    }
    this.publish(now);
  }

  private applySpawn(data: IWsAgentSpawnData, now: number): void {
    if (data.phase === 'end') {
      this.entries.delete(data.spawnId);
      return;
    }
    // `start` creates; `handoff` merges, but also creates when the
    // start was missed (frames are self-contained by contract, parent
    // fields repeat on every frame).
    const existing = this.entries.get(data.spawnId);
    const prev = existing?.view;
    const view: ISpawnView = {
      spawnId: data.spawnId,
      parentOwner: data.parentOwner,
      parentNodePath: data.parentNodePath ?? prev?.parentNodePath,
      childKind: data.childKind ?? prev?.childKind,
      childName: data.childName ?? prev?.childName,
      childNodePath: data.childNodePath ?? prev?.childNodePath,
      childOwner: data.childOwner ?? prev?.childOwner,
    };
    if (view.parentNodePath === undefined) {
      // Session parent (structural discriminator: no parent node).
      view.parentSession = data.parentOwner;
      if (!this.sessionOrdinals.has(data.parentOwner)) {
        this.sessionOrdinals.set(data.parentOwner, this.nextSessionOrdinal++);
      }
    }
    this.entries.set(data.spawnId, { view, expiresAt: now + this.ttlMs });
  }

  private applyActivity(data: IWsNodeActivityData, now: number): void {
    const owner = data.owner!;
    if (data.phase === 'end' && data.ownerScope === true) {
      // Pause is not end: an agent awaiting its own spawn fires the
      // SAME owner-scoped stop as a terminal one. While the stopping
      // owner still PARENTS a live spawn it is paused, not dead, so
      // the stop is a liveness signal (refresh) rather than a release.
      // The true terminal stop arrives after the whole descendant
      // chain unwound, when no child edge remains, and only then does
      // the owner's own spawn edge release, bottom-up like custody.
      let parentsLiveSpawn = false;
      for (const entry of this.entries.values()) {
        if (entry.view.parentOwner === owner) {
          parentsLiveSpawn = true;
          break;
        }
      }
      if (parentsLiveSpawn) {
        for (const entry of this.entries.values()) {
          const v = entry.view;
          if (v.childOwner === owner || v.parentOwner === owner) {
            entry.expiresAt = now + this.ttlMs;
          }
        }
        return;
      }
      for (const [spawnId, entry] of this.entries) {
        if (entry.view.childOwner === owner) this.entries.delete(spawnId);
      }
      return;
    }
    // Heartbeat: any signal from an owner proves its side of the
    // relation is alive; refresh every spawn it participates in.
    for (const entry of this.entries.values()) {
      const v = entry.view;
      if (v.childOwner === owner || v.parentOwner === owner) {
        entry.expiresAt = now + this.ttlMs;
      }
    }
  }

  /**
   * Drop expired entries, publish edges + sessions (only when they
   * actually changed, so OnPush consumers see no spurious writes), and
   * arm one sweep timer for the earliest remaining expiry.
   */
  private publish(now: number): void {
    let earliest = Number.POSITIVE_INFINITY;
    for (const [spawnId, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(spawnId);
        continue;
      }
      if (entry.expiresAt < earliest) earliest = entry.expiresAt;
    }

    const edges: ISpawnView[] = [];
    const sessionOwners = new Set<string>();
    for (const entry of this.entries.values()) {
      edges.push(entry.view);
      if (entry.view.parentSession !== undefined) sessionOwners.add(entry.view.parentSession);
    }
    const sessions: ISessionView[] = [...sessionOwners]
      .map((owner) => ({ owner, ordinal: this.sessionOrdinals.get(owner)! }))
      .sort((a, b) => a.ordinal - b.ordinal);

    if (!spawnListsEqual(this._spawnEdges(), edges)) this._spawnEdges.set(edges);
    if (!sessionListsEqual(this._sessionNodes(), sessions)) this._sessionNodes.set(sessions);

    if (this.sweepTimer !== null) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (earliest !== Number.POSITIVE_INFINITY) {
      this.sweepTimer = setTimeout(() => this.publish(Date.now()), earliest - now + 1);
    }
  }
}

/**
 * Shallow list equality by entry identity: `applySpawn` builds a new
 * view object on every mutation, so identity comparison is exact.
 */
function spawnListsEqual(a: readonly ISpawnView[], b: readonly ISpawnView[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sessionListsEqual(a: readonly ISessionView[], b: readonly ISessionView[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.owner !== b[i]!.owner || a[i]!.ordinal !== b[i]!.ordinal) return false;
  }
  return true;
}
