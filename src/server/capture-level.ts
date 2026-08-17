/**
 * Capture-level ladder (spec `provider-activity.md` §Capture level): the
 * operator's ONE knob for how much runtime activity skill-map keeps,
 * applied LIVE at the ingest seam. Cumulative rungs, each including the
 * ones below:
 *
 *   1 `executions` - unit runs, spawns, custody / lifecycle claims,
 *                    turn and session bounds (the mandatory floor:
 *                    everything else correlates to these).
 *   2 `reads`      - `access: 'read'` frames.
 *   3 `writes`     - `access: 'write'` frames.
 *   4 `mcp`        - `access: 'mcp'` frames. THE DEFAULT, matching the
 *                    full surface the hooks have always fed.
 *   5 `shell`      - RESERVED: no capture exists yet, and when it lands
 *                    it additionally requires an install-side opt-in.
 *
 * The filter runs on RESOLVED frames before stats, run history,
 * conversation capture, the session journal and the WS broadcast: below
 * the level, the event did not happen for skill-map, so Real Time and
 * every recording see the same truth. The level persists in the
 * `activity.captureLevel` project-LOCAL config key (read at boot) and
 * moves live via `POST /api/activity/capture-level`.
 */

import type { INodeActivityEventData } from './events.js';

export const CAPTURE_LEVELS = ['executions', 'reads', 'writes', 'mcp', 'shell'] as const;

export type TCaptureLevel = (typeof CAPTURE_LEVELS)[number];

/** The historical full surface: everything the hooks capture today. */
export const DEFAULT_CAPTURE_LEVEL: TCaptureLevel = 'mcp';

/** 1-based rank of each level (the ladder's cumulative order). */
const RANK: Record<TCaptureLevel, number> = {
  executions: 1,
  reads: 2,
  writes: 3,
  mcp: 4,
  shell: 5,
};

export function isCaptureLevel(value: unknown): value is TCaptureLevel {
  return typeof value === 'string' && (CAPTURE_LEVELS as readonly string[]).includes(value);
}

export function captureLevelRank(level: TCaptureLevel): number {
  return RANK[level];
}

/**
 * Rank of one resolved `node.activity` frame: frames WITHOUT an access
 * class (unit runs, custody, lifecycle, turn / session bounds) are the
 * `executions` floor; resource frames rank as their access class.
 * Spawn frames never reach this (they are `executions` by definition).
 */
export function activityFrameRank(data: INodeActivityEventData): number {
  if (data.access === undefined) return RANK.executions;
  if (data.access === 'read') return RANK.reads;
  if (data.access === 'write') return RANK.writes;
  if (data.access === 'shell') return RANK.shell;
  return RANK.mcp;
}

/**
 * Live holder of the active level. A tiny mutable cell (not a service
 * class): the ingest route reads it per frame, the capture-level route
 * writes it, the composition root seeds it from config at boot.
 */
export class CaptureLevelState {
  private level: TCaptureLevel;

  constructor(initial: TCaptureLevel) {
    this.level = initial;
  }

  current(): TCaptureLevel {
    return this.level;
  }

  currentRank(): number {
    return RANK[this.level];
  }

  set(level: TCaptureLevel): void {
    this.level = level;
  }

  /** Whether a resolved activity frame passes the active level. */
  passes(data: INodeActivityEventData): boolean {
    return activityFrameRank(data) <= RANK[this.level];
  }
}
