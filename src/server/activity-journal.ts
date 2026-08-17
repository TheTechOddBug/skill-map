/**
 * Session journal (`spec/provider-activity.md` §Session journal): the one
 * durable output of the activity pipeline. Groups the RESOLVED frames the
 * ingest route broadcasts into runtime sessions (mirroring the client
 * session index's STRUCTURAL rules, `ui/src/services/session-index.ts` /
 * `computeSessionIndex`; cross-referenced both ways so the two folds
 * cannot drift silently) and persists each session as one JSON file under
 * `<scopeRoot>/.skill-map/sessions/`, shape
 * `spec/schemas/session-recording.schema.json`.
 *
 * Custody and privacy: the service receives ONLY the wire-shaped payloads
 * (`INodeActivityEventData` before stats enrichment, `IAgentSpawnEventData`
 * before the `pairCount` attach), so the boot-scoped derived fields never
 * reach it and content cannot by construction (the spawn projection has no
 * content fields). A defensive strip drops `stats` / `pairCount` anyway so
 * a future call-site reorder cannot leak them onto disk.
 *
 * Contract highlights (mirroring the operations log's posture):
 *
 *   - FIRE-AND-FORGET: a journal failure never fails or delays ingest.
 *     Every filesystem error is swallowed.
 *   - NO PROJECT, NO JOURNAL: when `<scopeRoot>/.skill-map/` does not
 *     exist the flush skips silently (the journal never creates the scope
 *     directory as a side effect; `sessions/` itself IS created lazily
 *     inside an existing scope).
 *   - GATES: `activity.journal.enabled` (default true) is read ONCE at
 *     boot by the composition root and threaded in as `enabled`, the
 *     MASTER switch; off means the service is a full no-op and existing
 *     files stay untouched. On top of it, capture is a GESTURE
 *     (2026-08-16): frames land only while `setRecording(true)` holds
 *     (the UI's Record session control), never ambiently.
 *   - RETENTION: bounded by file count and total size (50 files / 20 MiB
 *     by default), oldest first by name (the ISO-prefixed names sort
 *     chronologically), pruned at boot and at each finalization.
 *
 * Session grouping (spec §Session journal, the minimal server-side fold):
 *
 *   - A spawn frame with NO `parentNodePath` marks its `parentOwner` as a
 *     session root (the wire's structural discriminator).
 *   - A `childOwner` claim attributes that owner to the spawning session;
 *     frames are processed in arrival order, so a plain overwrite realises
 *     the "latest claim at or before the frame wins" re-spawn rule.
 *   - An activity owner never seen as a `childOwner` is a root on first
 *     sight (spawn-less providers).
 *   - `main:<session_id>` prefix and the frame `session` field are HINTS
 *     only (they fill `sessionId`), never parsed further.
 *   - A frame that cannot be attributed lands in the most recent open
 *     session, else in the `unattributed` bucket (`rootOwner: ''`).
 *
 * Finalization (stamp `endedAt`, ONE `activity.session-write` operations-
 * log line, prune) fires on a `sessionScope` end naming the session, on a
 * terminal `ownerScope` end of a session's root owner, and on `shutdown()`
 * for every still-open session. A `turnEnd` never finalizes (a session
 * spans many turns); the ~2s debounced flush keeps the open file current.
 * When the SessionStart/SessionEnd hook surface lands upstream this is the
 * seam that upgrades to exact boundaries.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { appendOperation } from '../core/operations-log.js';
import { writeJsonAtomic } from '../kernel/util/atomic-write.js';
import type { IAgentSpawnEventData, INodeActivityEventData } from './events.js';

/** Retention defaults (spec §Session journal). */
export const JOURNAL_MAX_FILES = 50;
export const JOURNAL_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
/** Debounced-write default (~2s while frames arrive). */
export const JOURNAL_DEBOUNCE_MS = 2000;
/**
 * Per-session in-memory frame cap. Saturating: past it, new frames are
 * dropped (never an error). Bounds a runaway session that outlives every
 * flush opportunity (e.g. a missing `.skill-map/` keeping writes off).
 */
export const JOURNAL_MAX_FRAMES_PER_SESSION = 10_000;

/** Sessionized main-owner prefix (`main:<session_id>`, adapter convention). */
const MAIN_OWNER_PREFIX = 'main:';
/** Root-owner key of the unattributed bucket file. */
const UNATTRIBUTED_ROOT = '';

/** One journaled frame, the on-disk shape (`session-recording.schema.json`). */
interface IJournalFrame {
  tMs: number;
  type: 'node.activity' | 'agent.spawn';
  data: Record<string, unknown>;
}

interface IJournalSession {
  rootOwner: string;
  sessionId?: string;
  provider?: string;
  startedAt: number;
  lastFrameAt: number;
  frames: IJournalFrame[];
  /** Stable on-disk name, computed at the FIRST flush and kept thereafter. */
  fileName?: string;
  dirty: boolean;
}

export interface IActivityJournalOptions {
  /** Resolved `activity.journal.enabled` (read once at boot). */
  enabled: boolean;
  /** Absolute `<scopeRoot>/.skill-map/sessions` (see `defaultProjectSessionsDir`). */
  sessionsDir: string;
  /** Scope root, threaded to `appendOperation` at finalization. */
  cwd: string;
  /** Test injection: retention / cadence overrides and a fake clock. */
  maxFiles?: number;
  maxTotalBytes?: number;
  debounceMs?: number;
  now?: () => number;
}

export class ActivityJournalService {
  private readonly enabled: boolean;
  private readonly sessionsDir: string;
  private readonly cwd: string;
  private readonly maxFiles: number;
  private readonly maxTotalBytes: number;
  private readonly debounceMs: number;
  private readonly now: () => number;

  /** Open sessions keyed by root owner, in creation order. */
  private readonly sessions = new Map<string, IJournalSession>();
  /**
   * Finalized sessions retained for REOPEN within the recording window
   * (spec §Session journal · Finalization): most providers' release
   * forms mean "everything is idle now", not "the conversation is
   * over" (codex fires one per TURN), so a frame attributed to a
   * finalized root revives its session onto the same file instead of
   * fragmenting the conversation into one file per turn. Bounded by
   * `maxFiles` (oldest evicted lose only their reopen-ability); cleared
   * when the window dies (stop / shutdown / clearAll).
   */
  private readonly closedSessions = new Map<string, IJournalSession>();
  /** `owner -> rootOwner` attribution learned from spawn `childOwner` claims. */
  private readonly ownerToRoot = new Map<string, string>();
  private flushTimer: NodeJS.Timeout | null = null;
  private closed = false;
  /**
   * Capture is a GESTURE (user decision 2026-08-16, superseding the
   * always-on capture this service first shipped with): frames land
   * only between `setRecording(true)` and `setRecording(false)`,
   * driven by the UI's Record session control over
   * `POST /api/activity/sessions/recording`. Boot state OFF; dies with
   * the process (shutdown finalizes whatever was open).
   */
  private recordingActive = false;

  constructor(opts: IActivityJournalOptions) {
    this.enabled = opts.enabled;
    this.sessionsDir = opts.sessionsDir;
    this.cwd = opts.cwd;
    this.maxFiles = opts.maxFiles ?? JOURNAL_MAX_FILES;
    this.maxTotalBytes = opts.maxTotalBytes ?? JOURNAL_MAX_TOTAL_BYTES;
    this.debounceMs = opts.debounceMs ?? JOURNAL_DEBOUNCE_MS;
    this.now = opts.now ?? Date.now;
    // Boot-time prune: a prior boot's backlog is trimmed before this one
    // adds files (spec §Session journal · Retention).
    if (this.enabled) this.prune();
  }

  /**
   * Journal one resolved `node.activity` payload (PRE stats enrichment).
   * Also drives finalization: a `sessionScope` end closes the session it
   * names; a terminal `ownerScope` end of a ROOT owner closes that root's
   * session (Antigravity's fully-idle Stop shape). Fire-and-forget.
   */
  recordActivity(provider: string, data: INodeActivityEventData): void {
    if (!this.enabled || !this.recordingActive || this.closed) return;
    try {
      const tMs = this.now();
      const session = this.attributeActivity(data, tMs);
      this.append(session, provider, tMs, 'node.activity', stripActivity(data));
      this.maybeFinalizeOnEnd(data);
      this.scheduleFlush();
    } catch {
      // Fire-and-forget: ingest never pays for its journal line.
    }
  }

  /**
   * Session-release detection on an end frame: a `sessionScope` end
   * closes the session it names; an `ownerScope` end whose owner IS a
   * session root closes that root's session (Antigravity's fully-idle
   * Stop shape). A subagent's `ownerScope` end (owner mapped to some
   * OTHER root) and a `turnEnd` never finalize.
   */
  private maybeFinalizeOnEnd(data: INodeActivityEventData): void {
    if (data.phase !== 'end') return;
    if (data.sessionScope === true && data.session !== undefined) {
      const target = this.findBySessionId(data.session);
      if (target) this.finalize(target);
      return;
    }
    if (data.ownerScope === true && data.owner !== undefined) {
      const root = this.sessions.get(data.owner);
      if (root) this.finalize(root);
    }
  }

  /**
   * Journal one resolved `agent.spawn` payload (the metadata-only wire
   * projection, PRE `pairCount` attach). Learns the structural roots and
   * the `childOwner -> session` claims. Fire-and-forget.
   */
  recordSpawn(provider: string, data: IAgentSpawnEventData): void {
    if (!this.enabled || !this.recordingActive || this.closed) return;
    try {
      const tMs = this.now();
      const root =
        data.parentNodePath === undefined
          ? // Structural discriminator: a session context is spawning.
            data.parentOwner
          : // Agent parent: attribute through its own claim chain; a parent
            // the journal never saw claimed is a first-sight root.
            (this.ownerToRoot.get(data.parentOwner) ?? data.parentOwner);
      const session = this.sessionFor(root, tMs);
      if (data.childOwner !== undefined) {
        this.ownerToRoot.set(data.childOwner, root);
        this.adoptMisrootedOwner(data.childOwner, session);
      }
      this.append(session, provider, tMs, 'agent.spawn', stripSpawn(data));
      this.scheduleFlush();
    } catch {
      // Fire-and-forget.
    }
  }

  /** The live capture state, stamped on the read-back envelope. */
  isRecording(): boolean {
    return this.recordingActive;
  }

  /**
   * Toggle capture (`POST /api/activity/sessions/recording`). Engaging
   * requires the boot master switch (`activity.journal.enabled`);
   * disengaging FINALIZES every still-open session (endedAt + one
   * operations line each, the same closure a `sessionScope` end gives
   * one session). Returns the EFFECTIVE state so the route can answer
   * honestly when the master switch refused.
   */
  setRecording(on: boolean): boolean {
    if (on) {
      if (this.enabled && !this.closed) this.recordingActive = true;
      return this.recordingActive;
    }
    if (this.recordingActive) {
      this.recordingActive = false;
      try {
        for (const session of [...this.sessions.values()]) {
          this.finalize(session, { skipPrune: true });
        }
        this.prune();
      } catch {
        // Fire-and-forget, like every other write path here.
      }
      // The recording window died with the gesture: nothing reopens
      // across it, and the attribution memory goes with it.
      this.closedSessions.clear();
      this.ownerToRoot.clear();
    }
    return this.recordingActive;
  }

  /**
   * Flush every dirty buffer NOW (`GET /api/activity/sessions` calls it
   * before reading the directory, so a just-recorded session is visible
   * without waiting out the debounce). Fire-and-forget like the timed
   * flush; a no-op while disabled or after shutdown.
   */
  flushNow(): void {
    if (!this.enabled || this.closed) return;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    try {
      this.flushDirty();
    } catch {
      // Fire-and-forget.
    }
  }

  /**
   * Operator wipe (`DELETE /api/activity/sessions`, spec §Session
   * journal · Deletion): discard every open in-memory session WITHOUT
   * finalizing (the operator is erasing, not closing, so no `endedAt`
   * write and no per-session operations line; the route logs the one
   * `activity.sessions-clear` line itself) and delete every journal
   * file. Deliberately ungated: it must work while the write gate is
   * off and after `shutdown()`, files from prior boots are still the
   * operator's to erase. Returns the number of files deleted.
   */
  clearAll(): number {
    this.sessions.clear();
    this.closedSessions.clear();
    this.ownerToRoot.clear();
    let deleted = 0;
    try {
      if (!existsSync(this.sessionsDir)) return 0;
      for (const name of readdirSync(this.sessionsDir)) {
        if (!name.endsWith('.json')) continue;
        try {
          unlinkSync(join(this.sessionsDir, name));
          deleted += 1;
        } catch {
          // Best-effort per file; the count stays honest.
        }
      }
    } catch {
      // Best-effort: an unreadable directory erases nothing.
    }
    return deleted;
  }

  /**
   * Shutdown flush: finalize every still-open session (stamp `endedAt`,
   * one operations-log line each), then prune once. Idempotent; called by
   * the composition root's `close()`.
   */
  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.enabled) return;
    try {
      for (const session of [...this.sessions.values()]) {
        this.finalize(session, { skipPrune: true });
      }
      this.prune();
    } catch {
      // Fire-and-forget, shutdown must never fail on the journal's account.
    }
  }

  // -------------------------------------------------------------------------
  // attribution
  // -------------------------------------------------------------------------

  private attributeActivity(data: INodeActivityEventData, tMs: number): IJournalSession {
    if (data.owner !== undefined) {
      const root = this.ownerToRoot.get(data.owner) ?? data.owner;
      const session = this.sessionFor(root, tMs);
      if (session.sessionId === undefined && data.session !== undefined) {
        session.sessionId = data.session;
      }
      return session;
    }
    return this.attributeOwnerless(data.session, tMs);
  }

  /**
   * Ownerless attribution: a session-scoped end (or future node-less
   * forms) belongs to the session whose id it names, open or closed (a
   * closed one reopens, e.g. a duplicate provider Stop: naming it beats
   * guessing); otherwise the most recent open session, else the
   * unattributed bucket. Never guessed further.
   */
  private attributeOwnerless(sessionId: string | undefined, tMs: number): IJournalSession {
    if (sessionId !== undefined) {
      const match = this.findBySessionId(sessionId);
      if (match) return match;
      for (const closed of this.closedSessions.values()) {
        if (closed.sessionId === sessionId) return this.sessionFor(closed.rootOwner, tMs);
      }
    }
    const latest = this.latestOpenSession();
    return latest ?? this.sessionFor(UNATTRIBUTED_ROOT, tMs);
  }

  /**
   * Late-claim adoption (spec §Session journal · Session grouping): the
   * parent's and child's hook processes race, so the child's first
   * activity can arrive BEFORE the `handoff` frame that declares its
   * `childOwner`, and this streaming fold will have mis-rooted it as a
   * first-sight session (the client index is immune: it folds the whole
   * tape with lookback, `computeSessionIndex`'s earliest-claim
   * fallback). When the claim lands, the claiming session absorbs the
   * orphan: frames merge in chronological order, the orphan's file (if
   * one was already flushed) is removed, and any owners attributed to
   * the orphan re-point to the adopting root.
   */
  private adoptMisrootedOwner(owner: string, into: IJournalSession): void {
    // A mis-rooted orphan may already be FINALIZED (its terminal end also
    // raced ahead of the claim), so the closed park is adoptable too.
    const orphan = this.sessions.get(owner) ?? this.closedSessions.get(owner);
    if (orphan === undefined || orphan === into) return;
    this.sessions.delete(orphan.rootOwner);
    this.closedSessions.delete(orphan.rootOwner);
    for (const [child, root] of this.ownerToRoot) {
      if (root === orphan.rootOwner) this.ownerToRoot.set(child, into.rootOwner);
    }
    mergeOrphanInto(into, orphan);
    if (orphan.fileName !== undefined) {
      try {
        unlinkSync(join(this.sessionsDir, orphan.fileName));
      } catch {
        // Best-effort: a stale orphan file falls to the retention sweep.
      }
    }
  }

  private sessionFor(rootOwner: string, tMs: number): IJournalSession {
    let session = this.sessions.get(rootOwner);
    if (session === undefined) {
      const closed = this.closedSessions.get(rootOwner);
      if (closed !== undefined) {
        // Reopen: same file, frames keep appending; the next flush
        // rewrites without `endedAt` and the next finalization
        // re-stamps it.
        this.closedSessions.delete(rootOwner);
        this.sessions.set(rootOwner, closed);
        closed.dirty = true;
        return closed;
      }
      session = {
        rootOwner,
        startedAt: tMs,
        lastFrameAt: tMs,
        frames: [],
        dirty: false,
      };
      if (rootOwner.startsWith(MAIN_OWNER_PREFIX)) {
        const hint = rootOwner.slice(MAIN_OWNER_PREFIX.length);
        if (hint.length > 0) session.sessionId = hint;
      }
      this.sessions.set(rootOwner, session);
    }
    return session;
  }

  /**
   * Park a finalized session for reopen, bounded by `maxFiles` in
   * insertion order: an evicted session loses only its reopen-ability
   * (its file stays until retention says otherwise), and its owner
   * attributions go with it.
   */
  private retainForReopen(session: IJournalSession): void {
    this.closedSessions.set(session.rootOwner, session);
    while (this.closedSessions.size > this.maxFiles) {
      const oldest = this.closedSessions.keys().next().value;
      if (oldest === undefined) break;
      this.closedSessions.delete(oldest);
      for (const [owner, root] of this.ownerToRoot) {
        if (root === oldest) this.ownerToRoot.delete(owner);
      }
    }
  }

  private findBySessionId(sessionId: string): IJournalSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId) return session;
    }
    return undefined;
  }

  private latestOpenSession(): IJournalSession | undefined {
    let latest: IJournalSession | undefined;
    for (const session of this.sessions.values()) {
      if (session.rootOwner === UNATTRIBUTED_ROOT) continue;
      if (latest === undefined || session.lastFrameAt >= latest.lastFrameAt) latest = session;
    }
    return latest;
  }

  private append(
    session: IJournalSession,
    provider: string,
    tMs: number,
    type: IJournalFrame['type'],
    data: Record<string, unknown>,
  ): void {
    session.lastFrameAt = tMs;
    if (session.provider === undefined) session.provider = provider;
    if (session.frames.length >= JOURNAL_MAX_FRAMES_PER_SESSION) return; // saturate
    session.frames.push({ tMs, type, data });
    session.dirty = true;
  }

  // -------------------------------------------------------------------------
  // persistence
  // -------------------------------------------------------------------------

  private scheduleFlush(): void {
    if (this.flushTimer !== null || this.closed) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      try {
        this.flushDirty();
      } catch {
        // Fire-and-forget.
      }
    }, this.debounceMs);
    // Never hold the process open on the journal's account.
    this.flushTimer.unref?.();
  }

  private flushDirty(): void {
    for (const session of this.sessions.values()) {
      if (session.dirty) this.writeSession(session);
    }
  }

  /**
   * Persist one session file. Skips silently when `<scopeRoot>/.skill-map/`
   * does not exist (the journal never provisions the scope); creates
   * `sessions/` lazily inside an existing scope. The `dirty` flag drops
   * only on a successful write, so a transient failure retries on the
   * next debounce tick.
   */
  private writeSession(session: IJournalSession, endedAt?: number): void {
    if (!existsSync(dirname(this.sessionsDir))) return;
    try {
      mkdirSync(this.sessionsDir, { recursive: true });
      session.fileName ??= this.fileNameFor(session);
      const envelope: Record<string, unknown> = {
        schemaVersion: 1,
        ...(session.sessionId === undefined ? {} : { sessionId: session.sessionId }),
        rootOwner: session.rootOwner,
        ...(session.provider === undefined ? {} : { provider: session.provider }),
        startedAt: session.startedAt,
        ...(endedAt === undefined ? {} : { endedAt }),
        frames: session.frames,
      };
      writeJsonAtomic(join(this.sessionsDir, session.fileName), envelope);
      session.dirty = false;
    } catch {
      // Fire-and-forget; the dirty flag keeps the retry armed.
    }
  }

  /**
   * `<startedAt ISO, colons stripped>-<sessionId | 8-char hash of rootOwner>.json`
   * (spec §Session journal · Naming). Sorts chronologically by name, which
   * the retention sweep relies on.
   */
  private fileNameFor(session: IJournalSession): string {
    const iso = new Date(session.startedAt).toISOString().split(':').join('');
    const sanitized = session.sessionId?.replace(/[^A-Za-z0-9._-]/g, '-');
    const suffix =
      sanitized !== undefined && sanitized.length > 0
        ? sanitized
        : createHash('sha256').update(session.rootOwner).digest('hex').slice(0, 8);
    return `${iso}-${suffix}.json`;
  }

  /**
   * Finalize one session: stamp `endedAt`, write, log ONE
   * `activity.session-write` operations line (channel `hook`: the provider
   * hook is the ingest channel that produced the data), release its owner
   * attributions, prune. The operations line carries only data in hand
   * (file name + frame count), per the log's basic-by-design contract.
   */
  private finalize(session: IJournalSession, opts?: { skipPrune?: boolean }): void {
    this.sessions.delete(session.rootOwner);
    if (session.frames.length === 0) return; // nothing recorded, no file, no log line
    // Retain for reopen (owner attributions included: the next turn's
    // child frames still belong to this conversation); the window's own
    // death (stop / shutdown / clearAll) is what forgets it.
    this.retainForReopen(session);
    this.writeSession(session, session.lastFrameAt);
    if (session.fileName !== undefined && !session.dirty) {
      appendOperation(this.cwd, {
        op: 'activity.session-write',
        target: '*',
        channel: 'hook',
        outcome: 'ok',
        id: session.fileName,
        detail: `frames=${session.frames.length}`,
      });
    }
    if (opts?.skipPrune !== true) this.prune();
  }

  /**
   * Retention sweep: keep the newest `maxFiles` journal files and at most
   * `maxTotalBytes` across them, deleting oldest first (names sort
   * chronologically). Best-effort; any error leaves the directory as-is.
   */
  private prune(): void {
    try {
      if (!existsSync(this.sessionsDir)) return;
      const entries = readdirSync(this.sessionsDir)
        .filter((name) => name.endsWith('.json'))
        .sort() // ISO-prefixed names: ascending = oldest first
        .map((name) => {
          const path = join(this.sessionsDir, name);
          return { path, size: statSync(path).size };
        });
      let total = entries.reduce((acc, e) => acc + e.size, 0);
      let excess = entries.length - this.maxFiles;
      for (const entry of entries) {
        if (excess <= 0 && total <= this.maxTotalBytes) break;
        unlinkSync(entry.path);
        excess -= 1;
        total -= entry.size;
      }
    } catch {
      // Best-effort retention; worst case the directory keeps growing
      // until the next successful sweep.
    }
  }
}

/**
 * Defensive strip of the boot-scoped derived field (`stats`) plus a plain
 * clone. The call site already hands the PRE-enrichment payload; the strip
 * guarantees the invariant survives a future reorder.
 */
function stripActivity(data: INodeActivityEventData): Record<string, unknown> {
  const { stats: _stats, ...rest } = data;
  return { ...rest };
}

/** Mirror strip for `pairCount` on the spawn projection. */
function stripSpawn(data: IAgentSpawnEventData): Record<string, unknown> {
  const { pairCount: _pairCount, ...rest } = data;
  return { ...rest };
}

/**
 * Fold a mis-rooted orphan's buffer into its adopting session: frames
 * re-sorted chronologically (the orphan raced ahead of the claim),
 * bounds widened, identity hints filled only where the adopter lacks
 * them, and the result marked dirty for the next flush.
 */
function mergeOrphanInto(into: IJournalSession, orphan: IJournalSession): void {
  into.frames = [...into.frames, ...orphan.frames]
    .sort((a, b) => a.tMs - b.tMs)
    .slice(0, JOURNAL_MAX_FRAMES_PER_SESSION);
  into.startedAt = Math.min(into.startedAt, orphan.startedAt);
  into.lastFrameAt = Math.max(into.lastFrameAt, orphan.lastFrameAt);
  if (into.sessionId === undefined && orphan.sessionId !== undefined) {
    into.sessionId = orphan.sessionId;
  }
  if (into.provider === undefined && orphan.provider !== undefined) {
    into.provider = orphan.provider;
  }
  into.dirty = true;
}
