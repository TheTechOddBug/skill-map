import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import type {
  IWsNodeActivityEvent,
  IWsScanCompletedEvent,
  IWsScanProgressEvent,
  IWsScanStartedEvent,
} from '../../models/ws-event';
import { DATA_SOURCE, type IDataSourcePort } from '../data-source/data-source.port';
import { NodeActivityService } from '../node-activity';
import {
  NODE_SPARK_DURATION_MS,
  NODE_SPARK_SUPPRESS_AFTER_ACTIVITY_MS,
  NodeSparkService,
} from '../node-spark';
import { WsEventStreamService } from '../ws-event-stream';

/** Minimal port stub for `LivePreferencesService`'s server-backed pair. */
const PREFS_STUB = {
  getProjectPreferences: () => Promise.resolve({}),
  setProjectPreferences: () => Promise.resolve({}),
} as unknown as IDataSourcePort;

const SKILL = '.claude/skills/deploy/SKILL.md';
const AGENT = '.claude/agents/reviewer.md';

function scanStarted(mode?: 'full' | 'changed'): IWsScanStartedEvent {
  const data: IWsScanStartedEvent['data'] = { roots: ['.'] };
  if (mode !== undefined) data.mode = mode;
  return { type: 'scan.started', timestamp: 1_700_000_000_000, data };
}

function scanProgress(
  path: string,
  cached: boolean,
  partialCache?: boolean,
): IWsScanProgressEvent {
  const data: IWsScanProgressEvent['data'] = { index: 1, path, kind: 'skill', cached };
  if (partialCache !== undefined) data.partialCache = partialCache;
  return { type: 'scan.progress', timestamp: 1_700_000_000_100, data };
}

function scanCompleted(): IWsScanCompletedEvent {
  return { type: 'scan.completed', timestamp: 1_700_000_000_200, data: {} };
}

function activityEvent(nodePath: string, phase: 'start' | 'end'): IWsNodeActivityEvent {
  return { type: 'node.activity', timestamp: 1_700_000_000_000, data: { nodePath, phase, owner: 'main' } };
}

interface IHarness {
  service: NodeSparkService;
  activity: NodeActivityService;
  scanStarted$: Subject<IWsScanStartedEvent>;
  scanProgress$: Subject<IWsScanProgressEvent>;
  scanCompleted$: Subject<IWsScanCompletedEvent>;
  nodeActivity$: Subject<IWsNodeActivityEvent>;
}

/**
 * Tiny TTLs via the DI tokens, same stance as `node-activity.spec.ts`:
 * real timers, no fake clocks (`scheduleFrame` + wall-clock timeouts
 * interleave badly with fake timers). Suppression checks pass explicit
 * `now` values through the REAL `NodeActivityService` (stubbed only at
 * the WS seam), so the two services integrate exactly as in prod.
 */
function bootstrap(durationMs = 40, suppressMs = 60): IHarness {
  const scanStarted$ = new Subject<IWsScanStartedEvent>();
  const scanProgress$ = new Subject<IWsScanProgressEvent>();
  const scanCompleted$ = new Subject<IWsScanCompletedEvent>();
  const nodeActivity$ = new Subject<IWsNodeActivityEvent>();
  const ws = {
    scanStarted$,
    scanProgress$,
    scanCompleted$,
    nodeActivity$,
  } as unknown as WsEventStreamService;
  TestBed.configureTestingModule({
    providers: [
      { provide: WsEventStreamService, useValue: ws },
      { provide: NODE_SPARK_DURATION_MS, useValue: durationMs },
      { provide: NODE_SPARK_SUPPRESS_AFTER_ACTIVITY_MS, useValue: suppressMs },
      { provide: DATA_SOURCE, useValue: PREFS_STUB },
    ],
  });
  return {
    service: TestBed.inject(NodeSparkService),
    activity: TestBed.inject(NodeActivityService),
    scanStarted$,
    scanProgress$,
    scanCompleted$,
    nodeActivity$,
  };
}

/** Wait past the coalescing flush (one animation frame / 16ms fallback). */
function flushed(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

/**
 * Wait out the spark TTL. Generous margin past the 40ms duration, same
 * flake-backstop rationale as `node-activity.spec.ts`'s
 * `afterTtlDecay`: this asserts "the timer had every chance to fire",
 * not latency.
 */
function afterSparkDecay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 500));
}

describe('NodeSparkService', () => {
  it('a changed-scan cached:false frame sparks the node', async () => {
    const { service, scanStarted$, scanProgress$ } = bootstrap(10_000);
    scanStarted$.next(scanStarted('changed'));
    scanProgress$.next(scanProgress(SKILL, false));
    await flushed();
    expect(service.sparkPaths().has(SKILL)).toBe(true);
  });

  it('the spark decays after its duration', async () => {
    const { service, scanStarted$, scanProgress$ } = bootstrap(40);
    scanStarted$.next(scanStarted('changed'));
    scanProgress$.next(scanProgress(SKILL, false));
    await flushed();
    expect(service.sparkPaths().has(SKILL)).toBe(true);

    await afterSparkDecay();
    expect(service.sparkPaths().size).toBe(0);
  });

  it('cached and partial-cache frames never spark', async () => {
    const { service, scanStarted$, scanProgress$ } = bootstrap(10_000);
    scanStarted$.next(scanStarted('changed'));
    scanProgress$.next(scanProgress(SKILL, true));
    scanProgress$.next(scanProgress(AGENT, false, true));
    await flushed();
    expect(service.sparkPaths().size).toBe(0);
  });

  it('full-mode scans, mode-less frames, and frames after scan.completed never spark', async () => {
    const { service, scanStarted$, scanProgress$, scanCompleted$ } = bootstrap(10_000);

    scanStarted$.next(scanStarted('full'));
    scanProgress$.next(scanProgress(SKILL, false));
    await flushed();
    expect(service.sparkPaths().size).toBe(0);

    // A legacy `scan.started` with no mode field latches ineligible.
    scanStarted$.next(scanStarted());
    scanProgress$.next(scanProgress(SKILL, false));
    await flushed();
    expect(service.sparkPaths().size).toBe(0);

    // After the changed scan completes, stray frames are ignored.
    scanStarted$.next(scanStarted('changed'));
    scanCompleted$.next(scanCompleted());
    scanProgress$.next(scanProgress(SKILL, false));
    await flushed();
    expect(service.sparkPaths().size).toBe(0);
  });

  it('suppresses the spark while the node shows agent activity (activity wins)', async () => {
    // Generous suppression window: the assertions only need "recently
    // lit means no spark", never a timing race.
    const { service, activity, scanStarted$, scanProgress$, nodeActivity$ } = bootstrap(
      10_000,
      60_000,
    );

    // Light the node through the REAL activity service (its WS seam is
    // part of this harness), then let the watcher batch arrive.
    nodeActivity$.next(activityEvent(SKILL, 'start'));
    await flushed();
    expect(activity.activePaths().has(SKILL)).toBe(true);

    scanStarted$.next(scanStarted('changed'));
    scanProgress$.next(scanProgress(SKILL, false));
    scanProgress$.next(scanProgress(AGENT, false));
    await flushed();

    // The lit node is suppressed; the untouched sibling sparks.
    expect(service.sparkPaths().has(SKILL)).toBe(false);
    expect(service.sparkPaths().has(AGENT)).toBe(true);
  });

  it('sparks again once the post-activity window passed', async () => {
    // Window of 1ms: the >=50ms flush waits guarantee the "window
    // passed" case without sleeping on a boundary.
    const { service, activity, scanStarted$, scanProgress$, nodeActivity$ } = bootstrap(10_000, 1);

    nodeActivity$.next(activityEvent(SKILL, 'start'));
    await flushed();
    nodeActivity$.next(activityEvent(SKILL, 'end'));
    await flushed();
    expect(activity.activePaths().has(SKILL)).toBe(false);

    // Well past the 1ms window by now: the spark goes through.
    scanStarted$.next(scanStarted('changed'));
    scanProgress$.next(scanProgress(SKILL, false));
    await flushed();
    expect(service.sparkPaths().has(SKILL)).toBe(true);
  });

  it('setEnabled(false) clears live sparks and blocks new frames; re-enable re-arms', async () => {
    const { service, scanStarted$, scanProgress$ } = bootstrap(10_000);
    scanStarted$.next(scanStarted('changed'));
    scanProgress$.next(scanProgress(SKILL, false));
    await flushed();
    expect(service.sparkPaths().has(SKILL)).toBe(true);

    service.setEnabled(false);
    expect(service.sparkPaths().size).toBe(0);

    scanProgress$.next(scanProgress(AGENT, false));
    await flushed();
    expect(service.sparkPaths().size).toBe(0);

    // Re-enable: the latch was cleared on disable, so the next changed
    // scan must re-latch before frames spark again.
    service.setEnabled(true);
    scanStarted$.next(scanStarted('changed'));
    scanProgress$.next(scanProgress(AGENT, false));
    await flushed();
    expect(service.sparkPaths().has(AGENT)).toBe(true);
  });
});
