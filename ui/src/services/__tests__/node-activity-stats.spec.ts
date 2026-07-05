import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';

import type { INodeActivityStatsApi } from '../../models/api';
import type { IWsNodeActivityEvent } from '../../models/ws-event';
import { DATA_SOURCE, type IDataSourcePort } from '../data-source/data-source.port';
import { LivePreferencesService } from '../live-preferences';
import { NodeActivityStatsService } from '../node-activity-stats';
import { WsEventStreamService } from '../ws-event-stream';

const SKILL = '.claude/skills/deploy/SKILL.md';
const AGENT = '.claude/agents/reviewer.md';
const ACTIVITY_ENABLED_KEY = 'sm.live.activity-enabled';

function stats(count: number, lastStartAt = 1_700_000_000_000, distinctOwners = 1): INodeActivityStatsApi {
  return { count, lastStartAt, distinctOwners };
}

function statsFrame(nodePath: string, s: INodeActivityStatsApi): IWsNodeActivityEvent {
  return {
    type: 'node.activity',
    timestamp: 1_700_000_000_000,
    data: { nodePath, phase: 'start', owner: 'main:abc', stats: s },
  };
}

interface IHarness {
  service: NodeActivityStatsService;
  events$: Subject<IWsNodeActivityEvent>;
  stable: ReturnType<typeof signal<boolean>>;
  getActivitySummary: ReturnType<typeof vi.fn>;
  prefs: LivePreferencesService;
}

function bootstrap(summaryNodes: Record<string, INodeActivityStatsApi> = {}): IHarness {
  TestBed.resetTestingModule();
  const events$ = new Subject<IWsNodeActivityEvent>();
  const stable = signal(false);
  const ws = { nodeActivity$: events$, stableConnected: stable.asReadonly() } as unknown as WsEventStreamService;
  const getActivitySummary = vi
    .fn()
    .mockResolvedValue({ since: 1_700_000_000_000, nodes: summaryNodes });
  TestBed.configureTestingModule({
    providers: [
      { provide: WsEventStreamService, useValue: ws },
      { provide: DATA_SOURCE, useValue: { getActivitySummary } as Partial<IDataSourcePort> },
    ],
  });
  const prefs = TestBed.inject(LivePreferencesService);
  return {
    service: TestBed.inject(NodeActivityStatsService),
    events$,
    stable,
    getActivitySummary,
    prefs,
  };
}

/** Wait past the coalescing flush (one animation frame / 16ms fallback). */
function flushed(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('NodeActivityStatsService', () => {
  afterEach(() => {
    localStorage.removeItem(ACTIVITY_ENABLED_KEY);
  });

  it('hydrates from the summary on boot', async () => {
    const { service } = bootstrap({ [SKILL]: stats(3) });
    await settled();
    expect(service.stats().get(SKILL)?.count).toBe(3);
  });

  it('count OVERWRITES from frames, never client-accumulates', async () => {
    const { service, events$ } = bootstrap();
    events$.next(statsFrame(SKILL, stats(5)));
    await flushed();
    expect(service.stats().get(SKILL)?.count).toBe(5);

    // A later frame carries the server's new absolute count. If the
    // client were incrementing, this would read 12.
    events$.next(statsFrame(SKILL, stats(7, 1_700_000_002_000)));
    await flushed();
    expect(service.stats().get(SKILL)?.count).toBe(7);
  });

  it('coalesces a burst into one map and keeps entry identity when values are equal', async () => {
    const { service, events$ } = bootstrap();
    events$.next(statsFrame(SKILL, stats(1)));
    events$.next(statsFrame(AGENT, stats(2)));
    events$.next(statsFrame(SKILL, stats(3)));
    await flushed();
    expect(service.stats().get(SKILL)?.count).toBe(3);
    expect(service.stats().get(AGENT)?.count).toBe(2);

    // A frame with VALUE-EQUAL stats must not swap the map reference
    // (no spurious OnPush invalidation) nor the entry object.
    const mapBefore = service.stats();
    const entryBefore = mapBefore.get(AGENT);
    events$.next(statsFrame(AGENT, stats(2)));
    await flushed();
    expect(service.stats()).toBe(mapBefore);
    expect(service.stats().get(AGENT)).toBe(entryBefore);
  });

  it('Real Time off keeps the last snapshot and drops incoming frames', async () => {
    const { service, events$, prefs } = bootstrap({ [SKILL]: stats(4) });
    await settled();
    expect(service.stats().get(SKILL)?.count).toBe(4);

    prefs.setActivityEnabled(false);
    TestBed.tick();
    events$.next(statsFrame(SKILL, stats(9)));
    await flushed();
    // Kept, not cleared; and the frame did not apply.
    expect(service.stats().get(SKILL)?.count).toBe(4);
  });

  it('re-enable refetches the summary', async () => {
    const { service, prefs, getActivitySummary } = bootstrap({ [SKILL]: stats(4) });
    await settled();
    expect(getActivitySummary).toHaveBeenCalledTimes(1);

    prefs.setActivityEnabled(false);
    TestBed.tick();
    getActivitySummary.mockResolvedValue({
      since: 1_700_000_000_000,
      nodes: { [SKILL]: stats(11) },
    });
    prefs.setActivityEnabled(true);
    TestBed.tick();
    await settled();
    expect(getActivitySummary).toHaveBeenCalledTimes(2);
    expect(service.stats().get(SKILL)?.count).toBe(11);
  });

  it('re-stabilize refetches, skipping the FIRST stable window (boot already hydrated)', async () => {
    const { stable, getActivitySummary } = bootstrap({ [SKILL]: stats(4) });
    await settled();
    expect(getActivitySummary).toHaveBeenCalledTimes(1);

    // Boot connection turns stable: no extra fetch.
    stable.set(true);
    TestBed.tick();
    await settled();
    expect(getActivitySummary).toHaveBeenCalledTimes(1);

    // Drop + recover: the server may have restarted, refetch.
    stable.set(false);
    TestBed.tick();
    stable.set(true);
    TestBed.tick();
    await settled();
    expect(getActivitySummary).toHaveBeenCalledTimes(2);
  });

  it('swallows a failed summary fetch (stats stay empty, no throw)', async () => {
    TestBed.resetTestingModule();
    const events$ = new Subject<IWsNodeActivityEvent>();
    const ws = { nodeActivity$: events$, stableConnected: signal(false).asReadonly() } as unknown as WsEventStreamService;
    TestBed.configureTestingModule({
      providers: [
        { provide: WsEventStreamService, useValue: ws },
        {
          provide: DATA_SOURCE,
          useValue: {
            getActivitySummary: vi.fn().mockRejectedValue(new Error('boom')),
          } as Partial<IDataSourcePort>,
        },
      ],
    });
    const service = TestBed.inject(NodeActivityStatsService);
    await settled();
    expect(service.stats().size).toBe(0);
  });
});
