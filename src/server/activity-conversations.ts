/**
 * Consent-gated, in-memory spawn-conversation store (see
 * `spec/provider-activity.md` §Conversation capture). Holds the
 * inter-agent conversation halves (the spawn `prompt`, the sync
 * completion `response`) plus the spawn metadata, upserted by
 * `spawnId` as the relation's lifecycle frames arrive.
 *
 * **Custody contract (normative in the spec, enforced by
 * construction)**: this store is instantiated ONLY in `createServer`
 * (the BFF composition root) and passed as an EXPLICIT extra dep to
 * exactly the activity routes that need it. It MUST NOT be added to
 * `IRouteDeps`, threaded into `assembleKernel` / `assemblePluginRuntime`,
 * exposed through any extension context or the plugin KV API, or
 * imported from anywhere outside `src/server/`; plugins have no
 * supported path to it. Content is excluded from error reporting,
 * access logs and error messages (same posture as the ingest body),
 * NEVER rides the WS, and is served only on demand over the
 * loopback-gated detail endpoints.
 *
 * Retention bounds: a ring of at most `CONVERSATION_RING_CAP` records
 * (oldest evicted first) with each content field capped at
 * `CONTENT_CAP_BYTES` (truncated with an explicit marker). Nothing is
 * persisted; the store dies with the process, and disabling the gate
 * clears it immediately.
 */

import type { IActivitySpawnExecution } from '../kernel/extensions/index.js';
import type { IResolvedSpawn } from './activity-resolver.js';

/** Ring bound: at most this many spawn records are retained. */
export const CONVERSATION_RING_CAP = 200;

/** Per-content-field byte cap (UTF-8), spec'd at 64 KiB. */
export const CONTENT_CAP_BYTES = 64 * 1024;

/** Appended to a content field that hit `CONTENT_CAP_BYTES`. */
export const TRUNCATION_MARKER = '\n[truncated by skill-map: 64 KiB cap]';

/**
 * One retained spawn conversation record. Metadata mirrors the wire
 * `agent.spawn` fields; `prompt` / `response` are the capture-gated
 * content halves. Async spawns carry `prompt` only (the final report
 * of a background agent does not travel through hooks).
 */
export interface IConversationRecord {
  spawnId: string;
  parentOwner: string;
  parentNodePath?: string;
  childKind?: string;
  childName?: string;
  childNodePath?: string;
  childOwner?: string;
  prompt?: string;
  response?: string;
  /** Aggregate execution summary of the completed run (metadata). */
  execution?: IActivitySpawnExecution;
  /** Unix-ms of the first frame seen for this spawnId. */
  startedAt: number;
  /** Unix-ms of the `end` frame, when one arrived. */
  endedAt?: number;
  /** `running` until the relation's `end` frame lands. */
  status: 'running' | 'completed';
}

export class ActivityConversationStore {
  private readonly records = new Map<string, IConversationRecord>();

  private gateEnabled: boolean;

  constructor(opts: { enabled: boolean }) {
    this.gateEnabled = opts.enabled;
  }

  get enabled(): boolean {
    return this.gateEnabled;
  }

  /** Flip the capture gate. Turning it OFF clears the ring immediately. */
  setEnabled(enabled: boolean): void {
    this.gateEnabled = enabled;
    if (!enabled) this.records.clear();
  }

  /**
   * Upsert one resolved spawn frame by `spawnId`. No-op while the gate
   * is off. Later frames merge over earlier ones field-by-field (a
   * handoff adds `childOwner` / `childNodePath`, an end adds
   * `response` + `endedAt`); a frame arriving with no prior record
   * (gate flipped on mid-flight) still creates one.
   */
  record(spawn: IResolvedSpawn): void {
    if (!this.gateEnabled) return;
    const existing = this.records.get(spawn.spawnId);
    const base: IConversationRecord = existing ?? {
      spawnId: spawn.spawnId,
      parentOwner: spawn.parentOwner,
      startedAt: Date.now(),
      status: 'running',
    };
    mergeFrame(base, spawn);
    if (existing === undefined) {
      this.records.set(spawn.spawnId, base);
      this.evictPastCap();
    }
  }

  /**
   * Attach an end-of-context report as the response of every record
   * whose `childOwner` matches (async spawns; sync records never get a
   * childOwner and take their response from the completion frame).
   * No-op while the gate is off. Stop events fire on pause too, so
   * this OVERWRITES: the terminal message is the last writer and wins.
   */
  attachReport(childOwner: string, report: string): void {
    if (!this.gateEnabled) return;
    for (const record of this.records.values()) {
      if (record.childOwner !== childOwner) continue;
      record.response = capContent(report);
      if (record.endedAt === undefined) record.endedAt = Date.now();
      record.status = 'completed';
    }
  }

  /** Copy of one record, or `null` for an unknown id. */
  bySpawnId(spawnId: string): IConversationRecord | null {
    const record = this.records.get(spawnId);
    return record ? { ...record } : null;
  }

  /** Copies of every record touching `path` as parent OR child. */
  byNode(path: string): IConversationRecord[] {
    const out: IConversationRecord[] = [];
    for (const record of this.records.values()) {
      if (record.parentNodePath === path || record.childNodePath === path) {
        out.push({ ...record });
      }
    }
    return out;
  }

  private evictPastCap(): void {
    while (this.records.size > CONVERSATION_RING_CAP) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) return;
      this.records.delete(oldest);
    }
  }
}

/** Merge one frame's fields onto the retained record, in place. */
function mergeFrame(record: IConversationRecord, spawn: IResolvedSpawn): void {
  mergeMetadata(record, spawn);
  if (spawn.prompt !== undefined) record.prompt = capContent(spawn.prompt);
  if (spawn.response !== undefined) record.response = capContent(spawn.response);
  if (spawn.execution !== undefined) record.execution = { ...spawn.execution };
  if (spawn.phase === 'end') {
    record.endedAt = Date.now();
    record.status = 'completed';
  }
}

/** The field-by-field metadata half of `mergeFrame` (no content, no caps). */
function mergeMetadata(record: IConversationRecord, spawn: IResolvedSpawn): void {
  record.parentOwner = spawn.parentOwner;
  if (spawn.parentNodePath !== undefined) record.parentNodePath = spawn.parentNodePath;
  if (spawn.childKind !== undefined) record.childKind = spawn.childKind;
  if (spawn.childName !== undefined) record.childName = spawn.childName;
  if (spawn.childNodePath !== undefined) record.childNodePath = spawn.childNodePath;
  if (spawn.childOwner !== undefined) record.childOwner = spawn.childOwner;
}

/**
 * Enforce the per-field byte cap. Truncation cuts at a UTF-8 boundary
 * (a code point split by the byte cut decodes to U+FFFD and is
 * dropped) and appends the explicit marker so a reader can tell a
 * capped field from a short one.
 */
function capContent(value: string): string {
  if (Buffer.byteLength(value, 'utf8') <= CONTENT_CAP_BYTES) return value;
  const sliced = Buffer.from(value, 'utf8')
    .subarray(0, CONTENT_CAP_BYTES)
    .toString('utf8')
    .replace(/�+$/, '');
  return sliced + TRUNCATION_MARKER;
}
