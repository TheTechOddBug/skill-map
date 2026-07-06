import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import type {
  IWsAgentSpawnData,
  IWsAgentSpawnEvent,
  IWsNodeActivityEvent,
} from '../../models/ws-event';
import { AGENT_SPAWN_TTL_MS, AgentSpawnService } from '../agent-spawn';
import { DATA_SOURCE, type IDataSourcePort } from '../data-source/data-source.port';
import { LivePreferencesService } from '../live-preferences';
import { WsEventStreamService } from '../ws-event-stream';

const PARENT = '.claude/agents/demo-orchestrator.md';
const CHILD = '.claude/agents/demo-worker.md';
const SESSION_OWNER = 'main:6cfe5636-2e56-4271-91a6-87fc3d4355be';

/** Minimal port stub for `LivePreferencesService`'s server-backed pair. */
const PREFS_STUB = {
  getProjectPreferences: () => Promise.resolve({}),
  setProjectPreferences: () => Promise.resolve({}),
} as unknown as IDataSourcePort;

function spawnEvent(data: IWsAgentSpawnData): IWsAgentSpawnEvent {
  return { type: 'agent.spawn', timestamp: 1_700_000_000_000, data };
}

function ownerEnd(owner: string): IWsNodeActivityEvent {
  return {
    type: 'node.activity',
    timestamp: 1_700_000_000_000,
    data: { phase: 'end', owner, ownerScope: true },
  };
}

function heartbeat(owner: string, nodePath = CHILD): IWsNodeActivityEvent {
  return {
    type: 'node.activity',
    timestamp: 1_700_000_000_000,
    data: { nodePath, phase: 'start', owner },
  };
}

interface IHarness {
  service: AgentSpawnService;
  spawns$: Subject<IWsAgentSpawnEvent>;
  activity$: Subject<IWsNodeActivityEvent>;
  prefs: LivePreferencesService;
}

function bootstrap(ttlMs = 10_000): IHarness {
  TestBed.resetTestingModule();
  const spawns$ = new Subject<IWsAgentSpawnEvent>();
  const activity$ = new Subject<IWsNodeActivityEvent>();
  const ws = { agentSpawn$: spawns$, nodeActivity$: activity$ } as unknown as WsEventStreamService;
  TestBed.configureTestingModule({
    providers: [
      { provide: WsEventStreamService, useValue: ws },
      { provide: AGENT_SPAWN_TTL_MS, useValue: ttlMs },
      { provide: DATA_SOURCE, useValue: PREFS_STUB },
    ],
  });
  return {
    service: TestBed.inject(AgentSpawnService),
    spawns$,
    activity$,
    prefs: TestBed.inject(LivePreferencesService),
  };
}

/** Wait past the coalescing flush (one animation frame / 16ms fallback). */
function flushed(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('AgentSpawnService', () => {
  it('a start frame with a node parent publishes one spawn edge', async () => {
    const { service, spawns$ } = bootstrap();
    spawns$.next(
      spawnEvent({
        spawnId: 't1',
        phase: 'start',
        parentOwner: 'orch-1',
        parentNodePath: PARENT,
        childKind: 'agent',
        childName: 'demo-worker',
        childNodePath: CHILD,
      }),
    );
    await flushed();
    const edges = service.spawnEdges();
    expect(edges.length).toBe(1);
    expect(edges[0]!.spawnId).toBe('t1');
    expect(edges[0]!.parentNodePath).toBe(PARENT);
    expect(edges[0]!.parentSession).toBeUndefined();
    expect(service.sessionNodes().length).toBe(0);
  });

  it('a session-parent start derives parentSession and publishes a session node', async () => {
    const { service, spawns$ } = bootstrap();
    spawns$.next(
      spawnEvent({
        spawnId: 't2',
        phase: 'start',
        parentOwner: SESSION_OWNER,
        childName: 'demo-worker',
        childNodePath: CHILD,
      }),
    );
    await flushed();
    expect(service.spawnEdges()[0]!.parentSession).toBe(SESSION_OWNER);
    expect(service.sessionNodes()).toEqual([{ owner: SESSION_OWNER, ordinal: 1 }]);
  });

  it('handoff merges childOwner / childNodePath onto the existing entry', async () => {
    const { service, spawns$ } = bootstrap();
    spawns$.next(
      spawnEvent({
        spawnId: 't3',
        phase: 'start',
        parentOwner: 'orch-1',
        parentNodePath: PARENT,
        childName: 'demo-worker',
      }),
    );
    await flushed();
    expect(service.spawnEdges()[0]!.childOwner).toBeUndefined();

    spawns$.next(
      spawnEvent({
        spawnId: 't3',
        phase: 'handoff',
        parentOwner: 'orch-1',
        parentNodePath: PARENT,
        childOwner: 'worker-1',
        childNodePath: CHILD,
      }),
    );
    await flushed();
    const edge = service.spawnEdges()[0]!;
    expect(edge.childOwner).toBe('worker-1');
    expect(edge.childNodePath).toBe(CHILD);
    expect(edge.childName).toBe('demo-worker'); // start's field survives the merge
  });

  it('an explicit end frame releases the edge', async () => {
    const { service, spawns$ } = bootstrap();
    spawns$.next(
      spawnEvent({ spawnId: 't4', phase: 'start', parentOwner: 'orch-1', parentNodePath: PARENT, childNodePath: CHILD }),
    );
    await flushed();
    expect(service.spawnEdges().length).toBe(1);

    spawns$.next(spawnEvent({ spawnId: 't4', phase: 'end', parentOwner: 'orch-1' }));
    await flushed();
    expect(service.spawnEdges().length).toBe(0);
  });

  it('a matching childOwner owner-scoped end releases the edge (async spawns)', async () => {
    const { service, spawns$, activity$ } = bootstrap();
    spawns$.next(
      spawnEvent({ spawnId: 't5', phase: 'start', parentOwner: SESSION_OWNER, childNodePath: CHILD }),
    );
    spawns$.next(
      spawnEvent({ spawnId: 't5', phase: 'handoff', parentOwner: SESSION_OWNER, childOwner: 'worker-1' }),
    );
    await flushed();
    expect(service.spawnEdges().length).toBe(1);

    // A NON-matching owner end leaves it alone...
    activity$.next(ownerEnd('worker-2'));
    await flushed();
    expect(service.spawnEdges().length).toBe(1);

    // ...the matching one releases, and the session anchor goes with it.
    activity$.next(ownerEnd('worker-1'));
    await flushed();
    expect(service.spawnEdges().length).toBe(0);
    expect(service.sessionNodes().length).toBe(0);
  });

  it('pause is not end: an owner-scoped stop keeps the edge while the stopping owner parents a live spawn', async () => {
    const { service, spawns$, activity$ } = bootstrap();
    // session -> orchestrator (async, custody handed to orch-1)...
    spawns$.next(
      spawnEvent({ spawnId: 't5a', phase: 'start', parentOwner: SESSION_OWNER, childNodePath: PARENT }),
    );
    spawns$.next(
      spawnEvent({ spawnId: 't5a', phase: 'handoff', parentOwner: SESSION_OWNER, childOwner: 'orch-1' }),
    );
    // ...and the orchestrator spawns its own worker (the reason it pauses).
    spawns$.next(
      spawnEvent({ spawnId: 't5b', phase: 'start', parentOwner: 'orch-1', parentNodePath: PARENT, childNodePath: CHILD }),
    );
    await flushed();
    expect(service.spawnEdges().length).toBe(2);
    expect(service.sessionNodes().length).toBe(1);

    // The orchestrator's PAUSE stop (it awaits its worker) must NOT
    // release the session edge: it still parents a live spawn.
    activity$.next(ownerEnd('orch-1'));
    await flushed();
    expect(service.spawnEdges().length).toBe(2);
    expect(service.sessionNodes().length).toBe(1);

    // The worker's sync spawn completes (explicit end frame)...
    spawns$.next(spawnEvent({ spawnId: 't5b', phase: 'end', parentOwner: 'orch-1' }));
    await flushed();
    expect(service.spawnEdges().length).toBe(1);

    // ...so the orchestrator's NEXT stop is terminal (no live children)
    // and the session edge unwinds bottom-up.
    activity$.next(ownerEnd('orch-1'));
    await flushed();
    expect(service.spawnEdges().length).toBe(0);
    expect(service.sessionNodes().length).toBe(0);
  });

  it('a pause stop refreshes the paused owner edges instead of expiring them', async () => {
    const { service, spawns$, activity$ } = bootstrap(200);
    spawns$.next(
      spawnEvent({ spawnId: 't5c', phase: 'start', parentOwner: SESSION_OWNER, childNodePath: PARENT }),
    );
    spawns$.next(
      spawnEvent({ spawnId: 't5c', phase: 'handoff', parentOwner: SESSION_OWNER, childOwner: 'orch-1' }),
    );
    spawns$.next(
      spawnEvent({ spawnId: 't5d', phase: 'start', parentOwner: 'orch-1', parentNodePath: PARENT, childNodePath: CHILD }),
    );
    await flushed();

    // Two pause stops inside the TTL window keep sliding it forward.
    activity$.next(ownerEnd('orch-1'));
    await new Promise((resolve) => setTimeout(resolve, 120));
    activity$.next(ownerEnd('orch-1'));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(service.spawnEdges().length).toBe(2);
  });

  it('the sticky TTL sweep reaps an edge with no end signal (crash safety net)', async () => {
    const { service, spawns$ } = bootstrap(60);
    spawns$.next(
      spawnEvent({ spawnId: 't6', phase: 'start', parentOwner: 'orch-1', parentNodePath: PARENT, childNodePath: CHILD }),
    );
    await flushed();
    expect(service.spawnEdges().length).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(service.spawnEdges().length).toBe(0);
  });

  it('heartbeats from a participating owner slide the decay window forward', async () => {
    // ttl 250ms: without the heartbeat the edge dies at ~t=250. The
    // beat lands at ~t=130 and pushes expiry a full window forward, so
    // the assertion at ~t=330 (past the original expiry) still sees it.
    const { service, spawns$, activity$ } = bootstrap(250);
    spawns$.next(
      spawnEvent({
        spawnId: 't6b',
        phase: 'start',
        parentOwner: 'orch-1',
        parentNodePath: PARENT,
        childOwner: 'worker-1',
        childNodePath: CHILD,
      }),
    );
    await flushed();

    await new Promise((resolve) => setTimeout(resolve, 80));
    activity$.next(heartbeat('worker-1'));
    await flushed();

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(service.spawnEdges().length).toBe(1);
  });

  it('session ordinals are stable for the page lifetime (a returning session keeps its number)', async () => {
    const { service, spawns$ } = bootstrap();
    const OTHER_SESSION = 'main:0000-other';
    spawns$.next(
      spawnEvent({ spawnId: 'a1', phase: 'start', parentOwner: SESSION_OWNER, childNodePath: CHILD }),
    );
    await flushed();
    spawns$.next(
      spawnEvent({ spawnId: 'b1', phase: 'start', parentOwner: OTHER_SESSION, childNodePath: CHILD }),
    );
    await flushed();
    expect(service.sessionNodes()).toEqual([
      { owner: SESSION_OWNER, ordinal: 1 },
      { owner: OTHER_SESSION, ordinal: 2 },
    ]);

    // Session 1's spawn ends; when it spawns again it is STILL Session 1.
    spawns$.next(spawnEvent({ spawnId: 'a1', phase: 'end', parentOwner: SESSION_OWNER }));
    await flushed();
    expect(service.sessionNodes()).toEqual([{ owner: OTHER_SESSION, ordinal: 2 }]);

    spawns$.next(
      spawnEvent({ spawnId: 'a2', phase: 'start', parentOwner: SESSION_OWNER, childNodePath: CHILD }),
    );
    await flushed();
    expect(service.sessionNodes()).toEqual([
      { owner: SESSION_OWNER, ordinal: 1 },
      { owner: OTHER_SESSION, ordinal: 2 },
    ]);
  });

  it('Real Time off clears live spawns and drops frames until re-enabled', async () => {
    const { service, spawns$, prefs } = bootstrap();
    spawns$.next(
      spawnEvent({ spawnId: 't7', phase: 'start', parentOwner: SESSION_OWNER, childNodePath: CHILD }),
    );
    await flushed();
    expect(service.spawnEdges().length).toBe(1);

    prefs.setActivityEnabled(false);
    TestBed.tick(); // run the clearing effect
    expect(service.spawnEdges().length).toBe(0);
    expect(service.sessionNodes().length).toBe(0);

    spawns$.next(
      spawnEvent({ spawnId: 't8', phase: 'start', parentOwner: SESSION_OWNER, childNodePath: CHILD }),
    );
    await flushed();
    expect(service.spawnEdges().length).toBe(0);

    prefs.setActivityEnabled(true);
    TestBed.tick();
    spawns$.next(
      spawnEvent({ spawnId: 't9', phase: 'start', parentOwner: SESSION_OWNER, childNodePath: CHILD }),
    );
    await flushed();
    expect(service.spawnEdges().length).toBe(1);
  });
});
