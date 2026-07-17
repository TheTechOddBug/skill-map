/**
 * Judgments card state (Step 16 piece 1, the findings workbench,
 * inspector half): the per-node probabilistic findings tray plus the
 * finder / fixer / standalone launcher buttons.
 *
 * Mirrors the `inspector-body-state` / `inspector-dead-link` pattern: a
 * `setupJudgments` factory called from a field initializer (injection
 * context) returns a typed handle the component binds. Owns:
 *
 *   - The two per-node reads (`getNodeFindings`, `getNodeProbExtensions`),
 *     fetched eagerly on every node change with the same
 *     navigation-reset / silent-same-path-refresh contract as the
 *     deterministic issues effect (reset only on a path change so a
 *     watcher re-scan never flickers the card).
 *   - The live refresh: any `job.*` WS frame or a `scan.completed` frame
 *     re-fetches both reads (debounced). Record-side `job.*` events
 *     carry a `jobId` but no node path, so rather than correlating ids
 *     client-side the handle simply re-fetches the authoritative state,
 *     the same posture as the Activity section's live refresh.
 *   - The submit flow (`submit(extensionId)`): POST via the data-source
 *     port, optimistic `queued` flip on success (the `job.submitted` WS
 *     broadcast confirms for every other client), `duplicate-job`
 *     treated as already queued, `no-processing-agent` surfaced with the
 *     `sm agent install` hint, every other envelope message rendered in
 *     the card's error line.
 *   - The stop flow (user decision 2026-07-17): `stop(entry)`
 *     cancels the entry's ACTIVE job (`entry.jobId`, the
 *     server-confirmed handle) via `POST /api/jobs/:jobId/cancel` with
 *     an optimistic `idle` flip (the `job.cancelled` WS broadcast plus
 *     the debounced re-fetch confirm); a `job-terminal` refusal is NOT
 *     an error, the job finished in the race and the handle just
 *     re-fetches. (A restart twin existed briefly and was dropped the
 *     same day: stop + the launcher button covers the flow.)
 */

import { assertInInjectionContext, computed, effect, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, merge, type Observable } from 'rxjs';

import type {
  IFindingApi,
  IFindingsCountsApi,
  IProbExtensionEntryApi,
  IProbExtensionsApi,
} from '../../../models/api';
import type { INodeView } from '../../../models/node';
import type { IWsEvent, IWsScanCompletedEvent } from '../../../models/ws-event';
import {
  DataSourceError,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';

/**
 * Debounce for the live re-fetch. `job.*` frames arrive in bursts when a
 * processing agent drains the queue (claim + record back-to-back);
 * coalescing them into one trailing round-trip keeps the card fresh
 * without a request per frame. Same rationale (and window) as the
 * Activity section's `ACTIVITY_LIVE_REFRESH_DEBOUNCE_MS`.
 */
const JUDGMENTS_LIVE_REFRESH_DEBOUNCE_MS = 400;

/** Submit-failure surface bound by the card's error line. */
export interface IJudgmentsError {
  /** BFF envelope code (`no-processing-agent`, `node-drifted`, ...). */
  code: string;
  /** Envelope message, rendered verbatim after the prefix. */
  message: string;
}

export interface IJudgmentsSetupDeps {
  /** The inspected node (tracked so a scan reload re-fetches). */
  node: Signal<INodeView | null>;
  dataSource: IDataSourcePort;
  /** Every `job.*` envelope (submitted / claimed / completed / ...). */
  jobEvents$: Observable<IWsEvent>;
  /** Watcher re-scan signal, findings staleness derives from the scan. */
  scanCompleted$: Observable<IWsScanCompletedEvent>;
}

export interface IJudgmentsHandle {
  /** Fresh (open, non-stale) finding rows, server order. */
  findings: Signal<IFindingApi[]>;
  /** Envelope counts incl. the honesty pair; `null` until first load. */
  counts: Signal<IFindingsCountsApi | null>;
  /** Launcher catalog; `null` until first load / on 404. */
  probExtensions: Signal<IProbExtensionsApi | null>;
  /** Whether the Judgments card renders at all. */
  available: Signal<boolean>;
  /** Last submit failure, or `null`. */
  error: Signal<IJudgmentsError | null>;
  /** Effective launcher state: the optimistic `queued` / `idle` flips win over a stale payload. */
  entryState(entry: IProbExtensionEntryApi): 'idle' | 'queued' | 'running';
  /** True while this extension's submit round-trip is in flight. */
  isSubmitting(extensionId: string): boolean;
  /** True while this extension's stop flow is in flight. */
  isCancelling(extensionId: string): boolean;
  /** Enqueue `extensionId` against the inspected node. */
  submit(extensionId: string): Promise<void>;
  /** Cancel the entry's active job (the stop companion). */
  stop(entry: IProbExtensionEntryApi): Promise<void>;
  dismissError(): void;
}

export function setupJudgments(deps: IJudgmentsSetupDeps): IJudgmentsHandle {
  assertInInjectionContext(setupJudgments);

  const findings = signal<IFindingApi[]>([]);
  const counts = signal<IFindingsCountsApi | null>(null);
  const probExtensions = signal<IProbExtensionsApi | null>(null);
  const error = signal<IJudgmentsError | null>(null);
  /**
   * Extension ids optimistically flipped to `queued` after a submit
   * (or a `duplicate-job` refusal). Reconciled on every fresh
   * prob-extensions payload: an id the server reports non-idle is
   * confirmed and drops out; an id the server still reports idle stays
   * flipped (covers the window between the POST and the broadcast-driven
   * re-fetch on other surfaces).
   */
  const optimisticQueued = signal<ReadonlySet<string>>(new Set());
  /**
   * Mirror of `optimisticQueued` for the stop flow: extension ids
   * optimistically flipped to `idle` after a successful cancel (the
   * server payload still says queued / running until the `job.cancelled`
   * broadcast drives the re-fetch). Reconciled on every fresh payload:
   * an id the server now reports idle is confirmed and drops out. The
   * two sets are mutually exclusive per id (a flip in one direction
   * clears the other).
   */
  const optimisticIdle = signal<ReadonlySet<string>>(new Set());
  const submitting = signal<ReadonlySet<string>>(new Set());
  /** Extension ids with a stop flow in flight (disables the companion). */
  const cancelling = signal<ReadonlySet<string>>(new Set());

  /**
   * Last path the fetch effect ran for. Distinguishes a navigation
   * (reset the card) from a same-path reload (silent refresh, keep the
   * mounted rows so the section never flickers), the same contract as
   * the inspector's deterministic issues effect.
   */
  let fetchedPath: string | undefined = undefined;

  async function fetchBoth(path: string, isCancelled?: () => boolean): Promise<void> {
    const [findingsEnv, probs] = await Promise.all([
      deps.dataSource.getNodeFindings(path).catch(() => null),
      deps.dataSource.getNodeProbExtensions(path).catch(() => null),
    ]);
    // Guard the path (a stale resolve from the node we navigated away
    // from must not overwrite the current node's tray) and, on the
    // effect-driven load, the cleanup flag (a superseded run whose
    // successor fetches the SAME path must not race its fresher write).
    if (fetchedPath !== path || isCancelled?.() === true) return;
    findings.set(findingsEnv?.items ?? []);
    counts.set(findingsEnv?.counts ?? null);
    probExtensions.set(probs);
    if (probs !== null) reconcileOptimistic(probs);
  }

  /**
   * Drop optimistic flips the server has confirmed: a `queued` flip
   * whose entry is no longer idle, an `idle` flip whose entry is no
   * longer active. An id absent from the payload drops out of both
   * (nothing left to override).
   */
  function reconcileOptimistic(probs: IProbExtensionsApi): void {
    const queued = optimisticQueued();
    const idle = optimisticIdle();
    if (queued.size === 0 && idle.size === 0) return;
    const idleIds = new Set<string>();
    const activeIds = new Set<string>();
    for (const entry of [...probs.finders, ...probs.fixers, ...probs.standalone]) {
      if (entry.state === 'idle') idleIds.add(entry.id);
      else activeIds.add(entry.id);
    }
    const nextQueued = new Set([...queued].filter((id) => idleIds.has(id)));
    if (nextQueued.size !== queued.size) optimisticQueued.set(nextQueued);
    const nextIdle = new Set([...idle].filter((id) => activeIds.has(id)));
    if (nextIdle.size !== idle.size) optimisticIdle.set(nextIdle);
  }

  /** Optimistic `queued` flip; clears any opposite `idle` flip for the id. */
  function flipToQueued(extensionId: string): void {
    optimisticQueued.update((s) => new Set(s).add(extensionId));
    optimisticIdle.update((s) => {
      if (!s.has(extensionId)) return s;
      const next = new Set(s);
      next.delete(extensionId);
      return next;
    });
  }

  /** Optimistic `idle` flip; clears any opposite `queued` flip for the id. */
  function flipToIdle(extensionId: string): void {
    optimisticIdle.update((s) => new Set(s).add(extensionId));
    optimisticQueued.update((s) => {
      if (!s.has(extensionId)) return s;
      const next = new Set(s);
      next.delete(extensionId);
      return next;
    });
  }

  // Eager per-node fetch. Tracks `node()` (not just its path) so the
  // effect re-runs both on navigation AND when the persisted scan
  // reloads (stale marking + fixer visibility change with the scan).
  effect((onCleanup) => {
    const path = deps.node()?.path;
    if (path !== fetchedPath) {
      // Navigation: the previous node's judgments must not linger.
      findings.set([]);
      counts.set(null);
      probExtensions.set(null);
      error.set(null);
      optimisticQueued.set(new Set());
      optimisticIdle.set(new Set());
      fetchedPath = path;
    }
    if (!path) return;
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    void fetchBoth(path, () => cancelled);
  });

  // Live refresh: any job lifecycle frame or a completed re-scan makes
  // the tray stale (new findings recorded, queue state moved, fixer
  // visibility changed). One debounced re-fetch of both reads.
  merge(deps.jobEvents$, deps.scanCompleted$)
    .pipe(debounceTime(JUDGMENTS_LIVE_REFRESH_DEBOUNCE_MS), takeUntilDestroyed())
    .subscribe(() => {
      const path = fetchedPath;
      if (!path) return;
      void fetchBoth(path);
    });

  const available = computed<boolean>(() => {
    // Fresh findings or at least one launcher; held-back counts alone no
    // longer keep the card up (the honesty line moved to the Activity
    // timeline, user call 2026-07-17, so a hidden-only card would render
    // title-only).
    if (findings().length > 0) return true;
    const probs = probExtensions();
    if (probs === null) return false;
    return (
      probs.finders.length > 0 || probs.fixers.length > 0 || probs.standalone.length > 0
    );
  });

  async function submit(extensionId: string): Promise<void> {
    const path = deps.node()?.path;
    if (!path || submitting().has(extensionId)) return;
    error.set(null);
    submitting.update((s) => new Set(s).add(extensionId));
    try {
      await deps.dataSource.submitNodeJob(path, extensionId);
      // Optimistic flip; the job.submitted WS broadcast (and the
      // debounced re-fetch it triggers) confirms server-side.
      flipToQueued(extensionId);
    } catch (err) {
      if (err instanceof DataSourceError && err.code === 'duplicate-job') {
        // An identical active job already exists: the button's real
        // state IS queued, not an error worth banner-ing.
        flipToQueued(extensionId);
      } else if (err instanceof DataSourceError) {
        error.set({ code: err.code, message: err.message });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        error.set({ code: 'internal', message });
      }
    } finally {
      submitting.update((s) => {
        const next = new Set(s);
        next.delete(extensionId);
        return next;
      });
    }
  }

  /**
   * Cancel `jobId` and report how it settled. `job-terminal` resolves as
   * `'terminal'` (the job finished in the race, NOT an error to
   * surface); any other failure lands in the error strip and resolves
   * `'failed'`.
   */
  async function cancelActiveJob(jobId: string): Promise<'cancelled' | 'terminal' | 'failed'> {
    try {
      await deps.dataSource.cancelJob(jobId);
      return 'cancelled';
    } catch (err) {
      if (err instanceof DataSourceError && err.code === 'job-terminal') return 'terminal';
      if (err instanceof DataSourceError) {
        error.set({ code: err.code, message: err.message });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        error.set({ code: 'internal', message });
      }
      return 'failed';
    }
  }

  async function stop(entry: IProbExtensionEntryApi): Promise<void> {
    const jobId = entry.jobId;
    if (jobId === null || cancelling().has(entry.id)) return;
    error.set(null);
    cancelling.update((s) => new Set(s).add(entry.id));
    try {
      const outcome = await cancelActiveJob(jobId);
      if (outcome === 'cancelled') {
        // Optimistic flip; the job.cancelled WS broadcast (and the
        // debounced re-fetch it triggers) confirms server-side.
        flipToIdle(entry.id);
      } else if (outcome === 'terminal') {
        // The job finished in the race. No WS cancel frame is coming
        // for it, so re-fetch the authoritative state directly.
        const path = fetchedPath;
        if (path) void fetchBoth(path);
      }
    } finally {
      cancelling.update((s) => {
        const next = new Set(s);
        next.delete(entry.id);
        return next;
      });
    }
  }


  return {
    findings: findings.asReadonly(),
    counts: counts.asReadonly(),
    probExtensions: probExtensions.asReadonly(),
    available,
    error: error.asReadonly(),
    entryState: (entry) => {
      if (entry.state === 'idle') {
        return optimisticQueued().has(entry.id) ? 'queued' : 'idle';
      }
      return optimisticIdle().has(entry.id) ? 'idle' : entry.state;
    },
    isSubmitting: (extensionId) => submitting().has(extensionId),
    isCancelling: (extensionId) => cancelling().has(extensionId),
    submit,
    stop,
    dismissError: () => error.set(null),
  };
}
