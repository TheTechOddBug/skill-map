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
