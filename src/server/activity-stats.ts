/**
 * In-memory per-node execution-stats accumulator (see
 * `spec/provider-activity.md` §Execution stats). Process lifetime only:
 * instantiated once in `createServer`, reset on every boot, never
 * persisted (no `scan_*` / `state_*` writes).
 *
 * Counting semantics (normative in the spec):
 *
 *   - Only node-attributed `phase: 'start'` payloads count. Ends,
 *     node-less owner releases and relation-only spawns never mutate.
 *   - `keepAlive` starts NEVER count and never touch the owner sets:
 *     custody is not an execution.
 *   - `sticky` starts count ONCE per `(nodePath, owner)` pair.
 *   - Everything else (skill invocations, command expansions, markdown
 *     reads) counts on every signal.
 *
 * Every bound below saturates or evicts oldest entries; hitting a cap
 * never errors and never blocks ingestion.
 */

import type { INodeActivityEventData, INodeActivityStats } from './events.js';

/** Distinct-owner set cap per node; the count saturates here. */
export const DISTINCT_OWNERS_CAP = 256;

/**
 * Global cap on the sticky `(nodePath, owner)` dedupe memory, evicting
 * oldest-first past it. Deliberately generous: one entry per agent
 * INSTANCE per node, and a serve session sees at most a few hundred.
 */
export const STICKY_DEDUPE_CAP = 1024;

/** Per-node recent-executions ring size (most recent first). */
const RECENT_RING_SIZE = 20;

/** One recent-execution entry; `owner` absent on ownerless starts. */
export interface IActivityRecentEntry {
  at: number;
  owner?: string;
}

/** Per-node detail projection for the inspector endpoint. */
export interface IActivityNodeDetail {
  stats: INodeActivityStats;
  /** Most recent first, bounded by the ring size. */
  recent: IActivityRecentEntry[];
}

interface INodeStatsState {
  count: number;
  lastStartAt: number;
  lastOwner: string | undefined;
  owners: Set<string>;
  recent: IActivityRecentEntry[];
}

export class ActivityStatsService {
  /** Unix-ms boot timestamp, the `since` of every summary snapshot. */
  readonly sinceMs = Date.now();

  private readonly nodes = new Map<string, INodeStatsState>();

  /**
   * Sticky dedupe memory, APPEND-ONLY by design: runtimes re-emit
   * lifecycle starts on pause/resume with the SAME owner id, and a
   * resume is not a new execution, so owners are NOT forgotten on
   * `ownerScope` ends (forgetting would recount every pause/resume
   * cycle). A fresh instance has a fresh owner id and counts again.
   * Insertion order doubles as age for the oldest-first eviction.
   */
  private readonly stickySeen = new Set<string>();

  /**
   * Apply one resolved `node.activity` payload. Returns a COPY of the
   * node's stats when the start counted, `null` when the payload never
   * mutates state (no node, an end, a keep-alive custody claim, or a
   * sticky pause/resume duplicate).
   */
  record(data: INodeActivityEventData): INodeActivityStats | null {
    if (data.nodePath === undefined || data.phase !== 'start') return null;
    if (data.keepAlive === true) return null;
    if (data.sticky === true && data.owner !== undefined) {
      if (!this.claimStickyOnce(data.nodePath, data.owner)) return null;
    }
    return this.count(data.nodePath, data.owner);
  }

  /** Summary projection: every tracked node's stats, all copies. */
  snapshot(): Record<string, INodeActivityStats> {
    const out: Record<string, INodeActivityStats> = {};
    for (const [path, state] of this.nodes) {
      out[path] = projectStats(state);
    }
    return out;
  }

  /**
   * Per-node detail for the inspector endpoint. A node with no
   * recorded activity yields zeroed stats (the route's "scanned but
   * quiet" shape); copies either way.
   */
  nodeDetail(path: string): IActivityNodeDetail {
    const state = this.nodes.get(path);
    if (!state) {
      return { stats: { count: 0, lastStartAt: 0, distinctOwners: 0 }, recent: [] };
    }
    return { stats: projectStats(state), recent: state.recent.map((entry) => ({ ...entry })) };
  }

  /** `true` when this `(nodePath, owner)` pair counts (first sighting). */
  private claimStickyOnce(nodePath: string, owner: string): boolean {
    const key = `${nodePath}\n${owner}`;
    if (this.stickySeen.has(key)) return false;
    this.stickySeen.add(key);
    if (this.stickySeen.size > STICKY_DEDUPE_CAP) {
      const oldest = this.stickySeen.values().next().value;
      if (oldest !== undefined) this.stickySeen.delete(oldest);
    }
    return true;
  }

  private count(nodePath: string, owner: string | undefined): INodeActivityStats {
    const state = this.nodes.get(nodePath) ?? {
      count: 0,
      lastStartAt: 0,
      lastOwner: undefined,
      owners: new Set<string>(),
      recent: [],
    };
    this.nodes.set(nodePath, state);
    state.count += 1;
    state.lastStartAt = Date.now();
    state.lastOwner = owner;
    if (owner !== undefined && state.owners.size < DISTINCT_OWNERS_CAP) {
      state.owners.add(owner);
    }
    const entry: IActivityRecentEntry = { at: state.lastStartAt };
    if (owner !== undefined) entry.owner = owner;
    state.recent.unshift(entry);
    if (state.recent.length > RECENT_RING_SIZE) state.recent.pop();
    return projectStats(state);
  }
}

function projectStats(state: INodeStatsState): INodeActivityStats {
  const stats: INodeActivityStats = {
    count: state.count,
    lastStartAt: state.lastStartAt,
    distinctOwners: state.owners.size,
  };
  if (state.lastOwner !== undefined) stats.lastOwner = state.lastOwner;
  return stats;
}
