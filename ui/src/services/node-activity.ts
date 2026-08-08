/**
 * Live node activity state (`spec/provider-activity.md`).
 *
 * Consumes the pre-filtered `nodeActivity$` stream and maintains the
 * set of node paths that are executing RIGHT NOW, which the graph view
 * projects into the `.sm-gnode--executing` glow (and the lit edges of
 * the active spine).
 *
 * Span semantics live HERE, not in the BFF (the server is stateless by
 * design):
 *
 * - `phase: 'start'` marks `(nodePath, owner)` active and arms a TTL.
 *   Units with no native end signal (a Claude skill is only a ~10ms
 *   LOAD event; the following work is indistinguishable from the main
 *   context) decay when the TTL lapses. A repeated start refreshes it.
 * - `phase: 'end'` clears that owner's claim immediately (a subagent's
 *   matching `SubagentStop`). The node stays lit while OTHER owners
 *   still claim it (two instances of the same agent running at once).
 *
 * Performance (Foblex guardrails): inbound events buffer in a plain
 * array and flush ONCE per animation frame (the graph view's rule-9
 * drag-buffer pattern), so an event burst mutates the signal once, not
 * N times. The signal holds a `ReadonlySet<string>`; consumers do O(1)
 * `has()` lookups per node and only the cards whose class actually
 * flips re-render under OnPush.
 */

import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';

import type { IWsNodeActivityData } from '../models/ws-event';
import { LivePreferencesService } from './live-preferences';
import { scheduleFrame } from './schedule-frame';
import { WsEventStreamService } from './ws-event-stream';

/**
 * Decay window for MOMENTARY usage claims (a skill invocation, a
 * markdown read) with no native end signal. Long enough to cover a
 * typical turn segment, short enough that a stale glow never outlives
 * the operator's attention. Injectable so tests (and a future settings
 * knob) can shorten it.
 */
export const NODE_ACTIVITY_TTL_MS = new InjectionToken<number>('NODE_ACTIVITY_TTL_MS', {
  providedIn: 'root',
  factory: () => 12_000,
});

/**
 * Decay window for STICKY lifecycle claims (an agent's own span, a
 * parent held lit by a running child). These are meant to end via
 * owner-scoped ends; the long window is only a safety net against a
 * crashed runtime that never sends one. Kept refreshed by the owner
 * heartbeat while events flow.
 */
export const NODE_ACTIVITY_STICKY_TTL_MS = new InjectionToken<number>(
  'NODE_ACTIVITY_STICKY_TTL_MS',
  {
    providedIn: 'root',
    factory: () => 5 * 60_000,
  },
);

/**
 * Lifetime of a tool-INVOCATION edge (spec/provider-activity.md §WS
 * event: node.activity, the `detail` field), DECOUPLED from the node
 * glow. A slow MCP tool (a Notion create-page) fires its `PreToolUse`
 * start then runs for many seconds with NO further owner events, so the
 * mcp node's momentary glow (`NODE_ACTIVITY_TTL_MS`) decays mid-wait.
 * The edge must outlast that, so it carries its own generous window,
 * refreshed on a repeat invocation of the same target. Injectable so a
 * test (or a future setting) can shorten it.
 */
export const NODE_ACTIVITY_INVOCATION_TTL_MS = new InjectionToken<number>(
  'NODE_ACTIVITY_INVOCATION_TTL_MS',
  {
    providedIn: 'root',
    factory: () => 60_000,
  },
);

/** Owner bucket key for events that carry no `owner`. */
const ANONYMOUS_OWNER = '';

/**
 * Node-path scheme of an MCP server node (`spec/provider-activity.md`:
 * an `mcp://<server>` node is the target a live tool call lights). Used
 * to EXCLUDE mcp nodes when correlating the caller of a tool invocation:
 * the caller is a real unit (agent / skill), never another tool node.
 */
const MCP_NODE_PREFIX = 'mcp://';

/** One owner's hold on a node: when it decays, its window class, and how recently it lit. */
interface IClaim {
  expiresAt: number;
  ttlMs: number;
  /**
   * Monotonic sequence stamped when this (path, owner) claim was last
   * STARTED (a `phase: 'start'`), NOT bumped by a passive owner
   * heartbeat. Drives "most recently claimed" caller correlation: the
   * newest lit unit under the owner is the closest caller (an agent's
   * own start, or the skill it just ran). A sequence beats a timestamp
   * because a whole event burst flushes under one `Date.now()`, so
   * same-millisecond starts must still order by arrival.
   */
  claimedSeq: number;
}

/**
 * A live MCP tool invocation, correlated client-side
 * (`spec/provider-activity.md` §WS event: node.activity, the `detail`
 * field). The graph draws a transient labeled edge caller -> target.
 */
export interface INodeInvocation {
  /** The mcp target node path (the lit tool node). */
  target: string;
  /**
   * The correlated caller node path (the unit lit under the SAME owner,
   * most recently, excluding the target and any other mcp node), or
   * `null` when nothing else was lit (a bare main-session call). A null
   * caller draws no edge; the target still glows.
   */
  caller: string | null;
  /** The invoked tool, rendered as the edge label. */
  detail: string;
}

/**
 * Internal invocation bookkeeping: the published view plus the edge's
 * OWN decay window (independent of the node glow) and the owner that
 * opened it (so an owner-scope release drops its edges).
 */
interface IInvocationEntry {
  view: INodeInvocation;
  owner: string;
  expiresAt: number;
}

@Injectable({ providedIn: 'root' })
export class NodeActivityService {
  private readonly ttlMs = inject(NODE_ACTIVITY_TTL_MS);
  private readonly stickyTtlMs = inject(NODE_ACTIVITY_STICKY_TTL_MS);
  private readonly invocationTtlMs = inject(NODE_ACTIVITY_INVOCATION_TTL_MS);
  private readonly destroyRef = inject(DestroyRef);
  private readonly prefs = inject(LivePreferencesService);

  /**
   * Real-time activity preference (Settings → General), re-exposed so
   * the Settings toggle binds display state from the feature owner.
   */
  readonly enabled = this.prefs.activityEnabled;

  /** Per-path claims by owner. A path is active while any claim lives. */
  private readonly claims = new Map<string, Map<string, IClaim>>();

  /** Monotonic claim counter for "most recently started" caller correlation. */
  private claimSeq = 0;

  /**
   * Live tool invocations keyed by target (mcp) path
   * (`spec/provider-activity.md` §WS event: node.activity, the `detail`
   * field). Set on a detail-bearing `phase: 'start'` (caller correlated
   * against the claims at that instant), decoupled from the glow: each
   * entry carries its OWN `expiresAt` (`NODE_ACTIVITY_INVOCATION_TTL_MS`)
   * so a slow tool call keeps its edge even after the mcp node's glow
   * decayed. Pruned in `publish()` on its own expiry.
   */
  private readonly invocations = new Map<string, IInvocationEntry>();

  /**
   * Most-recent non-mcp unit seen per owner. Survives that unit's glow
   * decay, so `correlateCaller` can still name the caller when a slow
   * tool call arrives after a long gap that already expired the caller's
   * momentary claim. Cleaned on the owner's release / disable.
   */
  private readonly lastUnitByOwner = new Map<string, string>();

  /**
   * Owner -> session membership, recorded whenever a frame carries BOTH
   * `owner` and `session`. A node-less SESSION-scoped end
   * (`sessionScope: true` + `session`) releases every owner recorded
   * under that session, healing a live glow when a subagent's own
   * owner-scope end was dropped but its session end still arrived.
   * Cleaned per owner on release, wholesale on disable.
   */
  private readonly sessionByOwner = new Map<string, string>();

  /** Rule-9 coalescing buffer: events land here, the signal mutates once per frame. */
  private pending: IWsNodeActivityData[] = [];
  private flushScheduled = false;
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly _activePaths = signal<ReadonlySet<string>>(new Set());
  /** Node paths executing right now. Graph consumers do `activePaths().has(node.id)`. */
  readonly activePaths = this._activePaths.asReadonly();

  /**
   * Latest tool label per lit path (`spec/provider-activity.md`
   * §detail: unit frames may carry the literal invoking tool name).
   * Entries live exactly as long as the path stays in the active set;
   * `publish` sweeps the leavers.
   */
  private readonly detailByPath = new Map<string, string>();

  private readonly _executionDetails = signal<ReadonlyMap<string, string>>(new Map());
  /**
   * Literal tool name that lit each executing node, keyed by node path.
   * Consumers do `executionDetails().get(node.id)`; the map republishes
   * only when membership or a value actually changed (OnPush parity
   * with `activePaths`).
   */
  readonly executionDetails = this._executionDetails.asReadonly();

  private readonly _activeInvocations = signal<readonly INodeInvocation[]>([]);
  /**
   * Live tool invocations (caller -> target, with the tool label). An
   * entry appears when a detail-bearing start lands and lives on its OWN
   * TTL, independent of the target's glow (a slow tool keeps its edge
   * after the node stops glowing). The graph view projects each into a
   * transient labeled edge.
   */
  readonly activeInvocations = this._activeInvocations.asReadonly();

  constructor() {
    const events = inject(WsEventStreamService);
    const sub = events.nodeActivity$.subscribe((event) => this.enqueue(event.data));
    this.destroyRef.onDestroy(() => {
      sub.unsubscribe();
      if (this.sweepTimer !== null) clearTimeout(this.sweepTimer);
    });
  }

  /**
   * Flip the real-time activity preference AND apply it (the Settings
   * toggle's entry point). Turning it OFF darkens the map immediately:
   * buffered events drop, every claim releases, and the empty set
   * publishes in the same call. The WS subscription stays attached
   * (cheap) but `enqueue` discards frames while disabled.
   */
  setEnabled(enabled: boolean): void {
    this.prefs.setActivityEnabled(enabled);
    if (enabled) return;
    this.pending = [];
    this.claims.clear();
    this.invocations.clear();
    this.detailByPath.clear();
    this.lastUnitByOwner.clear();
    this.sessionByOwner.clear();
    this.publish(Date.now());
  }

  private enqueue(data: IWsNodeActivityData): void {
    if (!this.prefs.activityEnabled()) return;
    this.pending.push(data);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    scheduleFrame(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    const batch = this.pending;
    this.pending = [];
    const now = Date.now();
    for (const data of batch) {
      this.apply(data, now);
    }
    this.publish(now);
  }

  private apply(data: IWsNodeActivityData, now: number): void {
    const owner = data.owner ?? ANONYMOUS_OWNER;

    // Owner heartbeat: any signal from a context proves it is alive, so
    // every claim that owner already holds gets its window refreshed
    // (each to its own class), an actively-working chain never times
    // out mid-run even when a particular node stays quiet.
    if (data.owner !== undefined) {
      this.refreshOwnerClaims(owner, now);
    }

    // Session membership: a frame carrying both owner and session records
    // that owner under its session, so a later session-scoped end can
    // release the whole group.
    if (data.owner !== undefined && data.session !== undefined) {
      this.sessionByOwner.set(data.owner, data.session);
    }

    // Session-scoped end (the whole session ended): a node-less frame
    // with `sessionScope: true` + `session` releases EVERY owner grouped
    // under that session, healing a live glow whose owner-scope end was
    // dropped. Checked BEFORE the owner-scope branch; it carries no
    // nodePath and no owner of its own.
    if (data.phase === 'end' && data.sessionScope === true && data.session !== undefined) {
      const session = data.session;
      const owners = [...this.sessionByOwner.entries()]
        .filter(([, s]) => s === session)
        .map(([o]) => o);
      for (const sessionOwner of owners) {
        this.releaseOwnerEverywhere(sessionOwner);
      }
      return;
    }

    // Owner-scoped end (a subagent terminated, a conversation went
    // idle): the whole execution context goes dark, so EVERY claim that
    // owner holds is released, the agent node itself plus the skills it
    // invoked and the markdowns it read, instead of each waiting out
    // its decay. Checked FIRST because the node-less owner-release form
    // carries no nodePath at all.
    if (data.phase === 'end' && data.ownerScope === true && data.owner !== undefined) {
      this.releaseOwnerEverywhere(owner);
      return;
    }
    if (data.nodePath === undefined) return;
    if (data.phase === 'start') {
      const ttl = data.sticky === true ? this.stickyTtlMs : this.ttlMs;
      // A tool invocation: correlate the caller against the claims lit
      // RIGHT NOW (with a last-unit fallback), before the target's own
      // claim lands (the target is excluded by path either way). The
      // edge gets its OWN TTL, refreshed here on a repeat invocation.
      // Gated on the mcp:// target path, NOT on detail presence: unit
      // frames may also carry `detail` (the literal invoking tool name,
      // spec/provider-activity.md §detail) and those must never draw an
      // invocation edge.
      if (data.detail !== undefined && data.nodePath.startsWith(MCP_NODE_PREFIX)) {
        const caller = this.correlateCaller(data.nodePath, owner);
        this.invocations.set(data.nodePath, {
          view: { target: data.nodePath, caller, detail: data.detail },
          owner,
          expiresAt: now + this.invocationTtlMs,
        });
      }
      // Any detail-bearing start (unit or mcp) labels the lit card with
      // the literal tool name; the badge decays with the glow (swept in
      // `publish` when the path leaves the active set).
      if (data.detail !== undefined) {
        this.detailByPath.set(data.nodePath, data.detail);
      }
      // Track the most-recent NON-mcp unit for this owner so a later tool
      // call can still name its caller after the caller's glow decayed.
      if (!data.nodePath.startsWith(MCP_NODE_PREFIX)) {
        this.lastUnitByOwner.set(owner, data.nodePath);
      }
      const owners = this.claims.get(data.nodePath) ?? new Map<string, IClaim>();
      owners.set(owner, { expiresAt: now + ttl, ttlMs: ttl, claimedSeq: ++this.claimSeq });
      this.claims.set(data.nodePath, owners);
      return;
    }
    const owners = this.claims.get(data.nodePath);
    if (!owners) return;
    owners.delete(owner);
    if (owners.size === 0) this.claims.delete(data.nodePath);
  }

  /**
   * The caller of a tool invocation, excluding the `target` node itself
   * and any mcp node (a tool never calls a tool):
   *
   *   1. LIVE claims: the most recently STARTED non-mcp unit still lit
   *      under the SAME `owner`.
   *   2. FALLBACK: if none is lit (a slow tool call arrived after a gap
   *      that already decayed the caller's momentary claim), the last
   *      non-mcp unit recorded for the owner.
   *
   * For an AGENT caller this is effectively deterministic; for a SKILL
   * caller it is inferred (the skill lit under the same owner). Returns
   * `null` when nothing correlates (a bare main-session call), which
   * draws no edge.
   */
  private correlateCaller(target: string, owner: string): string | null {
    let caller: string | null = null;
    let bestSeq = -1;
    for (const [path, owners] of this.claims) {
      if (path === target) continue;
      if (path.startsWith(MCP_NODE_PREFIX)) continue;
      const claim = owners.get(owner);
      if (claim === undefined) continue;
      if (claim.claimedSeq > bestSeq) {
        bestSeq = claim.claimedSeq;
        caller = path;
      }
    }
    if (caller !== null) return caller;

    const last = this.lastUnitByOwner.get(owner);
    if (last !== undefined && last !== target && !last.startsWith(MCP_NODE_PREFIX)) {
      return last;
    }
    return null;
  }

  private refreshOwnerClaims(owner: string, now: number): void {
    for (const owners of this.claims.values()) {
      const claim = owners.get(owner);
      if (claim) claim.expiresAt = now + claim.ttlMs;
    }
  }

  private releaseOwnerEverywhere(owner: string): void {
    for (const [path, owners] of this.claims) {
      owners.delete(owner);
      if (owners.size === 0) this.claims.delete(path);
    }
    // The invocation edges this owner opened, and its last-unit memory,
    // go dark with it (a terminated context calls no more tools).
    for (const [target, entry] of this.invocations) {
      if (entry.owner === owner) this.invocations.delete(target);
    }
    this.lastUnitByOwner.delete(owner);
    this.sessionByOwner.delete(owner);
  }

  /**
   * Drop expired claims, publish the resulting active set (only when it
   * actually changed, so OnPush consumers see no spurious writes), and
   * arm one sweep timer for the earliest remaining expiry.
   */
  private publish(now: number): void {
    let earliest = Number.POSITIVE_INFINITY;
    const active = new Set<string>();
    for (const [path, owners] of this.claims) {
      for (const [owner, claim] of owners) {
        if (claim.expiresAt <= now) {
          owners.delete(owner);
          continue;
        }
        if (claim.expiresAt < earliest) earliest = claim.expiresAt;
        active.add(path);
      }
      if (owners.size === 0) this.claims.delete(path);
    }

    if (!setsEqual(active, this._activePaths())) {
      this._activePaths.set(active);
    }

    // Badge sweep: a detail label lives exactly as long as its path
    // glows. Republish only on a real change (OnPush discipline).
    for (const path of this.detailByPath.keys()) {
      if (!active.has(path)) this.detailByPath.delete(path);
    }
    if (!stringMapsEqual(this.detailByPath, this._executionDetails())) {
      this._executionDetails.set(new Map(this.detailByPath));
    }

    // Prune invocations on their OWN expiry (NOT the target's glow, so a
    // slow tool keeps its edge while the node stops glowing), folding
    // the survivors' expiries into the sweep window. Publish the
    // snapshot only when it changed (OnPush parity with activePaths).
    const invocations: INodeInvocation[] = [];
    for (const [target, entry] of this.invocations) {
      if (entry.expiresAt <= now) {
        this.invocations.delete(target);
        continue;
      }
      if (entry.expiresAt < earliest) earliest = entry.expiresAt;
      invocations.push(entry.view);
    }
    if (!invocationListsEqual(invocations, this._activeInvocations())) {
      this._activeInvocations.set(invocations);
    }

    if (this.sweepTimer !== null) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (earliest !== Number.POSITIVE_INFINITY) {
      this.sweepTimer = setTimeout(() => this.publish(Date.now()), earliest - now + 1);
    }
  }
}

function stringMapsEqual(
  a: ReadonlyMap<string, string>,
  b: ReadonlyMap<string, string>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

/**
 * Identity-based list equality: `apply` builds a new invocation `view`
 * object only when a target's invocation actually changes, so unchanged
 * entries keep their reference and identity comparison is exact.
 */
function invocationListsEqual(
  a: readonly INodeInvocation[],
  b: readonly INodeInvocation[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
