/**
 * AI actions card state (Step 16 piece 1, the findings workbench,
 * inspector half): the per-node probabilistic findings tray plus the
 * finder / fixer / standalone launcher buttons.
 *
 * Mirrors the `inspector-body-state` / `inspector-dead-link` pattern: a
 * `setupAiActions` factory called from a field initializer (injection
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
  isSmConsentRequired,
  type ISmConsentGrant,
} from '../../../services/action-dispatch';
import {
  DataSourceError,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';

/**
 * The two hidden buckets the tray can reveal (the CLI's bucket flags).
 * Stale stopped being a bucket on 2026-07-20: stale rows ride the
 * default tray inline with a per-row mark.
 */
export type TFindingsBucket = 'dismissed' | 'fixed';

/**
 * Debounce for the live re-fetch. `job.*` frames arrive in bursts when a
 * processing agent drains the queue (claim + record back-to-back);
 * coalescing them into one trailing round-trip keeps the card fresh
 * without a request per frame. Same rationale (and window) as the
 * Activity section's `ACTIVITY_LIVE_REFRESH_DEBOUNCE_MS`.
 */
const AI_ACTIONS_LIVE_REFRESH_DEBOUNCE_MS = 400;

/** Submit-failure surface bound by the card's error line. */
export interface IAiActionsError {
  /** BFF envelope code (`no-processing-agent`, `node-drifted`, ...). */
  code: string;
  /** Envelope message, rendered verbatim after the prefix. */
  message: string;
}

export interface IAiActionsSetupDeps {
  /** The inspected node (tracked so a scan reload re-fetches). */
  node: Signal<INodeView | null>;
  dataSource: IDataSourcePort;
  /** Every `job.*` envelope (submitted / claimed / completed / ...). */
  jobEvents$: Observable<IWsEvent>;
  /** Watcher re-scan signal, findings staleness derives from the scan. */
  scanCompleted$: Observable<IWsScanCompletedEvent>;
  /**
   * Park a `.sm`-consent retry behind the shared consent dialog
   * (`ActionDispatchService.requestSmConsent`): the dismiss / restore
   * flows hit the same gate the action buttons do, and reuse the same
   * dialog instance.
   */
  requestSmConsent(retry: (grant: ISmConsentGrant) => void): void;
}

export interface IAiActionsHandle {
  /** Fresh (open, non-stale) finding rows, server order. */
  findings: Signal<IFindingApi[]>;
  /** Envelope counts incl. the honesty pair; `null` until first load. */
  counts: Signal<IFindingsCountsApi | null>;
  /** Launcher catalog; `null` until first load / on 404. */
  probExtensions: Signal<IProbExtensionsApi | null>;
  /** Whether the AI actions card renders at all. */
  available: Signal<boolean>;
  /** Last submit failure, or `null`. */
  error: Signal<IAiActionsError | null>;
  /** Effective launcher state: the optimistic `queued` / `idle` flips win over a stale payload. */
  entryState(entry: IProbExtensionEntryApi): 'idle' | 'queued' | 'running';
  /** True while this extension's submit round-trip is in flight. */
  isSubmitting(extensionId: string): boolean;
  /** True while this extension's stop flow is in flight. */
  isCancelling(extensionId: string): boolean;
  /**
   * Enqueue `extensionId` against the inspected node, optimistically
   * flipping its button to `queued`. `autoFix` (default `false`) rides
   * the submit body so a finder can freeze the kernel's auto-fix chain.
   */
  submit(extensionId: string, autoFix?: boolean): Promise<void>;
  /**
   * Fix state of a two-state finder button: submit each of the finder's
   * `fixerIds` (autoFix `false`), keyed to the FINDER's button so it
   * shows the in-flight busy state. No optimistic `queued` flip: the
   * finder itself is not queued, only its fixers are, and the button
   * morphs back to Detect once the fixer resolves the open findings.
   */
  submitFixers(finderId: string, fixerIds: readonly string[]): Promise<void>;
  /** Cancel the entry's active job (the stop companion). */
  stop(entry: IProbExtensionEntryApi): Promise<void>;
  dismissError(): void;

  // --- per-finding actions (the read-time suppression lens) ---------------
  /** Dismiss a finding directly (consent-aware; hides the class, reversible). */
  dismissFinding(finding: IFindingApi): Promise<void>;
  /** Mark a finding fixed by the operator. */
  resolveFinding(finding: IFindingApi): Promise<void>;
  /** Restore (undismiss) a finding from the revealed dismissed bucket. */
  restoreFinding(finding: IFindingApi): Promise<void>;
  /** Hard-delete a revealed dismissed / fixed row from the DB (no consent). */
  deleteFinding(finding: IFindingApi): Promise<void>;
  /** True while a per-finding round-trip is in flight for this id. */
  isFindingBusy(findingId: number): boolean;

  // --- hidden buckets (dismissed / fixed / stale) --------------------------
  /** The bucket currently revealed under the tray, or `null`. */
  revealedBucket: Signal<TFindingsBucket | null>;
  /** Rows of the revealed bucket (empty while none / loading). */
  revealedRows: Signal<IFindingApi[]>;
  /** Toggle a bucket's reveal (one at a time; same bucket toggles off). */
  toggleBucket(bucket: TFindingsBucket): Promise<void>;
}

export function setupAiActions(deps: IAiActionsSetupDeps): IAiActionsHandle {
  assertInInjectionContext(setupAiActions);

  const findings = signal<IFindingApi[]>([]);
  const counts = signal<IFindingsCountsApi | null>(null);
  const probExtensions = signal<IProbExtensionsApi | null>(null);
  const error = signal<IAiActionsError | null>(null);
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
  /** Finding ids with a dismiss / resolve / restore round-trip in flight. */
  const findingBusy = signal<ReadonlySet<number>>(new Set());
  /** The hidden bucket currently revealed under the tray (one at a time). */
  const revealedBucket = signal<TFindingsBucket | null>(null);
  const revealedRows = signal<IFindingApi[]>([]);

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
    // A revealed bucket whose count dropped to zero collapses on its
    // own (user call 2026-07-20: a zero chip must not render, so there
    // would be nothing left to toggle it off with). Transient fetch
    // errors (null counts) keep the reveal, only a confirmed zero closes.
    const bucket = revealedBucket();
    if (bucket !== null && findingsEnv !== null && bucketExcludedCount(findingsEnv.counts, bucket) === 0) {
      revealedBucket.set(null);
      revealedRows.set([]);
      return;
    }
    // Keep an open revealed bucket in step with the default view.
    void refreshRevealed(path);
  }

  /** The hidden-count field backing one bucket's chip. */
  function bucketExcludedCount(c: IFindingsCountsApi, bucket: TFindingsBucket): number {
    return bucket === 'dismissed' ? c.dismissedExcluded : c.fixedExcluded;
  }

  /** Re-fetch the revealed bucket's rows (no-op when none is open). */
  async function refreshRevealed(path: string): Promise<void> {
    const bucket = revealedBucket();
    if (bucket === null) return;
    const env = await deps.dataSource.getNodeFindings(path, bucket).catch(() => null);
    // Guard both the path and the bucket (the user may have toggled away
    // while the round-trip was in flight).
    if (fetchedPath !== path || revealedBucket() !== bucket) return;
    revealedRows.set(env?.items ?? []);
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
    for (const entry of [...probs.finders, ...probs.standalone]) {
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
      // Navigation: the previous node's AI actions must not linger.
      findings.set([]);
      counts.set(null);
      probExtensions.set(null);
      error.set(null);
      optimisticQueued.set(new Set());
      optimisticIdle.set(new Set());
      findingBusy.set(new Set());
      revealedBucket.set(null);
      revealedRows.set([]);
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
    .pipe(debounceTime(AI_ACTIONS_LIVE_REFRESH_DEBOUNCE_MS), takeUntilDestroyed())
    .subscribe(() => {
      const path = fetchedPath;
      if (!path) return;
      void fetchBoth(path);
    });

  const available = computed<boolean>(() => {
    // Fresh findings, at least one launcher, or HELD-BACK rows: since the
    // hidden-buckets chips landed (the reveal / restore surface), a
    // hidden-only card carries real content again, and hiding it would
    // strand an all-dismissed node with no way to restore. (Between
    // 2026-07-17 and the chips, held-back counts alone rendered
    // title-only and did NOT keep the card up.)
    if (findings().length > 0) return true;
    const c = counts();
    if (c !== null && c.dismissedExcluded + c.fixedExcluded > 0) return true;
    const probs = probExtensions();
    if (probs === null) return false;
    return probs.finders.length > 0 || probs.standalone.length > 0;
  });

  /** Record a submit failure in the error strip (non-`DataSourceError` too). */
  function recordSubmitError(err: unknown): void {
    if (err instanceof DataSourceError) {
      error.set({ code: err.code, message: err.message });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      error.set({ code: 'internal', message });
    }
  }

  async function submit(extensionId: string, autoFix = false): Promise<void> {
    const path = deps.node()?.path;
    if (!path || submitting().has(extensionId)) return;
    error.set(null);
    submitting.update((s) => new Set(s).add(extensionId));
    try {
      await deps.dataSource.submitNodeJob(path, extensionId, autoFix);
      // Optimistic flip; the job.submitted WS broadcast (and the
      // debounced re-fetch it triggers) confirms server-side.
      flipToQueued(extensionId);
    } catch (err) {
      if (err instanceof DataSourceError && err.code === 'duplicate-job') {
        // An identical active job already exists: the button's real
        // state IS queued, not an error worth banner-ing.
        flipToQueued(extensionId);
      } else {
        recordSubmitError(err);
      }
    } finally {
      submitting.update((s) => {
        const next = new Set(s);
        next.delete(extensionId);
        return next;
      });
    }
  }

  async function submitFixers(
    finderId: string,
    fixerIds: readonly string[],
  ): Promise<void> {
    const path = deps.node()?.path;
    if (!path || fixerIds.length === 0 || submitting().has(finderId)) return;
    error.set(null);
    // Key the busy state on the FINDER's button (the fixer entries are
    // not rendered), so the two-state button shows a spinner + disables
    // during the round-trip. No `queued` flip: the finder is not queued.
    submitting.update((s) => new Set(s).add(finderId));
    try {
      for (const fixerId of fixerIds) {
        try {
          await deps.dataSource.submitNodeJob(path, fixerId, false);
        } catch (err) {
          // A duplicate fixer job is already active (e.g. a double-click
          // or the global auto-fix hook beat us): harmless, keep chaining.
          if (err instanceof DataSourceError && err.code === 'duplicate-job') continue;
          throw err;
        }
      }
    } catch (err) {
      recordSubmitError(err);
    } finally {
      submitting.update((s) => {
        const next = new Set(s);
        next.delete(finderId);
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


  /** Immutable add / remove for the per-finding busy set. */
  function setFindingBusy(id: number, busy: boolean): void {
    findingBusy.update((s) => {
      const next = new Set(s);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Re-fetch the whole tray (default view + revealed bucket). */
  function refreshTray(): void {
    const path = fetchedPath;
    if (path) void fetchBoth(path);
  }

  /**
   * Dismiss one finding directly (the read-time suppression lens: the
   * class hides, rows kept, reversible, no prompt). Consent-aware: a
   * first-write `.sm` gate parks a retry behind the shared consent dialog
   * and re-runs with the granted flags; the busy marker covers each
   * attempt.
   */
  async function dismissFinding(
    finding: IFindingApi,
    consent: ISmConsentGrant | Record<string, never> = {},
  ): Promise<void> {
    const path = deps.node()?.path;
    if (!path || findingBusy().has(finding.id)) return;
    error.set(null);
    setFindingBusy(finding.id, true);
    try {
      await deps.dataSource.dismissFinding(path, finding.id, consent);
    } catch (err) {
      if (!('confirm' in consent) && isSmConsentRequired(err)) {
        deps.requestSmConsent((grant) => void dismissFinding(finding, grant));
        return; // busy + refresh settle in finally; the retry re-enters
      }
      recordSubmitError(err);
    } finally {
      setFindingBusy(finding.id, false);
      refreshTray();
    }
  }

  /** Restore (undismiss) a finding from the revealed dismissed bucket. */
  async function restoreFinding(
    finding: IFindingApi,
    consent: ISmConsentGrant | Record<string, never> = {},
  ): Promise<void> {
    const path = deps.node()?.path;
    if (!path || findingBusy().has(finding.id)) return;
    error.set(null);
    setFindingBusy(finding.id, true);
    try {
      await deps.dataSource.undismissFinding(
        path,
        { extension: finding.extensionId, type: finding.type },
        consent,
      );
    } catch (err) {
      if (!('confirm' in consent) && isSmConsentRequired(err)) {
        deps.requestSmConsent((grant) => void restoreFinding(finding, grant));
        return;
      }
      recordSubmitError(err);
    } finally {
      setFindingBusy(finding.id, false);
      refreshTray();
    }
  }

  /** Mark a finding fixed by the operator (no consent, a DB row state). */
  async function resolveFinding(finding: IFindingApi): Promise<void> {
    const path = deps.node()?.path;
    if (!path || findingBusy().has(finding.id)) return;
    error.set(null);
    setFindingBusy(finding.id, true);
    try {
      await deps.dataSource.resolveFinding(path, finding.id);
    } catch (err) {
      recordSubmitError(err);
    } finally {
      setFindingBusy(finding.id, false);
      refreshTray();
    }
  }

  /**
   * Hard-delete a finding row from the DB (the X on a REVEALED dismissed
   * / fixed row: the row is already handled, the operator wants it gone
   * for good). Deleting the last row of a dismissed class also lifts its
   * suppression entry server-side, so the call is consent-aware like
   * dismiss: a first-write `.sm` gate parks a retry behind the shared
   * consent dialog.
   */
  async function deleteFinding(
    finding: IFindingApi,
    consent: ISmConsentGrant | Record<string, never> = {},
  ): Promise<void> {
    const path = deps.node()?.path;
    if (!path || findingBusy().has(finding.id)) return;
    error.set(null);
    setFindingBusy(finding.id, true);
    try {
      await deps.dataSource.deleteFinding(path, finding.id, consent);
    } catch (err) {
      if (!('confirm' in consent) && isSmConsentRequired(err)) {
        deps.requestSmConsent((grant) => void deleteFinding(finding, grant));
        return;
      }
      recordSubmitError(err);
    } finally {
      setFindingBusy(finding.id, false);
      refreshTray();
    }
  }

  /** Reveal / hide one hidden bucket (one at a time). */
  async function toggleBucket(bucket: TFindingsBucket): Promise<void> {
    const path = deps.node()?.path;
    if (!path) return;
    if (revealedBucket() === bucket) {
      revealedBucket.set(null);
      revealedRows.set([]);
      return;
    }
    revealedBucket.set(bucket);
    revealedRows.set([]);
    await refreshRevealed(path);
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
    submitFixers,
    stop,
    dismissError: () => error.set(null),
    dismissFinding: (finding) => dismissFinding(finding),
    resolveFinding,
    restoreFinding: (finding) => restoreFinding(finding),
    deleteFinding: (finding) => deleteFinding(finding),
    isFindingBusy: (findingId) => findingBusy().has(findingId),
    revealedBucket: revealedBucket.asReadonly(),
    revealedRows: revealedRows.asReadonly(),
    toggleBucket,
  };
}
