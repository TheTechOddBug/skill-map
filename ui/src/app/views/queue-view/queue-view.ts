/**
 * `<sm-queue-view>`, the workspace rail's job-queue inspector.
 *
 * Self-contained like `<sm-files-view>`: no `@Input`s, it injects the
 * data-source port and the WS stream directly. It reads the queue on
 * mount (the rail creates it when the Queue tab becomes active) and
 * re-fetches, debounced, on any `job.*` lifecycle frame, the same live
 * posture as the inspector's AI-actions card.
 *
 * Row actions: an active (queued / running) row can be CANCELLED or FAILED
 * (optimistically flipped, reconciled by the WS broadcast + re-fetch); a
 * terminal row can be RETRIED (a fresh re-submit for the same
 * extension+node, since the lifecycle has no terminal->queued edge). Bulk
 * actions (cancel-all / fail-all all active, prune all terminal) run behind
 * a confirm dialog and re-fetch.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { debounceTime, map, merge } from 'rxjs';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';

import type { IJobApi, TJobStatusApi } from '../../../models/api';
import { shortExtensionLabel } from '../../../models/extension-label';
import {
  DATA_SOURCE,
  DataSourceError,
} from '../../../services/data-source/data-source.port';
import { WsEventStreamService } from '../../../services/ws-event-stream';
import { NODE_OPEN_INTENT } from '../../slots/node-open-intent';
import { QUEUE_VIEW_TEXTS } from './queue-view.texts';

/**
 * Debounce for the live re-fetch, same window as the inspector AI-actions
 * card: `job.*` frames arrive in bursts while a processing agent drains
 * the queue (claim + record back-to-back), so coalescing them into one
 * trailing round-trip keeps the table fresh without a request per frame.
 */
const QUEUE_LIVE_REFRESH_DEBOUNCE_MS = 400;

/**
 * Non-terminal states: still cancellable, and kept flagged after an
 * optimistic cancel until the server confirms the job left them.
 */
const ACTIVE_STATUSES: ReadonlySet<TJobStatusApi> = new Set(['queued', 'running']);

/** Terminal states: retryable (re-submit), and the prune target. */
const TERMINAL_STATUSES: ReadonlySet<TJobStatusApi> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

/** Lifecycle order for the status filter chips (and their stable pulse). */
const ALL_STATUSES: readonly TJobStatusApi[] = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
];

/** One status-filter chip: a tinted glyph, a live count, and its on/off state. */
interface IStatusChip {
  status: TJobStatusApi;
  label: string;
  icon: string;
  count: number;
  active: boolean;
}

/** View projection of one job row (pure, render-ready). */
interface IQueueRow {
  id: string;
  status: TJobStatusApi;
  statusLabel: string;
  statusIcon: string;
  extensionId: string;
  extensionLabel: string;
  /** Extension kind ('analyzer' | 'action' | ...), the tint / icon hook. */
  kind: string;
  /** Glyph telling analyzer vs action apart at a glance (kind is stripped
   *  from the short label, so it rides its own always-visible icon). */
  kindIcon: string;
  /** Human kind name for the icon tooltip / aria label. */
  kindLabel: string;
  nodeId: string;
  age: string;
  ageTooltip: string;
  /** Frozen auto-fix flag, replayed when a failed job is retried. */
  autoFix: boolean;
  /** Active (queued / running): can be cancelled. */
  cancellable: boolean;
  /** Cancel-button tooltip; a running job warns the stop is best-effort. */
  cancelTooltip: string;
  /** Failed: can be retried (a fresh re-submit). */
  retryable: boolean;
}

@Component({
  selector: 'sm-queue-view',
  imports: [
    FormsModule,
    TableModule,
    ButtonModule,
    TooltipModule,
    ProgressSpinnerModule,
    MessageModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    ConfirmDialogModule,
  ],
  // Component-scoped confirm service (the app has no global provider; the
  // established pattern from `graph-view`): each host provides its own.
  providers: [ConfirmationService],
  templateUrl: './queue-view.html',
  styleUrl: './queue-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueueView {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly ws = inject(WsEventStreamService);
  private readonly route = inject(ActivatedRoute);
  private readonly nodeOpenIntent = inject(NODE_OPEN_INTENT);
  private readonly confirmation = inject(ConfirmationService);
  protected readonly texts = QUEUE_VIEW_TEXTS;

  /** Fixed page size for the bottom paginator (the queue pages by 100). */
  protected readonly pageSize = 100;

  /**
   * The selected node, read off the shared `?path` query param (the same
   * selection bus the graph + inspector + files tree use). Every row whose
   * `nodeId` matches lights up, so all jobs for one node highlight together;
   * a row click writes this same param (see `selectNode`), so selection is
   * bidirectional with the map.
   */
  protected readonly selectedNodeId = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('path'))),
    { initialValue: this.route.snapshot.queryParamMap.get('path') },
  );

  private readonly jobs = signal<IJobApi[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /**
   * Job ids optimistically flipped to `cancelled` after a successful cancel;
   * reconciled away once the server reports the job terminal / gone (see
   * `reconcileOptimistic`).
   */
  private readonly optimisticCancelled = signal<ReadonlySet<string>>(new Set());
  /** Job ids with a per-row round-trip in flight (disables that button). */
  private readonly cancelling = signal<ReadonlySet<string>>(new Set());
  private readonly retrying = signal<ReadonlySet<string>>(new Set());

  /**
   * Rendered rows: the fetched jobs projected to the view shape with the
   * optimistic-cancel flip applied. Re-derived when the fetched list or
   * the optimistic set changes; ages are computed against `Date.now()` at
   * that point, so every live re-fetch refreshes them.
   */
  protected readonly rows = computed<IQueueRow[]>(() => {
    const cancelled = this.optimisticCancelled();
    const now = Date.now();
    // Strict age order, newest first: sort by the SAME clock the age cell
    // shows (since-claimed for a running job, else since-created), so the age
    // column reads monotonically top to bottom regardless of status.
    return [...this.jobs()]
      .sort((a, b) => ageBase(b) - ageBase(a))
      .map((job) => this.toRow(job, cancelled.has(job.id) ? 'cancelled' : null, now));
  });

  /** Active (queued + running) job count, drives the bulk cancel / fail. */
  protected readonly activeCount = computed(
    () => this.rows().filter((r) => ACTIVE_STATUSES.has(r.status)).length,
  );
  /** Terminal (completed + failed + cancelled) count, drives "clear finished". */
  protected readonly terminalCount = computed(
    () => this.rows().filter((r) => TERMINAL_STATUSES.has(r.status)).length,
  );
  /** Failed count, drives the narrower "clear failed" button. */
  protected readonly failedCount = computed(
    () => this.rows().filter((r) => r.status === 'failed').length,
  );

  /**
   * Local (client-side) filters over the fetched rows. The search matches a
   * substring against the node and the extension (short label + full id);
   * the status filter is a set of enabled lifecycle states. Both filter the
   * already-live `rows()`, so there is no extra round-trip, the `GET
   * /api/jobs` server filters stay for API consumers.
   */
  protected readonly searchText = signal('');
  /** Enabled statuses. All on by default (the whole queue is visible). */
  protected readonly statusFilter = signal<ReadonlySet<TJobStatusApi>>(
    new Set(ALL_STATUSES),
  );

  /**
   * Status chips: one per lifecycle state in order, each carrying its live
   * count (from the full `rows()`, not the filtered view, so the pulse is
   * stable) and whether it is currently enabled. Doubles as the queue pulse
   * and the status filter control.
   */
  protected readonly statusChips = computed<IStatusChip[]>(() => {
    const counts: Record<TJobStatusApi, number> = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const row of this.rows()) counts[row.status] += 1;
    const active = this.statusFilter();
    return ALL_STATUSES.map((status) => ({
      status,
      label: this.texts.status[status] ?? status,
      icon: chipIcon(status),
      count: counts[status],
      active: active.has(status),
    }));
  });

  /** Rows after the local search + status filter, fed to the table. */
  protected readonly filteredRows = computed<IQueueRow[]>(() => {
    const query = this.searchText().trim().toLowerCase();
    const statuses = this.statusFilter();
    return this.rows().filter((row) => {
      if (!statuses.has(row.status)) return false;
      if (query.length === 0) return true;
      return (
        row.nodeId.toLowerCase().includes(query) ||
        row.extensionLabel.toLowerCase().includes(query) ||
        row.extensionId.toLowerCase().includes(query)
      );
    });
  });

  /**
   * Cold-load spinner: only while the first fetch is in flight and there
   * is nothing to show yet. A live re-fetch keeps the table on screen.
   */
  protected readonly showLoading = computed(
    () => this.loading() && this.jobs().length === 0,
  );

  constructor() {
    void this.fetch();
    // Live refresh: any job lifecycle frame (or a completed re-scan) makes
    // the queue stale. One debounced re-fetch, mirroring the inspector
    // AI-actions card's `merge(jobEvents$, scanCompleted$)` pattern.
    merge(this.ws.jobEvents$, this.ws.scanCompleted$)
      .pipe(debounceTime(QUEUE_LIVE_REFRESH_DEBOUNCE_MS), takeUntilDestroyed())
      .subscribe(() => void this.fetch());
  }

  protected isCancelling(jobId: string): boolean {
    return this.cancelling().has(jobId);
  }

  protected isRetrying(jobId: string): boolean {
    return this.retrying().has(jobId);
  }

  /**
   * Select this row's node: writes the shared `?path` selection so the graph
   * reveals + selects it, the inspector opens it, and every queue row for the
   * same node highlights. The reverse (map selection lighting up the rows)
   * comes for free via `selectedNodeId`.
   */
  protected selectNode(row: IQueueRow): void {
    this.nodeOpenIntent.open(row.nodeId);
  }

  protected onSearchChange(value: string): void {
    this.searchText.set(value);
  }

  protected clearSearch(): void {
    this.searchText.set('');
  }

  /** Toggle a lifecycle state in or out of the visible set. */
  protected toggleStatus(status: TJobStatusApi): void {
    this.statusFilter.update((set) => {
      const next = new Set(set);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  private async fetch(): Promise<void> {
    this.loading.set(true);
    try {
      const jobs = await this.dataSource.listJobs();
      this.jobs.set(jobs);
      this.error.set(null);
      this.reconcileOptimistic(jobs);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Drop optimistic cancels the server has confirmed: a flip whose job is
   * no longer active (terminal or gone) is now reflected by the real
   * status, so the local override is redundant. A flip whose job is still
   * active stays (the cancel has not propagated yet).
   */
  private reconcileOptimistic(jobs: IJobApi[]): void {
    const set = this.optimisticCancelled();
    if (set.size === 0) return;
    const active = new Set<string>();
    for (const job of jobs) {
      if (ACTIVE_STATUSES.has(job.status)) active.add(job.id);
    }
    const next = new Set([...set].filter((id) => active.has(id)));
    if (next.size !== set.size) this.optimisticCancelled.set(next);
  }

  /**
   * Cancel one active job. Optimistically flips the row to `cancelled`; the
   * `job.cancelled` WS broadcast (and the re-fetch it triggers, plus the
   * direct re-fetch here) reconciles server-side. A `job-terminal` refusal
   * is NOT an error, the job finished in the race and the re-fetch settles it.
   */
  protected async cancel(row: IQueueRow): Promise<void> {
    if (this.cancelling().has(row.id)) return;
    this.cancelling.update((s) => withAdded(s, row.id));
    this.optimisticCancelled.update((s) => withAdded(s, row.id));
    try {
      await this.dataSource.cancelJob(row.id);
    } catch (err) {
      if (err instanceof DataSourceError && err.code === 'job-terminal') {
        // Finished in the race: keep the flip, the re-fetch reconciles.
      } else {
        this.optimisticCancelled.update((s) => withRemoved(s, row.id));
        this.error.set(err instanceof Error ? err.message : String(err));
      }
    } finally {
      this.cancelling.update((s) => withRemoved(s, row.id));
      void this.fetch();
    }
  }

  /**
   * Retry a FAILED job: re-submit a fresh job for the same extension + node
   * (the lifecycle has no terminal->queued edge), replaying the frozen
   * `autoFix`. No optimistic flip (this enqueues a NEW row, it does not mutate
   * the failed one). The re-submit still respects preconditions, so a
   * `duplicate-job` refusal (an identical active job already exists) is a
   * no-op, while `node-drifted` / `no-findings` surface as the error; the
   * re-fetch shows the live queued job.
   */
  protected async retry(row: IQueueRow): Promise<void> {
    if (this.retrying().has(row.id)) return;
    this.retrying.update((s) => withAdded(s, row.id));
    try {
      await this.dataSource.submitNodeJob(row.nodeId, row.extensionId, row.autoFix);
      this.error.set(null);
    } catch (err) {
      if (err instanceof DataSourceError && err.code === 'duplicate-job') {
        // Already re-queued: nothing to do.
      } else {
        this.error.set(err instanceof Error ? err.message : String(err));
      }
    } finally {
      this.retrying.update((s) => withRemoved(s, row.id));
      void this.fetch();
    }
  }

  /** Confirm + cancel every active job (`sm jobs cancel --all`). */
  protected confirmCancelAll(): void {
    this.confirmBulk(this.texts.bulk.cancelAll, this.activeCount(), () =>
      this.dataSource.cancelAllJobs(),
    );
  }

  /** Confirm + clear every FAILED job (delete now). */
  protected confirmClearFailed(): void {
    this.confirmBulk(this.texts.bulk.clearFailedConfirm, this.failedCount(), () =>
      this.dataSource.pruneJobs('failed'),
    );
  }

  /** Confirm + clear every terminal job (completed + failed + cancelled). */
  protected confirmClearFinished(): void {
    this.confirmBulk(this.texts.bulk.clearFinishedConfirm, this.terminalCount(), () =>
      this.dataSource.pruneJobs(),
    );
  }

  /**
   * Open the shared confirm dialog for a bulk mutation; on accept run the
   * port op and re-fetch (bulk routes broadcast per id, but prune is silent,
   * so the direct re-fetch is what refreshes THIS client either way).
   */
  private confirmBulk(
    copy: { header: string; accept: string; message: (count: number) => string },
    count: number,
    op: () => Promise<void>,
  ): void {
    this.confirmation.confirm({
      header: copy.header,
      message: copy.message(count),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { label: copy.accept, severity: 'danger' },
      rejectButtonProps: { label: this.texts.bulk.reject, severity: 'secondary', outlined: true },
      accept: () => void this.runBulk(op),
    });
  }

  private async runBulk(op: () => Promise<void>): Promise<void> {
    try {
      await op();
      this.error.set(null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      void this.fetch();
    }
  }

  private toRow(job: IJobApi, optimisticStatus: TJobStatusApi | null, now: number): IQueueRow {
    const status: TJobStatusApi = optimisticStatus ?? job.status;
    // Age reads the current-state clock: since claimed for a running job,
    // else since it entered the queue.
    const base = ageBase(job);
    return {
      id: job.id,
      status,
      statusLabel: this.texts.status[status] ?? status,
      statusIcon: statusIcon(status),
      extensionId: job.extensionId,
      extensionLabel: shortExtensionLabel(job.extensionId),
      kind: job.extensionKind,
      kindIcon: kindIcon(job.extensionKind),
      kindLabel: kindLabel(job.extensionKind),
      nodeId: job.nodeId,
      age: formatRelativeAge(base, now),
      ageTooltip: this.texts.ageTooltip(new Date(job.createdAt).toISOString()),
      autoFix: job.autoFix,
      cancellable: ACTIVE_STATUSES.has(status),
      cancelTooltip:
        status === 'running' ? this.texts.cancelRunningTooltip : this.texts.cancelTooltip,
      retryable: status === 'failed',
    };
  }
}

/** The clock the age cell + the row sort read: since-claimed for a running
 *  job, else since-created. */
function ageBase(job: IJobApi): number {
  return job.claimedAt ?? job.createdAt;
}

/** Immutably add an id to a readonly set (new set, for signal updates). */
function withAdded(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  return new Set(set).add(id);
}

/** Immutably remove an id from a readonly set. */
function withRemoved(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(id);
  return next;
}

/**
 * Lifecycle glyph. Reuses the launcher's state glyphs (clock for queued,
 * the spin-spinner for running) and tinted marks for the terminal states
 * (the tint rides `data-status` in the template's CSS).
 */
function statusIcon(status: TJobStatusApi): string {
  switch (status) {
    case 'queued':
      return 'pi pi-clock';
    case 'running':
      return 'pi pi-spin pi-spinner';
    case 'completed':
      return 'pi pi-check-circle';
    case 'failed':
      return 'pi pi-times-circle';
    case 'cancelled':
      return 'pi pi-ban';
  }
}

/**
 * Static glyph for a status-filter chip. Mirrors the table's per-state
 * glyph, but the running spinner does NOT spin here (a filter control, not a
 * live row), so the spin animation is stripped.
 */
function chipIcon(status: TJobStatusApi): string {
  return status === 'running' ? 'pi pi-spinner' : statusIcon(status);
}

/**
 * Kind glyph shown before the extension label. The short label strips the
 * `-analyzer` / `-action` suffix, so the kind rides its own always-visible
 * icon: a magnifier for the analyzers (finders / detectors), a wrench for
 * the actions (fixers). Other kinds fall back to a neutral box.
 */
function kindIcon(kind: string): string {
  switch (kind) {
    case 'analyzer':
      return 'pi pi-search';
    case 'action':
      return 'pi pi-wrench';
    default:
      return 'pi pi-box';
  }
}

/** Human kind name for the icon tooltip (capitalised extension kind). */
function kindLabel(kind: string): string {
  return kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : 'Extension';
}

/** Compact relative age (`12s`, `4m`, `3h`, `2d`) from `fromMs` to `now`. */
function formatRelativeAge(fromMs: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - fromMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Exposed for unit tests, covers the pure projection helpers. */
export const __testHooks = { statusIcon, chipIcon, kindIcon, kindLabel, formatRelativeAge };
