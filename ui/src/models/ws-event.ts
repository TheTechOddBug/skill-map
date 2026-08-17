/**
 * `IWsEvent`, typed envelope for every WebSocket frame the BFF pushes
 * over `/ws`. Mirrors `spec/job-events.md §Common envelope`:
 *
 *   ```json
 *   {
 *     "type":      "<event-type>",
 *     "timestamp": <unix-ms> | "<iso-string>",
 *     "runId":     "<run-id>",
 *     "jobId":     "<job-id> | null",
 *     "data":      { ... }
 *   }
 *   ```
 *
 * The BFF (`src/server/events.ts:IWsEventEnvelope`) and the kernel's
 * `ProgressEmitterPort` agree on this shape. The `timestamp` field is
 * intentionally typed `number | string` because the kernel emits ISO-8601
 * today (per `src/kernel/orchestrator.ts:makeEvent`) while the spec
 * example shows unix-ms, consumers normalise via `wsEventTimestampMs()`.
 *
 * The brief uses the shorter `ts` / `payload` aliases. We keep
 * `timestamp` / `data` here because:
 *
 *   1. The wire shape is fixed by the BFF (and ultimately by the spec).
 *   2. Renaming on receive would break a future consumer that round-trips
 *      events through the WS pipe (e.g. a debug-relay tool).
 *
 * `IWsEvent` is intentionally generic over `data` so a consumer can
 * narrow per `type` via the discriminated unions below
 * (`IWsScanCompletedEvent` etc.). Unknown types collapse to
 * `IWsEvent<unknown>` and consumers must skip them silently per the
 * spec's forward-compat rule.
 */

import type { INodeActivityStatsApi } from './api';

export interface IWsEvent<T = unknown> {
  /**
   * Canonical event type per `spec/job-events.md §Event catalog`. Today
   * the BFF emits a subset: `scan.started`, `scan.progress`,
   * `scan.completed`, `extractor.completed`, `analyzer.completed`,
   * `extension.error`, plus the BFF-internal `watcher.started` /
   * `watcher.error` advisories.
   */
  type: string;
  /**
   * Server timestamp. The BFF / kernel currently emit an ISO-8601 string
   * for emitter events and `Date.now()` (number) for watcher.* advisories;
   * consumers normalise via `wsEventTimestampMs()` below.
   */
  timestamp: number | string;
  /** Run identifier. Optional, `watcher.*` advisories don't carry one. */
  runId?: string;
  /** Job identifier. `null` for run-level / non-job events. */
  jobId?: string | null;
  /** Event-specific payload. Empty object `{}` for events with no data. */
  data: T;
}

// ---------------------------------------------------------------------------
// Per-type payload shapes, narrow only the events the SPA actually
// reads. Unknown types stay `IWsEvent<unknown>`.
// ---------------------------------------------------------------------------

/**
 * `scan.started` payload. Canonical kernel shape per
 * `spec/job-events.md` §scan.started: `{ mode, roots }`, where `mode`
 * names the walk strategy actually taken (`'changed'` = scoped
 * incremental walk over an explicit changed-path set, the watcher fast
 * path; `'full'` = full traversal, with or without cache reuse). The
 * legacy optionals (`target`, `rootsCount`, `'single'`) stay tolerated
 * per the forward-compat rule; nothing emits them today.
 */
export interface IWsScanStartedData {
  mode?: 'full' | 'changed' | 'single';
  target?: string | null;
  rootsCount?: number;
  /** Scanned root list as invoked. */
  roots?: string[];
}

/**
 * `scan.progress` payload. Canonical kernel shape per
 * `spec/job-events.md` §scan.progress: one frame per classified node,
 * `{ index, path, kind, cached, partialCache? }`. The legacy aggregate
 * optionals stay tolerated per the forward-compat rule.
 */
export interface IWsScanProgressData {
  filesSeen?: number;
  filesProcessed?: number;
  filesSkipped?: number;
  /** 1-based over the claimed nodes. */
  index?: number;
  /** Root-relative POSIX path, same string as `node.path`. */
  path?: string;
  kind?: string;
  /** `true` = reused verbatim from the prior snapshot (no extractor ran). */
  cached?: boolean;
  /**
   * Present only beside `cached: false`: hashes matched but at least
   * one applicable extractor lacked a prior run record. NOT a content
   * change; consumers reacting to "this file changed on disk" MUST
   * skip these frames (spec/job-events.md §scan.progress).
   */
  partialCache?: boolean;
}

/**
 * `scan.completed` payload. The kernel emits a `stats` block today
 * (`{ stats: { filesWalked, nodesCount, linksCount, issuesCount, durationMs } }`)
 * while the spec example shows the counts inlined at the top level. Both
 * shapes are supported here so the UI tolerates either; consumers
 * normalize via `readScanCompletedSummary()` below.
 */
export interface IWsScanCompletedData {
  /** Top-level shape per spec example (some emitters use this). */
  nodes?: number;
  links?: number;
  issues?: number;
  durationMs?: number;
  /** Nested shape per the kernel's current emission. */
  stats?: {
    filesWalked?: number;
    filesSkipped?: number;
    nodesCount?: number;
    linksCount?: number;
    issuesCount?: number;
    durationMs?: number;
  };
}

/**
 * Normalize a `scan.completed` payload to the four numbers the EventLog
 * digest needs. Picks the top-level field first (spec example shape),
 * falls back to the `stats` block (current kernel shape). Returns
 * `undefined` for any field neither shape supplies.
 */
export function readScanCompletedSummary(data: IWsScanCompletedData | undefined | null): {
  nodes: number | undefined;
  links: number | undefined;
  issues: number | undefined;
  durationMs: number | undefined;
} {
  const d = data ?? {};
  return {
    nodes: d.nodes ?? d.stats?.nodesCount,
    links: d.links ?? d.stats?.linksCount,
    issues: d.issues ?? d.stats?.issuesCount,
    durationMs: d.durationMs ?? d.stats?.durationMs,
  };
}

export interface IWsExtractorCompletedData {
  extractorId?: string;
}

export interface IWsRuleCompletedData {
  analyzerId?: string;
}

export interface IWsWatcherStartedData {
  roots?: string[];
  debounceMs?: number;
}

export interface IWsWatcherErrorData {
  message?: string;
}

export type IWsScanStartedEvent = IWsEvent<IWsScanStartedData> & { type: 'scan.started' };
export type IWsScanProgressEvent = IWsEvent<IWsScanProgressData> & { type: 'scan.progress' };
export type IWsScanCompletedEvent = IWsEvent<IWsScanCompletedData> & { type: 'scan.completed' };
export type IWsExtractorCompletedEvent = IWsEvent<IWsExtractorCompletedData> & {
  type: 'extractor.completed';
};
export type IWsAnalyzerCompletedEvent = IWsEvent<IWsRuleCompletedData> & { type: 'analyzer.completed' };
export type IWsWatcherStartedEvent = IWsEvent<IWsWatcherStartedData> & { type: 'watcher.started' };
export type IWsWatcherErrorEvent = IWsEvent<IWsWatcherErrorData> & { type: 'watcher.error' };

/**
 * Loose, runtime type-guard. Validates only the envelope's required keys
 * (`type` is non-empty string, `timestamp` is number-or-string, `data`
 * exists). Per-type payload validation is intentionally absent, the
 * spec mandates forward-compat tolerance, and the consumers narrow by
 * `type` themselves before reading `data`.
 *
 * Returns `false` when the value is malformed; the caller logs + drops.
 * Never throws.
 */
export function isWsEvent(value: unknown): value is IWsEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v['type'] !== 'string' || v['type'].length === 0) return false;
  const ts = v['timestamp'];
  if (typeof ts !== 'number' && typeof ts !== 'string') return false;
  if (!('data' in v)) return false;
  return true;
}

/**
 * `action.applied` event payload, broadcast by
 * `POST /api/actions/:pluginId/:actionId` after a dispatched Action
 * materialises at least one write (a `noop: true` report broadcasts
 * nothing). Wrapped in the canonical `{ type, timestamp, data }`
 * envelope. Consumers narrow on `event.type === 'action.applied'` and
 * branch on `event.data.actionId`; `report` is action-defined, so each
 * consumer validates the slice it reads.
 */
export interface IWsActionAppliedData {
  actionId: string;
  nodePath: string;
  report: unknown;
}

export type IWsActionAppliedEvent = IWsEvent<IWsActionAppliedData> & { type: 'action.applied' };

export function isActionAppliedEvent(value: unknown): value is IWsActionAppliedEvent {
  if (!isWsEvent(value)) return false;
  if (value.type !== 'action.applied') return false;
  const data = value.data as Record<string, unknown> | undefined;
  if (typeof data !== 'object' || data === null) return false;
  if (typeof data['actionId'] !== 'string' || data['actionId'].length === 0) return false;
  if (typeof data['nodePath'] !== 'string' || data['nodePath'].length === 0) return false;
  return true;
}

/**
 * `job.submitted` event payload, the canonical queue-lifecycle envelope of
 * `spec/job-events.md` §job.submitted: broadcast by
 * `POST /api/nodes/:pathB64/jobs` AND relayed verbatim from the CLI push
 * leg (`POST /api/job-events`), so every connected client flips the
 * matching launcher button to `queued` regardless of which surface
 * submitted. The job id rides the ENVELOPE (`jobId`), not `data`. The
 * record credential (nonce) NEVER rides this event.
 */
export interface IWsJobSubmittedData {
  nodePath: string;
  /** Qualified extension id the submit resolved to. */
  extensionId: string;
  /** Stale queued sibling ids a fixer submit superseded (usually empty). */
  supersededIds: string[];
}

export type IWsJobSubmittedEvent = IWsEvent<IWsJobSubmittedData> & {
  type: 'job.submitted';
  jobId: string;
};

export function isJobSubmittedEvent(value: unknown): value is IWsJobSubmittedEvent {
  if (!isWsEvent(value)) return false;
  if (value.type !== 'job.submitted') return false;
  if (typeof value.jobId !== 'string' || value.jobId.length === 0) return false;
  const data = value.data as Record<string, unknown> | undefined;
  if (typeof data !== 'object' || data === null) return false;
  if (typeof data['nodePath'] !== 'string' || data['nodePath'].length === 0) return false;
  if (typeof data['extensionId'] !== 'string' || data['extensionId'].length === 0) return false;
  if (!Array.isArray(data['supersededIds'])) return false;
  return true;
}

/**
 * `job.completed` event payload, per `spec/job-events.md` §job.completed:
 * the run's accounting (`extensionId` / `extensionKind`, duration, token
 * counts, model) plus the `executionId` that points at the
 * `state_executions` row holding the report. The report itself is
 * deliberately NOT inlined, events stay small and consumers query the
 * row. The job id rides the ENVELOPE (`jobId`), not `data`.
 *
 * Every field is optional: the SPA reads a couple of them
 * opportunistically, and the spec's forward-compat rule forbids dropping
 * a frame over a field a given emitter did not fill.
 */
export interface IWsJobCompletedData {
  /** Qualified extension id the job ran. */
  extensionId?: string;
  /** Kind of that extension (`analyzer`, `action`, ...). */
  extensionKind?: string;
  /** The job's frozen target node path (absent on pre-2026-07-26
   *  servers); consumers key node-scoped reactions on it, e.g. the
   *  tagger proposal. */
  nodeId?: string;
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  model?: string;
  /** `state_executions` row holding the report payload (`report_json`). */
  executionId?: string;
  /**
   * TAGGER-only: the tags the model inferred on this run
   * (`spec/job-lifecycle.md` §Tags proposal, `spec/job-events.md`
   * §job.completed). A PROPOSAL, and only ever that. The record path
   * writes NOTHING, so there is no "applied" partner field and no
   * refusal to report: nothing is ever applied by the machine.
   *
   * Tags are human curation (`spec/architecture.md` §Storage rule), so a
   * consumer MUST NOT apply this on the operator's behalf. The only
   * legitimate use is to pre-fill the ORDINARY tags editor, where the
   * operator prunes it and saves under their own hand, through the usual
   * `.sm` confirm-required handshake. Absent on every non-tagger job and
   * on a tagger whose report carried no usable tags.
   */
  tagsProposed?: string[];
}

export type IWsJobCompletedEvent = IWsEvent<IWsJobCompletedData> & {
  type: 'job.completed';
};

/**
 * Loose guard for `job.completed`. Mirrors `isJobSubmittedEvent`'s
 * envelope check but validates NO payload field, because every key on
 * `IWsJobCompletedData` is optional: a frame is narrowable as soon as
 * `data` is an object, and consumers read the fields they care about
 * defensively (`=== true`, `Array.isArray`).
 */
export function isJobCompletedEvent(value: unknown): value is IWsJobCompletedEvent {
  if (!isWsEvent(value)) return false;
  if (value.type !== 'job.completed') return false;
  const data = value.data;
  return typeof data === 'object' && data !== null;
}

/**
 * `node.activity` event payload, broadcast by `POST /api/activity` (live
 * node activity, `spec/provider-activity.md` §WS event). One envelope per
 * provider-runtime signal that RESOLVED to a scanned node; the payload is
 * intentionally minimal (nothing from the raw provider event survives
 * past the BFF mapper). Consumers narrow on
 * `event.type === 'node.activity'` and read
 * `event.data.{nodePath, phase, owner}`.
 */
export interface IWsNodeActivityData {
  /**
   * Resolved scanned node's stable id (its `path`). ABSENT on the
   * node-less OWNER-RELEASE form (`phase: 'end'` + `ownerScope: true`):
   * a whole execution context ended (e.g. an Antigravity conversation
   * going idle) and every claim its `owner` holds must release.
   */
  nodePath?: string;
  /** `start` lights the node; `end` exists only for natively-terminated units. */
  phase: 'start' | 'end';
  /** Opaque executing-context grouping key (`'main'`, an agent id, ...). */
  owner?: string;
  /**
   * Only on `phase: 'end'`: the owner's whole execution context ended (a
   * subagent terminated); every claim held by that `owner` is released,
   * not just this node's.
   */
  ownerScope?: boolean;
  /**
   * Only on `phase: 'start'`: lifecycle claim (an agent's own span, a
   * parent held lit by a running child). Gets a much longer decay
   * window; meant to end via an `ownerScope` end.
   */
  sticky?: boolean;
  /**
   * Only on `phase: 'start'`: CUSTODY claim (a parent held lit through
   * a spawn, `spec/provider-activity.md` §parent custody). Lights and
   * refreshes like any other start but is EXCLUDED from execution
   * counting server-side and SHOULD NOT trigger "executed" affordances.
   */
  keepAlive?: boolean;
  /**
   * Only on node-attributed frames: the node's current execution stats
   * as accumulated server-side (§Execution stats). The server is the
   * single source of truth: clients MUST overwrite from this field
   * (and from the summary snapshot), never accumulate counts locally.
   */
  stats?: INodeActivityStatsApi;
  /**
   * Which tool this frame represents when the node is a tool-shaped unit
   * (e.g. the invoked MCP tool name on an `mcp://<server>` node,
   * `spec/provider-activity.md` §WS event: node.activity). Carried on
   * `phase: 'start'` frames; the UI paints it as a transient label on
   * the executing node. Absent when the frame has no tool identity.
   */
  detail?: string;
  /**
   * Access classification for a RESOURCE frame
   * (`spec/provider-activity.md` §WS event: `node.activity`): `'mcp'`
   * when the node is an `mcp://` server (a tool invocation), `'read'`
   * when it is a file a unit read. Absent for a UNIT's own execution
   * (a skill / agent / command start). Stamped by the server-side
   * resolver from the signal shape; consumed by the session index's
   * step rows (typed internal steps).
   */
  access?: 'mcp' | 'read' | 'write' | 'shell';
  /**
   * The session id the frame's `owner` belongs to. A frame that carries
   * BOTH `owner` and `session` establishes that owner's session
   * membership, so a later session-scoped end can release every owner
   * grouped under the same session.
   */
  session?: string;
  /**
   * Only on `phase: 'end'`: SESSION-scoped release. A NODE-LESS frame
   * (`nodePath` absent, `owner` absent) carrying `sessionScope: true` +
   * `session` means "the whole session ended: release EVERY owner
   * grouped under `session`". It is the sibling of the `ownerScope` end
   * (which releases one owner), healing a live glow when a subagent's
   * own end signal was dropped but its session end still arrives.
   */
  sessionScope?: boolean;
  /**
   * Only on an `ownerScope` end: the end is TERMINAL, so the spawns
   * that owner PARENTS release with it, not just the ones where it is
   * the child. Stamped by the server for runtimes whose spawn custody
   * is `blocking` (the parent blocks inside the spawn call, so it
   * cannot report idle while a child runs). Absent for `napping`
   * runtimes, where the pause-is-not-end rule applies because the same
   * frame may mean the parent is merely awaiting its own spawn.
   */
  terminal?: boolean;
  /**
   * Only on `phase: 'end'`: node-less TURN-END form (`owner` required).
   * The owner's turn completed (a napping runtime's main context, e.g.
   * Claude's main `Stop`), so the sync spawn relations it parents
   * (no `childOwner`) are provably dead and release; async relations
   * and node claims stay untouched. Narrower than `ownerScope` +
   * `terminal` by design (spec §WS event: `node.activity`).
   */
  turnEnd?: boolean;
}

export type IWsNodeActivityEvent = IWsEvent<IWsNodeActivityData> & { type: 'node.activity' };

export function isNodeActivityEvent(value: unknown): value is IWsNodeActivityEvent {
  if (!isWsEvent(value)) return false;
  if (value.type !== 'node.activity') return false;
  const data = value.data as Record<string, unknown> | undefined;
  if (typeof data !== 'object' || data === null) return false;
  const nodePath = data['nodePath'];
  if (nodePath === undefined) {
    // Node-less forms, all `phase: 'end'` (spec §WS event: node.activity):
    //   - OWNER RELEASE: `ownerScope: true` + `owner` (a context ended);
    //   - TURN END: `turnEnd: true` + `owner` (sync spawn sweep);
    //   - SESSION RELEASE: `sessionScope: true` + `session` (a whole
    //     runtime turn ended, releasing every owner grouped under it).
    if (data['phase'] !== 'end') return false;
    if (data['sessionScope'] === true) {
      if (typeof data['session'] !== 'string' || data['session'].length === 0) return false;
    } else {
      if (data['ownerScope'] !== true && data['turnEnd'] !== true) return false;
      if (typeof data['owner'] !== 'string' || data['owner'].length === 0) return false;
    }
  } else if (typeof nodePath !== 'string' || nodePath.length === 0) {
    return false;
  }
  if (data['phase'] !== 'start' && data['phase'] !== 'end') return false;
  const owner = data['owner'];
  if (owner !== undefined && typeof owner !== 'string') return false;
  const ownerScope = data['ownerScope'];
  if (ownerScope !== undefined && typeof ownerScope !== 'boolean') return false;
  const turnEnd = data['turnEnd'];
  if (turnEnd !== undefined && typeof turnEnd !== 'boolean') return false;
  const sticky = data['sticky'];
  if (sticky !== undefined && typeof sticky !== 'boolean') return false;
  const keepAlive = data['keepAlive'];
  if (keepAlive !== undefined && typeof keepAlive !== 'boolean') return false;
  const detail = data['detail'];
  if (detail !== undefined && typeof detail !== 'string') return false;
  const stats = data['stats'];
  if (stats !== undefined) {
    // Loose per the forward-compat rule: only the load-bearing `count`
    // is validated; extra / missing metadata fields never drop a frame.
    if (typeof stats !== 'object' || stats === null) return false;
    if (typeof (stats as Record<string, unknown>)['count'] !== 'number') return false;
  }
  return true;
}

/**
 * `agent.spawn` event payload (`spec/provider-activity.md` §WS event:
 * `agent.spawn`). One frame per spawn relation a provider signal
 * reported. Frames are STATELESS and self-contained: the server keeps
 * no spawn registry, so parent fields repeat on every frame and
 * consumers correlate by `spawnId`.
 *
 * The parent is EITHER a scanned agent node (`parentNodePath` present)
 * OR a session context (`parentNodePath` ABSENT); `parentOwner` is
 * always present and stays an opaque key consumers MUST NOT parse. The
 * client derives its "session parent" view from the absence of
 * `parentNodePath`, never from the owner string's shape.
 *
 * Conversation content (`prompt` / `response`) NEVER rides this event;
 * it is served on demand under the capture gate (§Conversation
 * capture).
 */
export interface IWsAgentSpawnData {
  /** Opaque per-spawn correlation id (the spawning tool call's id). */
  spawnId: string;
  /**
   * `start` at the spawn call; `handoff` when an async child's own
   * owner id becomes known (`childOwner` present from then on); `end`
   * when the spawn completed with no live child.
   */
  phase: 'start' | 'handoff' | 'end';
  /** Owner key of the spawning context (opaque, never parsed). */
  parentOwner: string;
  /** Scanned parent agent's node path; ABSENT for session parents. */
  parentNodePath?: string;
  /** The child unit as the runtime named it. */
  childKind?: string;
  childName?: string;
  /** Present when the child name resolved against the scanned node set. */
  childNodePath?: string;
  /** The child context's own owner id, present from `handoff` on. */
  childOwner?: string;
  /**
   * Accumulated spawn count for this parent-child pair
   * (`spec/provider-activity.md` §Execution stats), present on frames
   * whose pair is counted. OVERWRITE semantics: the server is the
   * single source of truth and the client never accumulates.
   */
  pairCount?: number;
}

export type IWsAgentSpawnEvent = IWsEvent<IWsAgentSpawnData> & { type: 'agent.spawn' };

export function isAgentSpawnEvent(value: unknown): value is IWsAgentSpawnEvent {
  if (!isWsEvent(value)) return false;
  if (value.type !== 'agent.spawn') return false;
  const data = value.data as Record<string, unknown> | undefined;
  if (typeof data !== 'object' || data === null) return false;
  if (typeof data['spawnId'] !== 'string' || data['spawnId'].length === 0) return false;
  const phase = data['phase'];
  if (phase !== 'start' && phase !== 'handoff' && phase !== 'end') return false;
  if (typeof data['parentOwner'] !== 'string' || data['parentOwner'].length === 0) return false;
  // Typed optionals: when present they must be non-empty strings. The
  // empty string is rejected on `parentNodePath` in particular because
  // its ABSENCE is the session-parent discriminator, an empty value
  // would be ambiguous.
  for (const key of ['parentNodePath', 'childKind', 'childName', 'childNodePath', 'childOwner']) {
    const v = data[key];
    if (v !== undefined && (typeof v !== 'string' || v.length === 0)) return false;
  }
  const pairCount = data['pairCount'];
  if (pairCount !== undefined && typeof pairCount !== 'number') return false;
  return true;
}

/**
 * Normalize the envelope's timestamp to unix-ms regardless of which form
 * the BFF emitted (kernel emitter → ISO-8601 string, watcher advisories →
 * `Date.now()` number). Returns `Date.now()` as a defensive fallback when
 * the input is unparseable so the event log row always has a render
 * value, a malformed timestamp is not worth dropping the event over.
 */
export function wsEventTimestampMs(event: IWsEvent): number {
  const ts = event.timestamp;
  if (typeof ts === 'number') return ts;
  const parsed = Date.parse(ts);
  if (Number.isFinite(parsed)) return parsed;
  return Date.now();
}
