import { describe, expect, it, vi } from 'vitest';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { EMPTY, Subject, BehaviorSubject } from 'rxjs';
import { ActivatedRoute, convertToParamMap, type ParamMap } from '@angular/router';
import { ConfirmationService } from 'primeng/api';

import { QueueView } from '../queue-view';
import {
  DATA_SOURCE,
  DataSourceError,
} from '../../../../services/data-source/data-source.port';
import { WsEventStreamService } from '../../../../services/ws-event-stream';
import { NODE_OPEN_INTENT } from '../../../slots/node-open-intent';
import type { IJobApi } from '../../../../models/api';

/**
 * QueueView unit coverage: the queue panel renders rows from the jobs
 * port, re-fetches (debounced) on a job lifecycle frame, and cancels a
 * row with an optimistic flip. The WS stream is a Subject so the debounce
 * can be driven under fake timers, mirroring the inspector activity tests.
 */

function makeJob(overrides: Partial<IJobApi> = {}): IJobApi {
  return {
    id: 'd-20260719-000000-0001',
    extensionId: 'core/ai-redundancy-analyzer',
    extensionVersion: '1.0.0',
    extensionKind: 'analyzer',
    autoFix: false,
    nodeId: 'docs/a.md',
    contentHash: 'abc',
    priority: 0,
    status: 'queued',
    failureReason: null,
    runner: null,
    ttlSeconds: null,
    createdAt: Date.now() - 5000,
    claimedAt: null,
    finishedAt: null,
    expiresAt: null,
    submittedBy: null,
    ...overrides,
  };
}

interface IStubDataSource {
  listJobs: ReturnType<typeof vi.fn>;
  cancelJob: ReturnType<typeof vi.fn>;
  submitNodeJob: ReturnType<typeof vi.fn>;
  submitNodelessJob: ReturnType<typeof vi.fn>;
  cancelAllJobs: ReturnType<typeof vi.fn>;
  pruneJobs: ReturnType<typeof vi.fn>;
}

function makeDataSource(jobs: IJobApi[] = []): IStubDataSource {
  return {
    listJobs: vi.fn().mockResolvedValue(jobs),
    cancelJob: vi.fn().mockResolvedValue(undefined),
    submitNodeJob: vi.fn().mockResolvedValue({ value: {} }),
    submitNodelessJob: vi.fn().mockResolvedValue({ value: { jobId: 'j1', nodePath: 'sm://core/ai-ping-action', extensionId: 'core/ai-ping-action', supersededIds: [] } }),
    cancelAllJobs: vi.fn().mockResolvedValue(undefined),
    pruneJobs: vi.fn().mockResolvedValue(undefined),
  };
}

interface IBootstrapOpts {
  jobs?: IJobApi[];
  dataSource?: IStubDataSource;
  jobEvents$?: Subject<void>;
  scanCompleted$?: Subject<void>;
  /** Seeds the `?path` query param, the selected-node highlight key. */
  selectedPath?: string;
}

function bootstrap(opts: IBootstrapOpts = {}): {
  fixture: ComponentFixture<QueueView>;
  dataSource: IStubDataSource;
  jobEvents$: Subject<void>;
  scanCompleted$: Subject<void>;
  openIntent: { open: ReturnType<typeof vi.fn> };
} {
  const dataSource = opts.dataSource ?? makeDataSource(opts.jobs ?? []);
  const jobEvents$ = opts.jobEvents$ ?? new Subject<void>();
  const scanCompleted$ = opts.scanCompleted$ ?? new Subject<void>();
  const openIntent = { open: vi.fn() };
  const paramMap = convertToParamMap(opts.selectedPath ? { path: opts.selectedPath } : {});
  const queryParamMap$ = new BehaviorSubject<ParamMap>(paramMap);
  const route = {
    queryParamMap: queryParamMap$.asObservable(),
    snapshot: { queryParamMap: paramMap },
  } as unknown as ActivatedRoute;

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: DATA_SOURCE, useValue: dataSource },
      {
        provide: WsEventStreamService,
        useValue: {
          events$: EMPTY,
          jobEvents$: jobEvents$.asObservable(),
          scanCompleted$: scanCompleted$.asObservable(),
        } as unknown as WsEventStreamService,
      },
      { provide: ActivatedRoute, useValue: route },
      { provide: NODE_OPEN_INTENT, useValue: openIntent },
    ],
  });
  const fixture = TestBed.createComponent(QueueView);
  return { fixture, dataSource, jobEvents$, scanCompleted$, openIntent };
}

async function flush(fixture: ComponentFixture<QueueView>): Promise<void> {
  fixture.detectChanges();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

function dom(fixture: ComponentFixture<QueueView>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

describe('QueueView', () => {
  it('renders one row per job from the jobs port, with the short extension label', async () => {
    const jobs = [
      makeJob({ id: 'j1', nodeId: 'docs/a.md' }),
      makeJob({ id: 'j2', nodeId: 'docs/b.md', status: 'running', claimedAt: Date.now() - 2000 }),
    ];
    const { fixture, dataSource } = bootstrap({ jobs });
    await flush(fixture);

    expect(dataSource.listJobs).toHaveBeenCalled();
    const rows = dom(fixture).querySelectorAll('[data-testid^="queue-row-"]');
    expect(rows.length).toBe(2);
    // `core/ai-redundancy-analyzer` reads as `redundancy` on the row.
    expect(dom(fixture).textContent).toContain('redundancy');
    // Node path is shown.
    expect(dom(fixture).textContent).toContain('docs/a.md');
  });

  it('marks the extension kind with a distinct glyph (analyzer vs action)', async () => {
    const jobs = [
      makeJob({ id: 'j1', extensionId: 'core/ai-redundancy-analyzer', extensionKind: 'analyzer' }),
      makeJob({ id: 'j2', extensionId: 'core/ai-reference-action', extensionKind: 'action' }),
    ];
    const { fixture } = bootstrap({ jobs });
    await flush(fixture);

    const analyzerIcon = dom(fixture).querySelector('[data-testid="queue-kind-j1"]')!;
    const actionIcon = dom(fixture).querySelector('[data-testid="queue-kind-j2"]')!;
    expect(analyzerIcon.getAttribute('data-kind')).toBe('analyzer');
    expect(actionIcon.getAttribute('data-kind')).toBe('action');
    // Distinct glyphs so the two kinds read apart even when the label truncates.
    expect(analyzerIcon.className).toContain('pi-search');
    expect(actionIcon.className).toContain('pi-wrench');
  });

  it('orders rows by enqueue time, newest first, even when an older job was claimed later', async () => {
    const now = Date.now();
    const jobs = [
      // Oldest enqueue, but claimed RIGHT NOW: under the retired
      // claim-time sort this row jumped to the top; under strict enqueue
      // order it stays at the bottom.
      makeJob({ id: 'j-old', nodeId: 'docs/old.md', status: 'running', createdAt: now - 60_000, claimedAt: now }),
      makeJob({ id: 'j-mid', nodeId: 'docs/mid.md', createdAt: now - 30_000 }),
      makeJob({ id: 'j-new', nodeId: 'docs/new.md', createdAt: now - 1000 }),
    ];
    const { fixture } = bootstrap({ jobs });
    await flush(fixture);

    const rows = [...dom(fixture).querySelectorAll('[data-testid^="queue-row-"]')];
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'queue-row-j-new',
      'queue-row-j-mid',
      'queue-row-j-old',
    ]);
  });

  it('breaks a createdAt tie by id, so a same-millisecond burst still renders deterministically', async () => {
    const at = Date.now() - 5000;
    const jobs = [
      makeJob({ id: 'job-b', nodeId: 'docs/b.md', createdAt: at }),
      makeJob({ id: 'job-c', nodeId: 'docs/c.md', createdAt: at }),
      makeJob({ id: 'job-a', nodeId: 'docs/a.md', createdAt: at }),
    ];
    const { fixture } = bootstrap({ jobs });
    await flush(fixture);

    const rows = [...dom(fixture).querySelectorAll('[data-testid^="queue-row-"]')];
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'queue-row-job-c',
      'queue-row-job-b',
      'queue-row-job-a',
    ]);
  });

  it('shows the empty state when the queue has no jobs', async () => {
    const { fixture } = bootstrap({ jobs: [] });
    await flush(fixture);

    expect(dom(fixture).querySelector('[data-testid="queue-empty"]')).not.toBeNull();
    expect(dom(fixture).querySelector('[data-testid="queue-table"]')).toBeNull();
  });

  it('re-fetches the queue on a job.* frame after the 400ms debounce', async () => {
    const { fixture, dataSource, jobEvents$ } = bootstrap({ jobs: [makeJob({ id: 'j1' })] });
    await flush(fixture);
    const before = dataSource.listJobs.mock.calls.length;

    // A job lifecycle frame lands: after the debounce window the queue
    // re-fetches (record-side frames carry no per-node path, so the panel
    // simply re-reads the authoritative state).
    vi.useFakeTimers();
    try {
      jobEvents$.next();
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    expect(dataSource.listJobs.mock.calls.length).toBeGreaterThan(before);
  });

  it('coalesces a burst of job frames into ONE debounced re-fetch', async () => {
    const { fixture, dataSource, jobEvents$ } = bootstrap({ jobs: [makeJob({ id: 'j1' })] });
    await flush(fixture);
    const before = dataSource.listJobs.mock.calls.length;

    vi.useFakeTimers();
    try {
      for (let i = 0; i < 5; i++) {
        jobEvents$.next();
        vi.advanceTimersByTime(100);
      }
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    // Five frames inside one debounce window collapse to a single trailing
    // re-fetch.
    expect(dataSource.listJobs.mock.calls.length).toBe(before + 1);
  });

  it('cancels a job: calls cancelJob and flips the row to cancelled optimistically', async () => {
    const job = makeJob({ id: 'j1', status: 'queued' });
    const { fixture, dataSource } = bootstrap({ jobs: [job] });
    await flush(fixture);

    const host = dom(fixture).querySelector('[data-testid="queue-cancel-j1"]');
    expect(host).not.toBeNull();
    (host!.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);

    expect(dataSource.cancelJob).toHaveBeenCalledWith('j1');
    // The stubbed re-fetch still returns the queued job, so the optimistic
    // flip survives reconciliation and the row reports `cancelled`.
    const row = dom(fixture).querySelector('[data-testid="queue-row-j1"]');
    expect(row!.getAttribute('data-status')).toBe('cancelled');
  });

  it('does not render a cancel affordance on a terminal job', async () => {
    const { fixture } = bootstrap({
      jobs: [makeJob({ id: 'j1', status: 'completed', finishedAt: Date.now() })],
    });
    await flush(fixture);

    expect(dom(fixture).querySelector('[data-testid="queue-row-j1"]')).not.toBeNull();
    expect(dom(fixture).querySelector('[data-testid="queue-cancel-j1"]')).toBeNull();
  });

  it('filters rows by a node substring typed into the local search', async () => {
    const jobs = [
      makeJob({ id: 'j1', nodeId: 'docs/alpha.md' }),
      makeJob({ id: 'j2', nodeId: 'docs/beta.md' }),
    ];
    const { fixture } = bootstrap({ jobs });
    await flush(fixture);
    expect(dom(fixture).querySelectorAll('[data-testid^="queue-row-"]').length).toBe(2);

    const input = dom(fixture).querySelector('[data-testid="queue-search"]') as HTMLInputElement;
    input.value = 'beta';
    input.dispatchEvent(new Event('input'));
    await flush(fixture);

    const rows = dom(fixture).querySelectorAll('[data-testid^="queue-row-"]');
    expect(rows.length).toBe(1);
    expect(dom(fixture).querySelector('[data-testid="queue-row-j2"]')).not.toBeNull();
  });

  it('filters rows by the extension label', async () => {
    const jobs = [
      makeJob({ id: 'j1', extensionId: 'core/ai-redundancy-analyzer' }),
      makeJob({ id: 'j2', extensionId: 'core/ai-reference-action', extensionKind: 'action' }),
    ];
    const { fixture } = bootstrap({ jobs });
    await flush(fixture);

    const input = dom(fixture).querySelector('[data-testid="queue-search"]') as HTMLInputElement;
    input.value = 'reference';
    input.dispatchEvent(new Event('input'));
    await flush(fixture);

    const rows = dom(fixture).querySelectorAll('[data-testid^="queue-row-"]');
    expect(rows.length).toBe(1);
    expect(dom(fixture).querySelector('[data-testid="queue-row-j2"]')).not.toBeNull();
  });

  it('hides a lifecycle state when its status chip is toggled off', async () => {
    const jobs = [
      makeJob({ id: 'j1', status: 'queued' }),
      makeJob({ id: 'j2', status: 'completed', finishedAt: Date.now() }),
    ];
    const { fixture } = bootstrap({ jobs });
    await flush(fixture);
    expect(dom(fixture).querySelectorAll('[data-testid^="queue-row-"]').length).toBe(2);

    const chip = dom(fixture).querySelector(
      '[data-testid="queue-chip-completed"]',
    ) as HTMLButtonElement;
    expect(chip).not.toBeNull();
    chip.click();
    await flush(fixture);

    const rows = dom(fixture).querySelectorAll('[data-testid^="queue-row-"]');
    expect(rows.length).toBe(1);
    expect(dom(fixture).querySelector('[data-testid="queue-row-j1"]')).not.toBeNull();
    expect(dom(fixture).querySelector('[data-testid="queue-row-j2"]')).toBeNull();
  });

  it('shows a live count on each status chip', async () => {
    const jobs = [
      makeJob({ id: 'j1', status: 'queued' }),
      makeJob({ id: 'j2', status: 'queued' }),
      makeJob({ id: 'j3', status: 'failed', finishedAt: Date.now() }),
    ];
    const { fixture } = bootstrap({ jobs });
    await flush(fixture);

    expect(
      dom(fixture).querySelector('[data-testid="queue-chip-queued"]')!.textContent,
    ).toContain('2');
    expect(
      dom(fixture).querySelector('[data-testid="queue-chip-failed"]')!.textContent,
    ).toContain('1');
    expect(
      dom(fixture).querySelector('[data-testid="queue-chip-completed"]')!.textContent,
    ).toContain('0');
  });

  it('shows the no-match state when the filter excludes every job', async () => {
    const { fixture } = bootstrap({ jobs: [makeJob({ id: 'j1', status: 'queued' })] });
    await flush(fixture);

    const input = dom(fixture).querySelector('[data-testid="queue-search"]') as HTMLInputElement;
    input.value = 'zzz-nothing-matches';
    input.dispatchEvent(new Event('input'));
    await flush(fixture);

    expect(dom(fixture).querySelector('[data-testid="queue-no-match"]')).not.toBeNull();
    expect(dom(fixture).querySelector('[data-testid="queue-table"]')).toBeNull();
    // The filter bar stays so the operator can clear the filter.
    expect(dom(fixture).querySelector('[data-testid="queue-filters"]')).not.toBeNull();
  });

  it('paginates the queue at 100 rows per page with a bottom paginator', async () => {
    const jobs = Array.from({ length: 150 }, (_, i) =>
      makeJob({ id: `j${i}`, nodeId: `docs/n${i}.md` }),
    );
    const { fixture } = bootstrap({ jobs });
    await flush(fixture);

    // The paginator footer renders.
    expect(dom(fixture).querySelector('.p-paginator')).not.toBeNull();
    // Only the first page (100) of the 150 rows is materialised.
    const rows = dom(fixture).querySelectorAll('[data-testid^="queue-row-"]');
    expect(rows.length).toBe(100);
  });

  it('clears the search from the in-input clear button', async () => {
    const jobs = [
      makeJob({ id: 'j1', nodeId: 'docs/alpha.md' }),
      makeJob({ id: 'j2', nodeId: 'docs/beta.md' }),
    ];
    const { fixture } = bootstrap({ jobs });
    await flush(fixture);

    const input = dom(fixture).querySelector('[data-testid="queue-search"]') as HTMLInputElement;
    input.value = 'beta';
    input.dispatchEvent(new Event('input'));
    await flush(fixture);
    expect(dom(fixture).querySelectorAll('[data-testid^="queue-row-"]').length).toBe(1);

    const clear = dom(fixture).querySelector(
      '[data-testid="queue-search-clear"]',
    ) as HTMLButtonElement;
    expect(clear).not.toBeNull();
    clear.click();
    await flush(fixture);

    expect(dom(fixture).querySelectorAll('[data-testid^="queue-row-"]').length).toBe(2);
  });

  it('selects the row node on click via the node-open intent', async () => {
    const { fixture, openIntent } = bootstrap({
      jobs: [makeJob({ id: 'j1', nodeId: 'docs/a.md' })],
    });
    await flush(fixture);

    (dom(fixture).querySelector('[data-testid="queue-row-j1"]') as HTMLElement).click();

    expect(openIntent.open).toHaveBeenCalledWith('docs/a.md');
  });

  it('highlights every row for the selected node (the ?path query param)', async () => {
    const jobs = [
      makeJob({ id: 'j1', nodeId: 'docs/a.md' }),
      makeJob({ id: 'j2', nodeId: 'docs/a.md', status: 'running', claimedAt: Date.now() }),
      makeJob({ id: 'j3', nodeId: 'docs/b.md' }),
    ];
    const { fixture } = bootstrap({ jobs, selectedPath: 'docs/a.md' });
    await flush(fixture);

    // Both jobs targeting docs/a.md light up; the docs/b.md row does not.
    const isSelected = (id: string): boolean =>
      dom(fixture)
        .querySelector(`[data-testid="queue-row-${id}"]`)!
        .classList.contains('is-selected');
    expect(isSelected('j1')).toBe(true);
    expect(isSelected('j2')).toBe(true);
    expect(isSelected('j3')).toBe(false);
  });

  it('does not select the node when the cancel control is clicked', async () => {
    const { fixture, openIntent } = bootstrap({
      jobs: [makeJob({ id: 'j1', status: 'queued' })],
    });
    await flush(fixture);

    const cancelHost = dom(fixture).querySelector('[data-testid="queue-cancel-j1"]')!;
    (cancelHost.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);

    expect(openIntent.open).not.toHaveBeenCalled();
  });

  it('offers Cancel only on active rows and Retry only on failed rows', async () => {
    const jobs = [
      makeJob({ id: 'active', status: 'running', claimedAt: Date.now() }),
      makeJob({ id: 'failed', status: 'failed', finishedAt: Date.now() }),
      makeJob({ id: 'done', status: 'completed', finishedAt: Date.now() }),
    ];
    const { fixture } = bootstrap({ jobs });
    await flush(fixture);

    // Active row: Cancel, no Retry.
    expect(dom(fixture).querySelector('[data-testid="queue-cancel-active"]')).not.toBeNull();
    expect(dom(fixture).querySelector('[data-testid="queue-retry-active"]')).toBeNull();
    // Failed row: Retry, no Cancel.
    expect(dom(fixture).querySelector('[data-testid="queue-retry-failed"]')).not.toBeNull();
    expect(dom(fixture).querySelector('[data-testid="queue-cancel-failed"]')).toBeNull();
    // Completed row: no action (retry is failed-only).
    expect(dom(fixture).querySelector('[data-testid="queue-retry-done"]')).toBeNull();
    expect(dom(fixture).querySelector('[data-testid="queue-cancel-done"]')).toBeNull();
    // The Fail affordance is gone entirely.
    expect(dom(fixture).querySelector('[data-testid="queue-fail-active"]')).toBeNull();
  });

  it('retries a terminal row: re-submits the same extension+node with the frozen autoFix', async () => {
    const { fixture, dataSource } = bootstrap({
      jobs: [
        makeJob({
          id: 'j1',
          status: 'failed',
          finishedAt: Date.now(),
          autoFix: true,
          nodeId: 'docs/x.md',
          extensionId: 'core/ai-redundancy-analyzer',
        }),
      ],
    });
    await flush(fixture);

    (dom(fixture).querySelector('[data-testid="queue-retry-j1"] button') as HTMLButtonElement).click();
    await flush(fixture);

    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(
      'docs/x.md',
      'core/ai-redundancy-analyzer',
      true,
    );
  });

  it('retry tolerates a duplicate-job refusal without surfacing an error', async () => {
    const ds = makeDataSource([makeJob({ id: 'j1', status: 'failed', finishedAt: Date.now() })]);
    ds.submitNodeJob.mockRejectedValueOnce(new DataSourceError('duplicate-job', 'already queued'));
    const { fixture } = bootstrap({ dataSource: ds });
    await flush(fixture);

    (dom(fixture).querySelector('[data-testid="queue-retry-j1"] button') as HTMLButtonElement).click();
    await flush(fixture);

    expect(ds.submitNodeJob).toHaveBeenCalled();
    // A duplicate is a no-op: no error strip renders.
    expect(dom(fixture).querySelector('p-message')).toBeNull();
  });

  it('bulk cancel-all: confirms first, cancels every active job on accept', async () => {
    const { fixture, dataSource } = bootstrap({
      jobs: [
        makeJob({ id: 'j1', status: 'queued' }),
        makeJob({ id: 'j2', status: 'running', claimedAt: Date.now() }),
      ],
    });
    await flush(fixture);

    const confirm = fixture.debugElement.injector.get(ConfirmationService);
    const confirmSpy = vi.spyOn(confirm, 'confirm');

    (dom(fixture).querySelector('[data-testid="queue-cancel-all"]') as HTMLButtonElement).click();
    await flush(fixture);

    // The click only opens the confirm; the mutation waits for accept.
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(dataSource.cancelAllJobs).not.toHaveBeenCalled();

    const config = confirmSpy.mock.calls[0]![0] as { accept?: () => void };
    config.accept?.();
    await flush(fixture);

    expect(dataSource.cancelAllJobs).toHaveBeenCalledTimes(1);
  });

  it('clear finished: shown when terminal jobs exist, clears them all on accept', async () => {
    const { fixture, dataSource } = bootstrap({
      jobs: [makeJob({ id: 'j1', status: 'completed', finishedAt: Date.now() })],
    });
    await flush(fixture);

    const btn = dom(fixture).querySelector(
      '[data-testid="queue-clear-finished"]',
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    // No active jobs → no cancel-all; no failed jobs → no clear-failed.
    expect(dom(fixture).querySelector('[data-testid="queue-cancel-all"]')).toBeNull();
    expect(dom(fixture).querySelector('[data-testid="queue-clear-failed"]')).toBeNull();

    const confirm = fixture.debugElement.injector.get(ConfirmationService);
    const confirmSpy = vi.spyOn(confirm, 'confirm');
    btn.click();
    await flush(fixture);
    (confirmSpy.mock.calls[0]![0] as { accept?: () => void }).accept?.();
    await flush(fixture);

    // No status argument → clears every terminal state.
    expect(dataSource.pruneJobs).toHaveBeenCalledWith();
  });

  it('clear failed: shown only when failed jobs exist, clears just failed on accept', async () => {
    const jobs = [
      makeJob({ id: 'f1', status: 'failed', finishedAt: Date.now() }),
      makeJob({ id: 'c1', status: 'completed', finishedAt: Date.now() }),
    ];
    const { fixture, dataSource } = bootstrap({ jobs });
    await flush(fixture);

    const btn = dom(fixture).querySelector(
      '[data-testid="queue-clear-failed"]',
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();

    const confirm = fixture.debugElement.injector.get(ConfirmationService);
    const confirmSpy = vi.spyOn(confirm, 'confirm');
    btn.click();
    await flush(fixture);
    (confirmSpy.mock.calls[0]![0] as { accept?: () => void }).accept?.();
    await flush(fixture);

    // Scoped prune: only the failed state.
    expect(dataSource.pruneJobs).toHaveBeenCalledWith('failed');
  });
});
