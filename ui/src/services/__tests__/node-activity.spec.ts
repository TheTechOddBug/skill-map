import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { isNodeActivityEvent, type IWsNodeActivityEvent } from '../../models/ws-event';
import { NODE_ACTIVITY_TTL_MS, NodeActivityService } from '../node-activity';
import { WsEventStreamService } from '../ws-event-stream';

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

function bootstrap(ttlMs = 40): IHarness {
  const events$ = new Subject<IWsNodeActivityEvent>();
  const ws = { nodeActivity$: events$ } as unknown as WsEventStreamService;
  TestBed.configureTestingModule({
    providers: [
      { provide: WsEventStreamService, useValue: ws },
      { provide: NODE_ACTIVITY_TTL_MS, useValue: ttlMs },
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
