import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';

import type { IActivityPairStatsApi, INodeActivityStatsApi } from '../../models/api';
import type { IWsAgentSpawnEvent, IWsNodeActivityEvent } from '../../models/ws-event';
import { DATA_SOURCE, type IDataSourcePort } from '../data-source/data-source.port';
import { LivePreferencesService } from '../live-preferences';
import { NodeActivityStatsService } from '../node-activity-stats';
import { WsEventStreamService } from '../ws-event-stream';

const SKILL = '.claude/skills/deploy/SKILL.md';
const AGENT = '.claude/agents/reviewer.md';
const CHILD = '.claude/agents/demo-worker.md';
const PAIR_KEY = `${AGENT}>>${CHILD}`;

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

function spawnFrame(
  pairCount: number | undefined,
  overrides: Partial<IWsAgentSpawnEvent['data']> = {},
): IWsAgentSpawnEvent {
  return {
    type: 'agent.spawn',
    timestamp: 1_700_000_000_000,
    data: {
      spawnId: 'toolu_01',
      phase: 'start',
      parentOwner: 'main:abc',
      parentNodePath: AGENT,
      childNodePath: CHILD,
      pairCount,
      ...overrides,
    },
  };
}

interface IHarness {
  service: NodeActivityStatsService;
  events$: Subject<IWsNodeActivityEvent>;
  spawns$: Subject<IWsAgentSpawnEvent>;
  stable: ReturnType<typeof signal<boolean>>;
  getActivitySummary: ReturnType<typeof vi.fn>;
  prefs: LivePreferencesService;
}

function bootstrap(
  summaryNodes: Record<string, INodeActivityStatsApi> = {},
  summaryPairs: Record<string, IActivityPairStatsApi> = {},
): IHarness {
  TestBed.resetTestingModule();
  const events$ = new Subject<IWsNodeActivityEvent>();
  const spawns$ = new Subject<IWsAgentSpawnEvent>();
  const stable = signal(false);
  const ws = {
    nodeActivity$: events$,
    agentSpawn$: spawns$,
    stableConnected: stable.asReadonly(),
  } as unknown as WsEventStreamService;
  const getActivitySummary = vi
    .fn()
    .mockResolvedValue({ since: 1_700_000_000_000, nodes: summaryNodes, pairs: summaryPairs });
  TestBed.configureTestingModule({
    providers: [
      { provide: WsEventStreamService, useValue: ws },
      {
        provide: DATA_SOURCE,
        useValue: {
          getActivitySummary,
          // LivePreferencesService's server-backed pair rides the same port.
          getProjectPreferences: () => Promise.resolve({}),
          setProjectPreferences: () => Promise.resolve({}),
        } as unknown as Partial<IDataSourcePort>,
      },
    ],
  });
  const prefs = TestBed.inject(LivePreferencesService);
  return {
    service: TestBed.inject(NodeActivityStatsService),
    events$,
    spawns$,
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
    const ws = {
      nodeActivity$: events$,
      agentSpawn$: new Subject<IWsAgentSpawnEvent>(),
      stableConnected: signal(false).asReadonly(),
    } as unknown as WsEventStreamService;
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

describe('NodeActivityStatsService, pair counters (edge conversation counts)', () => {
  it('hydrates pairs from the summary snapshot on boot', async () => {
    const { service } = bootstrap(
      {},
      { [PAIR_KEY]: { count: 3, lastStartAt: 1_700_000_000_000 } },
    );
    await settled();
    expect(service.pairCounts().get(PAIR_KEY)).toBe(3);
  });

  it('pairCount OVERWRITES from frames, never client-accumulates', async () => {
    const { service, spawns$ } = bootstrap();
    spawns$.next(spawnFrame(5));
    await flushed();
    expect(service.pairCounts().get(PAIR_KEY)).toBe(5);

    // The server's new absolute count. Client-side accumulation would
    // read 12 here.
    spawns$.next(spawnFrame(7));
    await flushed();
    expect(service.pairCounts().get(PAIR_KEY)).toBe(7);
  });

  it('keeps the map reference when a frame carries the same count (no spurious OnPush tick)', async () => {
    const { service, spawns$ } = bootstrap();
    spawns$.next(spawnFrame(4));
    await flushed();
    const mapBefore = service.pairCounts();
    spawns$.next(spawnFrame(4));
    await flushed();
    expect(service.pairCounts()).toBe(mapBefore);
  });

  it('ignores frames without a pairCount or without a resolved child', async () => {
    const { service, spawns$ } = bootstrap();
    spawns$.next(spawnFrame(undefined));
    spawns$.next(spawnFrame(9, { childNodePath: undefined, childName: 'phantom' }));
    await flushed();
    expect(service.pairCounts().size).toBe(0);
  });

  it('keys session-parent frames by parentOwner (the session key, no session: prefix)', async () => {
    const { service, spawns$ } = bootstrap();
    spawns$.next(spawnFrame(2, { parentNodePath: undefined, parentOwner: 'main:6cfe5636' }));
    await flushed();
    expect(service.pairCounts().get(`main:6cfe5636>>${CHILD}`)).toBe(2);
  });

  it('Real Time off keeps the pair map and drops incoming frames', async () => {
    const { service, spawns$, prefs } = bootstrap(
      {},
      { [PAIR_KEY]: { count: 6, lastStartAt: 1_700_000_000_000 } },
    );
    await settled();
    expect(service.pairCounts().get(PAIR_KEY)).toBe(6);

    prefs.setActivityEnabled(false);
    TestBed.tick();
    spawns$.next(spawnFrame(9));
    await flushed();
    // Kept, not cleared; and the frame did not apply.
    expect(service.pairCounts().get(PAIR_KEY)).toBe(6);
  });

  it('re-enable refetches the summary and adopts the fresh pair counters', async () => {
    const { service, prefs, getActivitySummary } = bootstrap(
      {},
      { [PAIR_KEY]: { count: 1, lastStartAt: 1_700_000_000_000 } },
    );
    await settled();
    expect(service.pairCounts().get(PAIR_KEY)).toBe(1);

    prefs.setActivityEnabled(false);
    TestBed.tick();
    getActivitySummary.mockResolvedValue({
      since: 1_700_000_000_000,
      nodes: {},
      pairs: { [PAIR_KEY]: { count: 8, lastStartAt: 1_700_000_002_000 } },
    });
    prefs.setActivityEnabled(true);
    TestBed.tick();
    await settled();
    expect(service.pairCounts().get(PAIR_KEY)).toBe(8);
  });

  it('the summary snapshot replaces the pair map wholesale (server-restart reset drops stale pairs)', async () => {
    const { service, spawns$, stable, getActivitySummary } = bootstrap();
    spawns$.next(spawnFrame(5));
    await flushed();
    expect(service.pairCounts().get(PAIR_KEY)).toBe(5);

    // Reconnect after a server restart: the fresh accumulator only
    // knows a different pair; the stale one must not survive.
    getActivitySummary.mockResolvedValue({
      since: 1_700_000_005_000,
      nodes: {},
      pairs: { [`${AGENT}>>${SKILL}`]: { count: 1, lastStartAt: 1_700_000_005_000 } },
    });
    stable.set(true);
    TestBed.tick();
    await settled();
    stable.set(false);
    TestBed.tick();
    stable.set(true);
    TestBed.tick();
    await settled();

    expect(service.pairCounts().get(PAIR_KEY)).toBeUndefined();
    expect(service.pairCounts().get(`${AGENT}>>${SKILL}`)).toBe(1);
  });
});
