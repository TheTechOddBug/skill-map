/**
 * Session-journal reader + observed-relations fold (the scan-time half of
 * `spec/provider-activity.md` §Session journal).
 *
 * `readSessionJournal(sessionsDir)` loads every `.skill-map/sessions/*.json`
 * recording, AJV-validating each file against
 * `spec/schemas/session-recording.schema.json` and SKIPPING off-shape files
 * silently: the journal is disposable machine data (Storage rule, fifth
 * home), so a corrupt or future-shaped file must never take a scan down,
 * the same posture the client recorder's hydrate takes.
 *
 * `foldObservedRelations(recordings)` collapses the recordings into the
 * observed `(source, target)` pairs the `core/observed-link-missing`
 * analyzer compares against the declared link graph. Two relation shapes
 * are folded (v1 scope, reads deliberately deferred as noisy):
 *
 *   - `invokes`: a `node.activity` start with `access: 'mcp'` (an MCP tool
 *     call landing on an `mcp://` node), attributed to its CALLING unit by
 *     owner: the last non-MCP unit node the same owner started. This
 *     mirrors the client fold's caller correlation
 *     (`ui/src/services/activity-playback-state.ts`, `correlateCaller`;
 *     cross-referenced both ways) in the simplified form a linear
 *     journal walk affords: frames arrive in order, so "the owner's most
 *     recent unit claim" is a single map overwrite.
 *   - `spawns`: an `agent.spawn` frame carrying BOTH `parentNodePath` and
 *     `childNodePath` (a scanned agent spawning a scanned child), counted
 *     ONCE per `spawnId` per recording (the start / handoff / end trio of
 *     one spawn merges, like the client session index).
 *
 * The fold is pure over the recordings (deterministic input -> output);
 * only the reader touches the filesystem. Both run in the driving adapter
 * BEFORE `runScan`, which threads the folded map through
 * `RunScanOptions.observedRelations` into `IAnalyzerContext.observedRelations`
 * (absent when the journal is empty), the same precompute-and-project
 * pattern as `referenceablePaths`.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { loadSchemaValidators } from '../adapters/schema-validators.js';
import { MCP_NODE_PREFIX } from '../util/mcp.js';

/** One journaled frame (mirrors `session-recording.schema.json#/$defs/Frame`). */
export interface SessionRecordingFrame {
  tMs: number;
  type: 'node.activity' | 'agent.spawn';
  /** Wire payload per `type`; AJV pinned the shape, consumers narrow it. */
  data: Record<string, unknown>;
}

/** One recorded session (mirrors `session-recording.schema.json`). */
export interface SessionRecording {
  schemaVersion: number;
  sessionId?: string;
  rootOwner: string;
  provider?: string;
  startedAt: number;
  endedAt?: number;
  frames: SessionRecordingFrame[];
}

/**
 * One observed `(source, target)` relation folded from the journal.
 * `sessions` counts the DISTINCT recordings the pair appeared in, so the
 * analyzer's message can say "across N sessions" honestly; `count` totals
 * the individual observations.
 */
export interface IObservedRelation {
  /** Scan-relative path of the node observed doing the invoking / spawning. */
  source: string;
  /** Scan-relative path of the invoked / spawned node (`mcp://…` for invokes). */
  target: string;
  relation: 'invokes' | 'spawns';
  count: number;
  sessions: number;
  /** Unix-ms of the latest observation. */
  lastSeenAt: number;
}

/**
 * Read every recording under `sessionsDir`. Absent directory reads as an
 * empty journal; a file that fails JSON parse or schema validation is
 * skipped silently (see module doc). Files are visited in name order
 * (the ISO-prefixed names sort chronologically).
 */
export function readSessionJournal(sessionsDir: string): SessionRecording[] {
  if (!existsSync(sessionsDir)) return [];
  let names: string[];
  try {
    names = readdirSync(sessionsDir)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
  const validators = loadSchemaValidators();
  const recordings: SessionRecording[] = [];
  for (const name of names) {
    try {
      const raw = JSON.parse(readFileSync(join(sessionsDir, name), 'utf8')) as unknown;
      const result = validators.validate<SessionRecording>('session-recording', raw);
      if (result.ok) recordings.push(result.data);
    } catch {
      // Off-shape / unreadable: skip silently by contract.
    }
  }
  return recordings;
}

/** Fold accumulator entry: the public relation plus its session set. */
interface IFoldEntry extends IObservedRelation {
  sessionKeys: Set<string>;
}

/** Per-recording fold state (owner claims + spawn dedupe reset per session). */
interface IRecordingFoldState {
  sessionKey: string;
  lastUnitByOwner: Map<string, string>;
  countedSpawnIds: Set<string>;
}

/**
 * Fold recordings into observed relations, keyed `source\x00target`. A
 * pair observed under both relations (not producible today: `invokes`
 * targets `mcp://` nodes, `spawns` targets agent files) keeps its
 * first-seen relation and keeps accumulating counts.
 */
export function foldObservedRelations(
  recordings: readonly SessionRecording[],
): ReadonlyMap<string, IObservedRelation> {
  const relations = new Map<string, IFoldEntry>();
  for (const recording of recordings) {
    const state: IRecordingFoldState = {
      // Distinct-session identity: rootOwner alone repeats across boots
      // (a bare `main`), so anchor on the recording's start too.
      sessionKey: `${recording.rootOwner}\x00${recording.startedAt}`,
      lastUnitByOwner: new Map(),
      countedSpawnIds: new Set(),
    };
    for (const frame of recording.frames) {
      if (frame.type === 'agent.spawn') foldSpawnFrame(relations, state, frame);
      else foldActivityFrame(relations, state, frame);
    }
  }
  const out = new Map<string, IObservedRelation>();
  for (const [key, entry] of relations) {
    const { sessionKeys, ...relation } = entry;
    out.set(key, { ...relation, sessions: sessionKeys.size });
  }
  return out;
}

/** One `agent.spawn` frame: count once per `spawnId`, both paths required. */
function foldSpawnFrame(
  relations: Map<string, IFoldEntry>,
  state: IRecordingFoldState,
  frame: SessionRecordingFrame,
): void {
  const parent = frame.data['parentNodePath'];
  const child = frame.data['childNodePath'];
  const spawnId = frame.data['spawnId'];
  if (typeof parent !== 'string' || typeof child !== 'string' || typeof spawnId !== 'string') {
    return;
  }
  if (state.countedSpawnIds.has(spawnId)) return;
  state.countedSpawnIds.add(spawnId);
  observe(relations, state.sessionKey, parent, child, 'spawns', frame.tMs);
}

/**
 * One `node.activity` frame: an MCP start correlates to the owner's
 * current unit; a unit's own start (sticky / keepAlive included,
 * mirroring the client fold's claim map) becomes that current unit;
 * reads stay ignored (deferred as noisy).
 */
function foldActivityFrame(
  relations: Map<string, IFoldEntry>,
  state: IRecordingFoldState,
  frame: SessionRecordingFrame,
): void {
  const data = frame.data;
  const nodePath = data['nodePath'];
  const owner = data['owner'];
  const isStart = data['phase'] === 'start';
  if (!isStart || typeof nodePath !== 'string' || typeof owner !== 'string') return;
  if (data['access'] === 'mcp') {
    foldMcpInvocation(relations, state, owner, nodePath, frame.tMs);
    return;
  }
  if (data['access'] !== undefined) return; // reads: deferred (noisy)
  if (!nodePath.startsWith(MCP_NODE_PREFIX)) state.lastUnitByOwner.set(owner, nodePath);
}

/** The owner's current unit (when known) invoked the MCP node. */
function foldMcpInvocation(
  relations: Map<string, IFoldEntry>,
  state: IRecordingFoldState,
  owner: string,
  mcpPath: string,
  tMs: number,
): void {
  const caller = state.lastUnitByOwner.get(owner);
  if (caller !== undefined && caller !== mcpPath) {
    observe(relations, state.sessionKey, caller, mcpPath, 'invokes', tMs);
  }
}

/** Accumulate one observation onto the pair's fold entry. */
function observe(
  relations: Map<string, IFoldEntry>,
  sessionKey: string,
  source: string,
  target: string,
  relation: IObservedRelation['relation'],
  tMs: number,
): void {
  const key = `${source}\x00${target}`;
  let entry = relations.get(key);
  if (entry === undefined) {
    entry = {
      source,
      target,
      relation,
      count: 0,
      sessions: 0,
      lastSeenAt: tMs,
      sessionKeys: new Set(),
    };
    relations.set(key, entry);
  }
  entry.count += 1;
  entry.sessionKeys.add(sessionKey);
  if (tMs > entry.lastSeenAt) entry.lastSeenAt = tMs;
}
