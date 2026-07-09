import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { isNodeActivityEvent, type IWsNodeActivityEvent } from '../../models/ws-event';
import { DATA_SOURCE, type IDataSourcePort } from '../data-source/data-source.port';
import { LivePreferencesService } from '../live-preferences';
import {
  NODE_ACTIVITY_INVOCATION_TTL_MS,
  NODE_ACTIVITY_TTL_MS,
  NodeActivityService,
} from '../node-activity';
import { WsEventStreamService } from '../ws-event-stream';

/** Minimal port stub for `LivePreferencesService`'s server-backed pair. */
const PREFS_STUB = {
  getProjectPreferences: () => Promise.resolve({}),
  setProjectPreferences: () => Promise.resolve({}),
} as unknown as IDataSourcePort;

const SKILL = '.claude/skills/deploy/SKILL.md';
const AGENT = '.claude/agents/reviewer.md';

function makeEvent(
  nodePath: string,
  phase: 'start' | 'end',
  owner?: string,
): IWsNodeActivityEvent {
  const data: IWsNodeActivityEvent['data'] = { nodePath, phase };
  if (owner !== undefined) data.owner = owner;
  return { type: 'node.activity', timestamp: 1_700_000_000_000, data };
}

interface IHarness {
  service: NodeActivityService;
  events$: Subject<IWsNodeActivityEvent>;
}

function bootstrap(ttlMs = 40, invocationTtlMs = 60_000): IHarness {
  const events$ = new Subject<IWsNodeActivityEvent>();
  const ws = { nodeActivity$: events$ } as unknown as WsEventStreamService;
  TestBed.configureTestingModule({
    providers: [
      { provide: WsEventStreamService, useValue: ws },
      { provide: NODE_ACTIVITY_TTL_MS, useValue: ttlMs },
      { provide: NODE_ACTIVITY_INVOCATION_TTL_MS, useValue: invocationTtlMs },
      { provide: DATA_SOURCE, useValue: PREFS_STUB },
    ],
  });
  return { service: TestBed.inject(NodeActivityService), events$ };
}

/** Wait past the coalescing flush (one animation frame / 16ms fallback). */
function flushed(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('NodeActivityService', () => {
  it('a start signal lights the node after the coalesced flush', async () => {
    const { service, events$ } = bootstrap();
    expect(service.activePaths().size).toBe(0);

    events$.next(makeEvent(SKILL, 'start', 'main'));
    await flushed();

    expect(service.activePaths().has(SKILL)).toBe(true);
  });

  it('an end signal clears its owner claim immediately', async () => {
    const { service, events$ } = bootstrap(10_000);

    events$.next(makeEvent(AGENT, 'start', 'agent-1'));
    await flushed();
    expect(service.activePaths().has(AGENT)).toBe(true);

    events$.next(makeEvent(AGENT, 'end', 'agent-1'));
    await flushed();
    expect(service.activePaths().has(AGENT)).toBe(false);
  });

  it('a node stays lit while OTHER owners still claim it', async () => {
    const { service, events$ } = bootstrap(10_000);

    // Two instances of the same agent kind running at once.
    events$.next(makeEvent(AGENT, 'start', 'agent-1'));
    events$.next(makeEvent(AGENT, 'start', 'agent-2'));
    await flushed();
    expect(service.activePaths().has(AGENT)).toBe(true);

    events$.next(makeEvent(AGENT, 'end', 'agent-1'));
    await flushed();
    expect(service.activePaths().has(AGENT)).toBe(true);

    events$.next(makeEvent(AGENT, 'end', 'agent-2'));
    await flushed();
    expect(service.activePaths().has(AGENT)).toBe(false);
  });

  it('claims decay when the TTL lapses (units without a native end)', async () => {
    const { service, events$ } = bootstrap(40);

    events$.next(makeEvent(SKILL, 'start', 'main'));
    await flushed();
    expect(service.activePaths().has(SKILL)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(service.activePaths().has(SKILL)).toBe(false);
  });

  it('an owner-scoped end releases EVERYTHING that owner lit (agent, skills, reads)', async () => {
    const { service, events$ } = bootstrap(10_000);

    // A subagent lights itself, a skill it invoked, and a markdown it
    // read; an unrelated main-context claim coexists on the skill.
    events$.next(makeEvent(AGENT, 'start', 'agent-1'));
    events$.next(makeEvent(SKILL, 'start', 'agent-1'));
    events$.next(makeEvent('notes/todo.md', 'start', 'agent-1'));
    events$.next(makeEvent(SKILL, 'start', 'main'));
    await flushed();
    expect(service.activePaths().size).toBe(3);

    // SubagentStop: owner-scoped end on the agent node.
    const stop = makeEvent(AGENT, 'end', 'agent-1');
    stop.data.ownerScope = true;
    events$.next(stop);
    await flushed();

    // The agent and its markdown go dark; the skill survives ONLY via
    // the unrelated main claim.
    expect(service.activePaths().has(AGENT)).toBe(false);
    expect(service.activePaths().has('notes/todo.md')).toBe(false);
    expect(service.activePaths().has(SKILL)).toBe(true);
  });

  it('parent custody: the orchestrator stays lit through its pause and unwinds bottom-up', async () => {
    // Short usage TTL so the test proves custody does NOT depend on it.
    const { service, events$ } = bootstrap(60);
    const ORCH = '.claude/agents/demo-orchestrator.md';

    // 1. Orchestrator starts (its own sticky lifecycle claim).
    const orchStart = makeEvent(ORCH, 'start', 'orch-1');
    orchStart.data.sticky = true;
    events$.next(orchStart);
    // 2. It spawns a child: custody claim on the ORCHESTRATOR node,
    //    first spawn-keyed, then handed to the child id.
    const spawnCustody = makeEvent(ORCH, 'start', 'spawn:t1');
    spawnCustody.data.sticky = true;
    events$.next(spawnCustody);
    const spawnRelease = makeEvent(ORCH, 'end', 'spawn:t1');
    spawnRelease.data.ownerScope = true;
    events$.next(spawnRelease);
    const childCustody = makeEvent(ORCH, 'start', 'child-1');
    childCustody.data.sticky = true;
    events$.next(childCustody);
    // 3. Claude PAUSES the orchestrator: non-terminal SubagentStop =
    //    owner-scoped end of ITS OWN claims. The child's custody claim
    //    must keep the node lit.
    const pause = makeEvent(ORCH, 'end', 'orch-1');
    pause.data.ownerScope = true;
    events$.next(pause);
    await flushed();
    expect(service.activePaths().has(ORCH)).toBe(true);

    // 4. Outlive the short usage TTL: sticky custody survives.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(service.activePaths().has(ORCH)).toBe(true);

    // 5. The child terminally stops: owner-scoped end releases its
    //    custody claim and the orchestrator finally goes dark.
    const childEnd = makeEvent(AGENT, 'end', 'child-1');
    childEnd.data.ownerScope = true;
    events$.next(childEnd);
    await flushed();
    expect(service.activePaths().has(ORCH)).toBe(false);
  });

  it('parent custody, completed handoff: the spawn release alone unwinds cleanly', async () => {
    // Mirrors the REAL event order captured live (fixtures/realtime,
    // 2026-07-04): no pause stops, and the spawn's completion arrives
    // AFTER the child's terminal stop with status 'completed', so the
    // adapter releases the spawn key WITHOUT handing custody to the
    // (already dead) child. The orchestrator must survive on its own
    // lifecycle claim and go dark at its own terminal stop, not stick.
    const { service, events$ } = bootstrap(10_000);
    const ORCH = '.claude/agents/demo-orchestrator.md';

    // Orchestrator starts; spawning the worker adds the spawn-keyed
    // custody claim on the orchestrator's node.
    const orchStart = makeEvent(ORCH, 'start', 'orch-1');
    orchStart.data.sticky = true;
    events$.next(orchStart);
    const spawnCustody = makeEvent(ORCH, 'start', 'spawn:t2');
    spawnCustody.data.sticky = true;
    events$.next(spawnCustody);
    const workerStart = makeEvent(AGENT, 'start', 'worker-1');
    workerStart.data.sticky = true;
    events$.next(workerStart);
    await flushed();
    expect(service.activePaths().has(ORCH)).toBe(true);
    expect(service.activePaths().has(AGENT)).toBe(true);

    // Worker terminally stops FIRST...
    const workerEnd = makeEvent(AGENT, 'end', 'worker-1');
    workerEnd.data.ownerScope = true;
    events$.next(workerEnd);
    // ...then the spawn's completion releases the spawn key (and adds
    // NO child-owned claim). The orchestrator stays lit on its own claim.
    const spawnRelease = makeEvent(ORCH, 'end', 'spawn:t2');
    spawnRelease.data.ownerScope = true;
    events$.next(spawnRelease);
    await flushed();
    expect(service.activePaths().has(AGENT)).toBe(false);
    expect(service.activePaths().has(ORCH)).toBe(true);

    // The orchestrator's own terminal stop takes it dark natively.
    const orchEnd = makeEvent(ORCH, 'end', 'orch-1');
    orchEnd.data.ownerScope = true;
    events$.next(orchEnd);
    await flushed();
    expect(service.activePaths().has(ORCH)).toBe(false);
  });

  it('a node-less OWNER RELEASE darkens everything that owner lit (antigravity Stop)', async () => {
    const { service, events$ } = bootstrap(10_000);

    // One conversation lights a workflow, two skills and a note; an
    // unrelated conversation keeps one node lit.
    events$.next(makeEvent('.agent/workflows/demo-flow.md', 'start', 'conv-1'));
    events$.next(makeEvent(SKILL, 'start', 'conv-1'));
    events$.next(makeEvent('notes/demo.md', 'start', 'conv-1'));
    events$.next(makeEvent(AGENT, 'start', 'conv-2'));
    await flushed();
    expect(service.activePaths().size).toBe(4);

    // The Stop arrives as an owner release with NO nodePath.
    events$.next({
      type: 'node.activity',
      timestamp: 1_700_000_000_000,
      data: { phase: 'end', owner: 'conv-1', ownerScope: true },
    });
    await flushed();

    expect(service.activePaths().size).toBe(1);
    expect(service.activePaths().has(AGENT)).toBe(true);
  });

  it('owner heartbeat refreshes every claim that owner holds', async () => {
    // ttl 250ms: the skill claim alone would die at ~t=250. Heartbeats
    // (other activity from the same owner) land at ~t=130 and ~t=260,
    // each pushing the expiry a full window forward, so the final
    // assertion at ~t=310 (past the original expiry) still sees it lit.
    const { service, events$ } = bootstrap(250);

    events$.next(makeEvent(SKILL, 'start', 'agent-1'));
    await flushed();

    await new Promise((resolve) => setTimeout(resolve, 80));
    events$.next(makeEvent('notes/todo.md', 'start', 'agent-1'));
    await flushed();
    await new Promise((resolve) => setTimeout(resolve, 80));
    events$.next(makeEvent('docs/playbook.md', 'start', 'agent-1'));
    await flushed();

    expect(service.activePaths().has(SKILL)).toBe(true);
  });

  it('a burst of events coalesces into one active set', async () => {
    const { service, events$ } = bootstrap(10_000);

    events$.next(makeEvent(SKILL, 'start', 'main'));
    events$.next(makeEvent(AGENT, 'start', 'agent-1'));
    events$.next(makeEvent(SKILL, 'end', 'main'));
    await flushed();

    expect(service.activePaths().has(SKILL)).toBe(false);
    expect(service.activePaths().has(AGENT)).toBe(true);
  });
});

describe('isNodeActivityEvent', () => {
  it('accepts the canonical payload, with and without owner', () => {
    expect(isNodeActivityEvent(makeEvent(SKILL, 'start', 'main'))).toBe(true);
    expect(isNodeActivityEvent(makeEvent(SKILL, 'end'))).toBe(true);
  });

  it('accepts the node-less owner-release form, and ONLY that shape without nodePath', () => {
    expect(
      isNodeActivityEvent({
        type: 'node.activity',
        timestamp: 1,
        data: { phase: 'end', owner: 'conv-1', ownerScope: true },
      }),
    ).toBe(true);
    // Missing owner, wrong phase, or missing ownerScope: rejected.
    expect(
      isNodeActivityEvent({
        type: 'node.activity',
        timestamp: 1,
        data: { phase: 'end', ownerScope: true },
      }),
    ).toBe(false);
    expect(
      isNodeActivityEvent({
        type: 'node.activity',
        timestamp: 1,
        data: { phase: 'start', owner: 'conv-1', ownerScope: true },
      }),
    ).toBe(false);
    expect(
      isNodeActivityEvent({
        type: 'node.activity',
        timestamp: 1,
        data: { phase: 'end', owner: 'conv-1' },
      }),
    ).toBe(false);
  });

  it('rejects other event types and malformed payloads', () => {
    expect(isNodeActivityEvent({ type: 'scan.completed', timestamp: 1, data: {} })).toBe(false);
    expect(
      isNodeActivityEvent({ type: 'node.activity', timestamp: 1, data: { nodePath: '' } }),
    ).toBe(false);
    expect(
      isNodeActivityEvent({
        type: 'node.activity',
        timestamp: 1,
        data: { nodePath: SKILL, phase: 'running' },
      }),
    ).toBe(false);
    expect(
      isNodeActivityEvent({
        type: 'node.activity',
        timestamp: 1,
        data: { nodePath: SKILL, phase: 'start', owner: 42 },
      }),
    ).toBe(false);
  });
});

describe('NodeActivityService, real-time switch (Settings toggle)', () => {
  it('setEnabled(false) darkens everything immediately and discards incoming frames', async () => {
    const { service, events$ } = bootstrap(10_000);

    events$.next(makeEvent(SKILL, 'start', 'main'));
    events$.next(makeEvent(AGENT, 'start', 'agent-1'));
    await flushed();
    expect(service.activePaths().size).toBe(2);

    service.setEnabled(false);
    // No frame wait: the clear publishes synchronously.
    expect(service.activePaths().size).toBe(0);

    events$.next(makeEvent(SKILL, 'start', 'main'));
    await flushed();
    expect(service.activePaths().size).toBe(0);
  });

  it('setEnabled(true) resumes lighting on the live subscription', async () => {
    const { service, events$ } = bootstrap(10_000);

    service.setEnabled(false);
    events$.next(makeEvent(SKILL, 'start', 'main'));
    await flushed();
    expect(service.activePaths().size).toBe(0);

    service.setEnabled(true);
    events$.next(makeEvent(SKILL, 'start', 'main'));
    await flushed();
    expect(service.activePaths().has(SKILL)).toBe(true);
  });

  it('boots with a persisted OFF: frames are inert until re-enabled', async () => {
    // The preference now arrives from the project-preferences envelope
    // (settings.local.json); the app initializer awaits `load()` before
    // any component constructs, mirrored here.
    const events$ = new Subject<IWsNodeActivityEvent>();
    const ws = { nodeActivity$: events$ } as unknown as WsEventStreamService;
    TestBed.configureTestingModule({
      providers: [
        { provide: WsEventStreamService, useValue: ws },
        { provide: NODE_ACTIVITY_TTL_MS, useValue: 10_000 },
        {
          provide: DATA_SOURCE,
          useValue: {
            getProjectPreferences: () =>
              Promise.resolve({ ui: { liveUpdates: true, realtimeActivity: false } }),
            setProjectPreferences: () => Promise.resolve({}),
          } as unknown as IDataSourcePort,
        },
      ],
    });
    await TestBed.inject(LivePreferencesService).load();
    const service = TestBed.inject(NodeActivityService);

    events$.next(makeEvent(SKILL, 'start', 'main'));
    await flushed();
    expect(service.activePaths().size).toBe(0);
    expect(service.enabled()).toBe(false);
  });
});

describe('NodeActivityService.activeInvocations (tool-invocation edges)', () => {
  const MCP = 'mcp://notion';
  const MCP_OTHER = 'mcp://github';

  function startWithDetail(nodePath: string, owner: string, detail: string): IWsNodeActivityEvent {
    const ev = makeEvent(nodePath, 'start', owner);
    ev.data.detail = detail;
    return ev;
  }

  function only<T>(list: readonly T[]): T {
    expect(list).toHaveLength(1);
    return list[0]!;
  }

  it('correlates the caller to the lit non-mcp node under the same owner', async () => {
    const { service, events$ } = bootstrap(10_000);

    // The agent lights itself, then invokes an MCP tool under its owner.
    events$.next(makeEvent(AGENT, 'start', 'agent-1'));
    events$.next(startWithDetail(MCP, 'agent-1', 'notion-create-pages'));
    await flushed();

    const inv = only(service.activeInvocations());
    expect(inv).toEqual({ target: MCP, caller: AGENT, detail: 'notion-create-pages' });
  });

  it('picks the MOST RECENTLY started candidate (a skill lit after the agent)', async () => {
    const { service, events$ } = bootstrap(10_000);

    events$.next(makeEvent(AGENT, 'start', 'agent-1'));
    events$.next(makeEvent(SKILL, 'start', 'agent-1'));
    events$.next(startWithDetail(MCP, 'agent-1', 'notion-create-pages'));
    await flushed();

    expect(only(service.activeInvocations()).caller).toBe(SKILL);
  });

  it('excludes the target itself and any other mcp node from the caller set', async () => {
    const { service, events$ } = bootstrap(10_000);

    // Only mcp nodes are lit under the owner besides the target: no
    // real caller exists, so caller is null.
    events$.next(startWithDetail(MCP_OTHER, 'main:abc', 'github-search'));
    events$.next(startWithDetail(MCP, 'main:abc', 'notion-create-pages'));
    await flushed();

    const forNotion = service.activeInvocations().find((i) => i.target === MCP);
    expect(forNotion?.caller).toBeNull();
  });

  it('yields a null caller for a bare main-session call with nothing else lit', async () => {
    const { service, events$ } = bootstrap(10_000);

    events$.next(startWithDetail(MCP, 'main:abc', 'notion-create-pages'));
    await flushed();

    expect(only(service.activeInvocations()).caller).toBeNull();
  });

  it('does not correlate a node lit under a DIFFERENT owner', async () => {
    const { service, events$ } = bootstrap(10_000);

    events$.next(makeEvent(AGENT, 'start', 'other-owner'));
    events$.next(startWithDetail(MCP, 'main:abc', 'notion-create-pages'));
    await flushed();

    expect(only(service.activeInvocations()).caller).toBeNull();
  });

  it('a start without a detail records no invocation', async () => {
    const { service, events$ } = bootstrap(10_000);

    events$.next(makeEvent(SKILL, 'start', 'main'));
    await flushed();

    expect(service.activeInvocations()).toHaveLength(0);
  });

  it('correlates the caller via the fallback after its live claim decayed', async () => {
    // Momentary glow 40ms so the skill's own claim decays before the
    // tool call; generous invocation TTL.
    const { service, events$ } = bootstrap(40, 10_000);

    // A skill lights under the owner, then a >TTL gap with NO owner
    // events (a slow tool running): the skill's momentary claim decays
    // and is pruned before the invocation lands.
    events$.next(makeEvent(SKILL, 'start', 'agent-1'));
    await flushed();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(service.activePaths().has(SKILL)).toBe(false);

    events$.next(startWithDetail(MCP, 'agent-1', 'notion-create-pages'));
    await flushed();

    // No live claim survives, so the caller resolves via lastUnitByOwner.
    expect(only(service.activeInvocations()).caller).toBe(SKILL);
  });

  it('keeps the edge after a native end darkens the target (edge is TTL-owned, not glow-owned)', async () => {
    const { service, events$ } = bootstrap(10_000, 10_000);

    events$.next(makeEvent(AGENT, 'start', 'agent-1'));
    events$.next(startWithDetail(MCP, 'agent-1', 'notion-create-pages'));
    await flushed();
    expect(service.activeInvocations()).toHaveLength(1);

    events$.next(makeEvent(MCP, 'end', 'agent-1'));
    await flushed();

    // The mcp node's glow is gone but the edge lives on its own TTL.
    expect(service.activePaths().has(MCP)).toBe(false);
    expect(service.activeInvocations()).toHaveLength(1);
  });

  it('the edge outlives the target glow decay (slow tool)', async () => {
    // Momentary glow 40ms, generous invocation TTL: the mcp node stops
    // glowing at 40ms but the slow tool's edge must persist.
    const { service, events$ } = bootstrap(40, 10_000);

    // Sticky agent stays lit; the mcp start is momentary.
    const agentStart = makeEvent(AGENT, 'start', 'agent-1');
    agentStart.data.sticky = true;
    events$.next(agentStart);
    events$.next(startWithDetail(MCP, 'agent-1', 'notion-create-pages'));
    await flushed();
    expect(service.activePaths().has(MCP)).toBe(true);
    expect(service.activeInvocations()).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(service.activePaths().has(MCP)).toBe(false);
    const inv = only(service.activeInvocations());
    expect(inv.caller).toBe(AGENT);
    expect(inv.detail).toBe('notion-create-pages');
  });

  it('the edge expires at its OWN TTL, not the glow', async () => {
    // Generous glow (node stays lit), short invocation TTL.
    const { service, events$ } = bootstrap(10_000, 60);

    events$.next(makeEvent(AGENT, 'start', 'agent-1'));
    events$.next(startWithDetail(MCP, 'agent-1', 'notion-create-pages'));
    await flushed();
    expect(service.activeInvocations()).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 200));
    // The edge cleared on its own schedule while the node still glows.
    expect(service.activeInvocations()).toHaveLength(0);
    expect(service.activePaths().has(MCP)).toBe(true);
  });

  it('an owner-scope release clears that owner invocation edge', async () => {
    const { service, events$ } = bootstrap(10_000, 10_000);

    events$.next(makeEvent(AGENT, 'start', 'agent-1'));
    events$.next(startWithDetail(MCP, 'agent-1', 'notion-create-pages'));
    await flushed();
    expect(service.activeInvocations()).toHaveLength(1);

    const stop = makeEvent(AGENT, 'end', 'agent-1');
    stop.data.ownerScope = true;
    events$.next(stop);
    await flushed();
    expect(service.activeInvocations()).toHaveLength(0);
  });

  it('setEnabled(false) clears the invocations immediately', async () => {
    const { service, events$ } = bootstrap(10_000, 10_000);

    events$.next(startWithDetail(MCP, 'main:abc', 'x-tool'));
    await flushed();
    expect(service.activeInvocations()).toHaveLength(1);

    service.setEnabled(false);
    expect(service.activeInvocations()).toHaveLength(0);
  });
});
