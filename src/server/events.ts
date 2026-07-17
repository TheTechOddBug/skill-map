/**
 * WebSocket event envelope shapes for `/ws`, Step 14.4.a surface.
 *
 * Two source-of-truth pointers:
 *
 *   1. The wire envelope is normative in `spec/job-events.md` §Common
 *      envelope (`type`, `timestamp`, `runId`, `jobId`, `data`).
 *   2. The `scan.*` payload shapes are normative in `spec/job-events.md`
 *      §Scan events (`scan.started` line 325, `scan.progress` line 345,
 *      `scan.completed` line 363).
 *
 * The kernel orchestrator (`src/kernel/orchestrator.ts:makeEvent`)
 * already emits these events through `ProgressEmitterPort`. The
 * `WatcherService` bridges the emitter's listener interface to
 * `WsBroadcaster.broadcast(envelope)`, no envelope construction in the
 * BFF is needed for the routine cases. This module exists for the
 * BFF-authored events the kernel does NOT emit:
 *
 *   - `watcher.started` / `watcher.error` (BFF-internal advisories,
 *     NOT in spec/job-events.md). Keep these prefixed with `watcher.`
 *     to make their non-normative status visible to consumers.
 *
 * **Deferred to 14.4.b or 14.5** (flagged TODO):
 *
 *   - `issue.added` / `issue.resolved`. Per spec/job-events.md line 448,
 *     these are emitted "after `scan.completed` when the new scan's
 *     issue set differs from the previous one". The diff requires
 *     comparing the new ScanResult against the prior persisted snapshot
 *     and is intentionally not in scope at 14.4.a (the scan pipeline
 *     does the persist; we emit `scan.completed` and let the SPA
 *     re-fetch `/api/issues` for the v14.4.a iteration).
 *
 *   - `scan.progress`. The kernel's per-node fan-out in
 *     `runScanInternal` already emits `scan.progress` on the underlying
 *     `ProgressEmitterPort`, so the watcher's bridge will broadcast
 *     them as a side effect of the same emitter subscription.
 *     Throttling / dropping under load is not implemented at 14.4.a:
 *     small workspaces are fine; large workspaces are flagged for the
 *     14.6 bundle / perf pass.
 *
 *   - `extractor.completed`, `analyzer.completed` are similarly free side
 *     effects of the emitter bridge, they reach the WS without any
 *     extra plumbing here. They lock down at the same time `scan.*`
 *     does (per spec/job-events.md §Stability, experimental through
 *     spec v0.x).
 */

import { generateRunId } from '../kernel/jobs/index.js';

/**
 * The envelope shape every WebSocket text frame conforms to. Mirrors
 * `spec/job-events.md §Common envelope` exactly.
 *
 * `timestamp` here is whatever the kernel's `ProgressEmitterPort`
 * emitted, today an ISO-8601 string from
 * `src/kernel/orchestrator.ts:makeEvent`. The spec example shows a
 * unix-ms integer; the drift between the impl and the spec lives at the
 * kernel level (the JSON CLI adapter has the same property). Forwarding
 * verbatim keeps the BFF's behavior aligned with the existing CLI
 * surface so the SPA never sees two formats from one backend.
 */
export interface IWsEventEnvelope<T = unknown> {
  type: string;
  /** Either a unix-ms integer or an ISO-8601 string (kernel currently emits ISO). */
  timestamp: number | string;
  runId?: string;
  jobId?: string | null;
  data: T;
}

/**
 * Payload of the `action.applied` WS event (Step 17), broadcast by the
 * generic action-dispatch route (`routes/actions.ts`) after an Action's
 * writes materialise. Carried under the standard `IWsEventEnvelope.data`
 * slot, every WS event the BFF broadcasts wraps its payload in
 * `{ type, timestamp, data }` so the SPA's `isWsEvent` guard validates
 * a single shape (R9 closed at 9.6.7). Mirrors the wire `value` of the
 * `action.applied` REST envelope so a connected client can refresh the
 * affected node without a follow-up fetch.
 */
export interface IActionAppliedEventData {
  /** Qualified action id (`<plugin>/<action>`, e.g. `core/node-bump`). */
  actionId: string;
  /** Scope-relative path of the node the Action operated on. */
  nodePath: string;
  /** The Action's own report object (shape is action-defined). */
  report: unknown;
}

/**
 * Payload of the `node.activity` WS event (live node activity, see
 * `spec/provider-activity.md` §WS event). Broadcast by the ingest route
 * (`routes/activity.ts`) once per signal that RESOLVED to a scanned
 * node; unresolved signals are dropped server-side and never reach the
 * wire. Carries only the minimal shape (nothing from the raw provider
 * event survives past the mapper): the node's stable id, the phase, and
 * an opaque owner grouping key.
 */
export interface INodeActivityEventData {
  /**
   * Resolved scanned node's stable id (its `path`). ABSENT on an
   * OWNER-RELEASE event (`phase: 'end'` + `ownerScope: true` with no
   * node): the end of a whole execution context (a conversation going
   * idle) is inherently node-less; consumers release everything the
   * owner holds.
   */
  nodePath?: string;
  /** `start` lights the node; `end` only exists for natively-terminated units. */
  phase: 'start' | 'end';
  /** Opaque executing-context key (`'main'`, an agent id, ...). Absent when unreported. */
  owner?: string;
  /**
   * Only on `phase: 'end'`: the owner's WHOLE execution context ended
   * (a subagent terminated). Consumers release every claim held by that
   * `owner` (its skills, its markdown reads), not just this node's.
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
   * a spawn). Lights and refreshes like any other start but is
   * EXCLUDED from execution counting, and SHOULD NOT trigger
   * "executed" affordances client-side.
   */
  keepAlive?: boolean;
  /**
   * Optional finer-grained label for this frame: the invoked MCP tool
   * (`notion-create-pages`), etc. Metadata; the UI renders it as the transient
   * glow label and appends it to the node's recent history in the inspector.
   * Absent when the mapper reported none.
   */
  detail?: string;
  /**
   * Access classification for a RESOURCE frame: `'mcp'` when the node is an
   * `mcp://` server (a tool invocation), `'read'` when it is a file a unit read.
   * Absent for a UNIT's own execution (a skill / agent / command start). Set by
   * the resolver from the signal shape (path signal = resource access, name
   * signal = unit execution); drives caller attribution + the typed recent log.
   */
  access?: 'mcp' | 'read';
  /**
   * The node's CURRENT execution stats as accumulated server-side
   * (`activity-stats.ts`), attached by the ingest route to counted
   * starts. The server is the single source of truth: clients MUST
   * overwrite from this field (and from the `/api/activity/summary`
   * snapshot), never accumulate counts themselves.
   */
  stats?: INodeActivityStats;
}

/**
 * Per-node execution stats, the wire projection of one
 * `ActivityStatsService` entry (see `spec/provider-activity.md`
 * §Execution stats). Rides both the `node.activity` `stats` field and
 * the `GET /api/activity/summary` snapshot.
 */
export interface INodeActivityStats {
  /** Executions counted for this node since server boot. */
  count: number;
  /** Unix-ms timestamp of the last counted start. */
  lastStartAt: number;
  /** Owner key of the last counted start; absent when it was ownerless. */
  lastOwner?: string;
  /** Distinct owner keys observed on counted starts (saturating). */
  distinctOwners: number;
  /**
   * Execution aggregates from spawn completion summaries (agent nodes,
   * sync spawns; spec §Execution stats). Absent on nodes that never
   * received a summary. Sums across `summarizedRuns` runs.
   */
  toolUses?: number;
  tokens?: number;
  summarizedRuns?: number;
}

/**
 * Payload of the `agent.spawn` WS event (see `spec/provider-activity.md`
 * §WS event: `agent.spawn`). One STATELESS, self-contained frame per
 * spawn relation a provider signal reported; the server keeps no spawn
 * registry, so parent fields repeat on every frame and consumers
 * correlate by `spawnId`. METADATA ONLY by construction: the
 * conversation halves (`prompt` / `response`) have no field on this
 * shape and never ride the WS (capture-gate custody, §Conversation
 * capture).
 */
export interface IAgentSpawnEventData {
  /** Opaque per-spawn correlation id (the spawning tool call's id). */
  spawnId: string;
  /**
   * `start` at the spawn call; `handoff` when the async child's owner
   * id becomes known; `end` when the spawn completed with no live
   * child.
   */
  phase: 'start' | 'handoff' | 'end';
  /** Owner key of the spawning context (opaque, never parsed). */
  parentOwner: string;
  /**
   * The scanned parent agent's node path. ABSENT when the spawner is a
   * session (the main context): that absence is the structural
   * discriminator for session parents.
   */
  parentNodePath?: string;
  /** Child unit kind as the runtime named it. */
  childKind?: string;
  /** Child unit name as the runtime named it. */
  childName?: string;
  /**
   * Present when `childName` resolved against the scanned node set. An
   * unresolved child is still emitted (name only) so session surfaces
   * can count it, but no edge can target a phantom node.
   */
  childNodePath?: string;
  /** The child context's own owner id, present from `handoff` on. */
  childOwner?: string;
  /**
   * Accumulated spawn count for this parent-child pair (spec
   * §Execution stats, pair counters), present on frames whose pair is
   * tracked. Overwrite semantics: clients never accumulate.
   */
  pairCount?: number;
}

/**
 * Build an `agent.spawn` envelope. Unix-ms timestamp, matching the
 * other BFF-authored events. Callers pass an already-metadata-only
 * `IAgentSpawnEventData`; content stripping happens at the ingest
 * route, this builder cannot re-attach what its type cannot carry.
 */
export function buildAgentSpawnEvent(
  data: IAgentSpawnEventData,
): IWsEventEnvelope<IAgentSpawnEventData> {
  return {
    type: 'agent.spawn',
    timestamp: Date.now(),
    jobId: null,
    data,
  };
}

/**
 * Build a `node.activity` envelope. Unix-ms timestamp, matching the
 * BFF-authored `watcher.*` advisories (the kernel's ISO-8601 form is
 * reserved for emitter-bridged events).
 */
export function buildNodeActivityEvent(
  data: INodeActivityEventData,
): IWsEventEnvelope<INodeActivityEventData> {
  return {
    type: 'node.activity',
    timestamp: Date.now(),
    jobId: null,
    data,
  };
}

/**
 * Payload of the `job.submitted` WS event, the CANONICAL catalog shape
 * (`spec/job-events.md` §`job.submitted`; wired per
 * `spec/cli-contract.md` §BFF endpoint `POST /api/nodes/:pathB64/jobs`,
 * the WS-event row). Broadcast by the node-jobs route on a SUCCESSFUL
 * submit only, so every connected client flips the matching launcher
 * button to `queued`; the same envelope flavor arrives through the
 * `POST /api/job-events` push leg when the submit happened on the CLI,
 * so consumers see ONE `job.submitted` shape regardless of surface. The
 * record-side `job.*` events drive the `running` -> done transitions.
 * The `nonce` record credential has no field on this shape and never
 * rides the WS (it travels only on `sm jobs claim --json`).
 */
export interface IJobSubmittedEventData {
  /** Scope-relative path of the target node. */
  nodePath: string;
  /** The QUALIFIED extension id the submit resolved to. */
  extensionId: string;
  /**
   * Stale queued sibling jobs this (fixer) submit cancelled in the same
   * transaction (`spec/job-lifecycle.md` §Supersede); consumers treat
   * the ids as cancelled without a separate `job.cancelled` per id.
   * Empty on every non-superseding submit.
   */
  supersededIds: string[];
}

/**
 * Build a `job.submitted` envelope (catalog shape,
 * `spec/job-events.md` §`job.submitted`): unix-ms timestamp, a freshly
 * minted `runId` in mode `queue` (a queue-lifecycle transition, not a
 * processing run), the queued job's id on the common-envelope `jobId`
 * slot, and `{ nodePath, extensionId, supersededIds }` as `data`.
 */
export function buildJobSubmittedEvent(
  jobId: string,
  data: IJobSubmittedEventData,
): IWsEventEnvelope<IJobSubmittedEventData> {
  return {
    type: 'job.submitted',
    timestamp: Date.now(),
    runId: generateRunId('queue'),
    jobId,
    data,
  };
}

/** Watcher-internal advisory, fired once when the watcher subscribes successfully. */
export interface IWatcherStartedData {
  roots: string[];
  debounceMs: number;
}

/** Watcher-internal advisory, fired when the underlying chokidar instance errors. */
export interface IWatcherErrorData {
  message: string;
}

/**
 * Build a `watcher.started` envelope. The watcher service emits this on
 * boot once chokidar's initial walk completes so the SPA event-log can
 * mark the live mode as "armed".
 */
export function buildWatcherStartedEvent(
  data: IWatcherStartedData,
): IWsEventEnvelope<IWatcherStartedData> {
  return {
    type: 'watcher.started',
    timestamp: Date.now(),
    jobId: null,
    data,
  };
}

/**
 * Build a `watcher.error` envelope. Emitted when the underlying chokidar
 * watcher surfaces an error (the watcher itself stays open per the
 * `IFsWatcher` contract, this event is purely informational).
 */
export function buildWatcherErrorEvent(
  data: IWatcherErrorData,
): IWsEventEnvelope<IWatcherErrorData> {
  return {
    type: 'watcher.error',
    timestamp: Date.now(),
    jobId: null,
    data,
  };
}
