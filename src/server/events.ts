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
  /** Resolved scanned node's stable id (its `path`). */
  nodePath: string;
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
