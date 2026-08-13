/**
 * `LiveLensService` unit tests: the watermark membership (executing ∪
 * recent-inside-window), the reset watermark, the infinite window, the
 * single self-rearming expiry timer, the stale-`lastStartAt` union
 * guarantee, and the debounced full-membership branch fetch.
 *
 * Time control: fake timers + `setSystemTime`, so `Date.now()` inside
 * the membership computed and the timer wheel advance in lock-step.
 * Effects flush via `TestBed.tick()`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import type { INodeActivityStatsApi, IScanResultApi } from '../../models/api';
import { AgentSpawnService, type ISpawnView } from '../agent-spawn';
import { CollectionLoaderService } from '../collection-loader';
import { DATA_SOURCE } from '../data-source/data-source.port';
import { SKILL_MAP_MODE, type TSkillMapMode } from '../data-source/runtime-mode';
import { LIVE_LENS_DEFAULT_WINDOW_MS, LiveLensService } from '../live-lens';
import { NodeActivityService, type INodeInvocation } from '../node-activity';
import { NodeActivityStatsService } from '../node-activity-stats';

const T0 = 1_700_000_000_000;
const SKILL = '.claude/skills/deploy/SKILL.md';
const AGENT = '.claude/agents/reviewer.md';

function scanMetaFixture(): IScanResultApi {
  return {
    schemaVersion: 1,
    scannedAt: T0,
    roots: ['/tmp/x'],
    nodes: [],
    links: [],
    issues: [],
    stats: {
      filesWalked: 0,
      filesSkipped: 0,
      nodesCount: 0,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
}

function apiNode(path: string): Record<string, unknown> {
  return {
    path,
    kind: 'markdown',
    provider: 'claude',
    bodyHash: 'a'.repeat(64),
    frontmatterHash: 'b'.repeat(64),
    bytes: { frontmatter: 10, body: 90, total: 100 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

function statsOf(lastStartAt: number): INodeActivityStatsApi {
  return { count: 1, lastStartAt, distinctOwners: 1 };
}

function bootstrap(mode: TSkillMapMode = 'live') {
  TestBed.resetTestingModule();
  const activePaths = signal<ReadonlySet<string>>(new Set());
  const enabled = signal(true);
  const activeInvocations = signal<readonly INodeInvocation[]>([]);
  const spawnEdges = signal<readonly ISpawnView[]>([]);
  const stats = signal<ReadonlyMap<string, INodeActivityStatsApi>>(new Map());
  const scanMeta = signal<IScanResultApi | null>(scanMetaFixture());
  const loadBranch = vi.fn().mockResolvedValue({ nodes: [], links: [], issues: [] });
  TestBed.configureTestingModule({
    providers: [
      {
        provide: NodeActivityService,
        useValue: {
          activePaths: activePaths.asReadonly(),
          enabled: enabled.asReadonly(),
          activeInvocations: activeInvocations.asReadonly(),
        } as unknown as NodeActivityService,
      },
      {
        provide: NodeActivityStatsService,
        useValue: { stats: stats.asReadonly() } as unknown as NodeActivityStatsService,
      },
      {
        provide: AgentSpawnService,
        useValue: { spawnEdges: spawnEdges.asReadonly() } as unknown as AgentSpawnService,
      },
      {
        provide: CollectionLoaderService,
        useValue: { scanMeta: scanMeta.asReadonly() } as unknown as CollectionLoaderService,
      },
      { provide: DATA_SOURCE, useValue: { loadBranch } },
      { provide: SKILL_MAP_MODE, useValue: mode },
    ],
  });
  const service = TestBed.inject(LiveLensService);
  return { service, activePaths, enabled, activeInvocations, spawnEdges, stats, loadBranch };
}

describe('LiveLensService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      localStorage.removeItem('sm.live.lens-window');
    } catch {
      // Storage-less environment: the service falls back to defaults.
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('membership is empty while the lens is off, whatever is executing', () => {
    const { service, activePaths } = bootstrap();
    activePaths.set(new Set([SKILL]));
    expect(service.membership().size).toBe(0);
  });

  it('activating shows the currently-executing nodes', () => {
    const { service, activePaths } = bootstrap();
    activePaths.set(new Set([SKILL, AGENT]));
    service.setActive(true);
    expect([...service.membership()].sort()).toEqual([AGENT, SKILL].sort());
  });

  it('a departed node lingers for the window, then expires via the timer', () => {
    const { service, activePaths } = bootstrap();
    service.setActive(true);
    activePaths.set(new Set([SKILL]));
    TestBed.tick();
    activePaths.set(new Set());
    TestBed.tick(); // departure stamp + expiry timer arm
    expect(service.membership().has(SKILL)).toBe(true);

    vi.advanceTimersByTime(LIVE_LENS_DEFAULT_WINDOW_MS + 100);
    TestBed.tick(); // expiry tick fired, membership re-evaluates
    expect(service.membership().has(SKILL)).toBe(false);
  });

  it('recency from stats().lastStartAt counts, so pre-toggle activity shows', () => {
    const { service, stats } = bootstrap();
    stats.set(new Map([[SKILL, statsOf(T0 - 60_000)]])); // 1 min ago
    service.setActive(true);
    expect(service.membership().has(SKILL)).toBe(true);
  });

  it('a stale lastStartAt is overridden by the executing union', () => {
    const { service, activePaths, stats } = bootstrap();
    // Counted start far outside the window, but the agent still runs.
    stats.set(new Map([[AGENT, statsOf(T0 - 60 * 60_000)]]));
    activePaths.set(new Set([AGENT]));
    service.setActive(true);
    expect(service.membership().has(AGENT)).toBe(true);
  });

  it('reset drops the lingering set but keeps executing nodes', () => {
    const { service, activePaths, stats } = bootstrap();
    stats.set(new Map([[SKILL, statsOf(T0 - 1000)]]));
    activePaths.set(new Set([AGENT]));
    service.setActive(true);
    expect(service.membership().has(SKILL)).toBe(true);

    vi.advanceTimersByTime(10);
    service.reset();
    TestBed.tick();
    expect(service.membership().has(SKILL)).toBe(false);
    expect(service.membership().has(AGENT)).toBe(true);
  });

  it('the infinite window accumulates past the default window, until reset', () => {
    const { service, activePaths } = bootstrap();
    service.setWindow(Number.POSITIVE_INFINITY);
    service.setActive(true);
    activePaths.set(new Set([SKILL]));
    TestBed.tick();
    activePaths.set(new Set());
    TestBed.tick();

    vi.advanceTimersByTime(3 * LIVE_LENS_DEFAULT_WINDOW_MS);
    TestBed.tick();
    expect(service.membership().has(SKILL)).toBe(true);

    service.reset();
    TestBed.tick();
    expect(service.membership().has(SKILL)).toBe(false);
  });

  it('re-execution re-adds a node the reset cleared', () => {
    const { service, activePaths } = bootstrap();
    service.setActive(true);
    activePaths.set(new Set([SKILL]));
    TestBed.tick();
    activePaths.set(new Set());
    TestBed.tick();
    service.reset();
    TestBed.tick();
    expect(service.membership().has(SKILL)).toBe(false);

    activePaths.set(new Set([SKILL]));
    TestBed.tick();
    expect(service.membership().has(SKILL)).toBe(true);
  });

  it('Real Time off force-deactivates the lens', () => {
    const { service, enabled } = bootstrap();
    service.setActive(true);
    expect(service.active()).toBe(true);
    enabled.set(false);
    TestBed.tick();
    expect(service.active()).toBe(false);
  });

  it('demo mode reports unavailable and setActive no-ops', () => {
    const { service } = bootstrap('demo');
    expect(service.available()).toBe(false);
    service.setActive(true);
    expect(service.active()).toBe(false);
  });

  it('membership growth fetches the FULL membership once, debounced', async () => {
    const { service, activePaths, loadBranch } = bootstrap();
    loadBranch.mockResolvedValue({
      nodes: [apiNode(SKILL), apiNode(AGENT)],
      links: [],
      issues: [],
    });
    service.setActive(true);
    activePaths.set(new Set([SKILL]));
    TestBed.tick();
    activePaths.set(new Set([SKILL, AGENT]));
    TestBed.tick();

    await vi.advanceTimersByTimeAsync(400);
    expect(loadBranch).toHaveBeenCalledTimes(1);
    expect(loadBranch).toHaveBeenCalledWith({
      include: [AGENT, SKILL].sort(),
      exclude: [],
      excludeRoot: true,
    });
    TestBed.tick();
    expect(service.lensNodes().map((n) => n.path)).toEqual([AGENT, SKILL].sort());
  });

  it('lensScan carries only links whose BOTH endpoints are live', async () => {
    const { service, activePaths, loadBranch } = bootstrap();
    loadBranch.mockResolvedValue({
      nodes: [apiNode(SKILL), apiNode(AGENT)],
      links: [
        { source: SKILL, target: AGENT, kind: 'invokes', confidence: 0.9, sources: ['ext'] },
        { source: SKILL, target: 'other.md', kind: 'invokes', confidence: 0.9, sources: ['ext'] },
      ],
      issues: [],
    });
    service.setActive(true);
    activePaths.set(new Set([SKILL, AGENT]));
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(400);
    TestBed.tick();

    const scan = service.lensScan();
    expect(scan?.nodes.map((n) => n.path)).toEqual([AGENT, SKILL].sort());
    expect(scan?.links).toHaveLength(1);
    expect(scan?.links[0]?.target).toBe(AGENT);
    expect(scan?.issues).toEqual([]);
  });

  it('cached members do not refetch when membership shrinks', async () => {
    const { service, activePaths, loadBranch } = bootstrap();
    loadBranch.mockResolvedValue({
      nodes: [apiNode(SKILL), apiNode(AGENT)],
      links: [],
      issues: [],
    });
    service.setActive(true);
    activePaths.set(new Set([SKILL, AGENT]));
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(400);
    TestBed.tick();
    expect(loadBranch).toHaveBeenCalledTimes(1);

    // AGENT departs; SKILL alone is fully cached, no new fetch.
    activePaths.set(new Set([SKILL]));
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(400);
    expect(loadBranch).toHaveBeenCalledTimes(1);
  });

  it('the window preference persists per browser', () => {
    const first = bootstrap();
    first.service.setWindow(Number.POSITIVE_INFINITY);
    const second = bootstrap();
    expect(second.service.windowMs()).toBe(Number.POSITIVE_INFINITY);
  });

  it('an observed invocation outlives the live overlay while both ends are members', () => {
    const { service, activePaths, activeInvocations } = bootstrap();
    service.setActive(true);
    activePaths.set(new Set([SKILL, AGENT]));
    activeInvocations.set([{ target: SKILL, caller: AGENT, detail: 'mcp__db__query' }]);
    TestBed.tick(); // sighting stamped

    // The live invocation TTL sweeps it away; the observation persists.
    activeInvocations.set([]);
    TestBed.tick();
    expect(service.observedInvocations()).toHaveLength(1);
    expect(service.observedInvocations()[0]?.label).toBe('mcp__db__query');

    // Reset clears the accumulated relations along with the canvas.
    vi.advanceTimersByTime(10);
    service.reset();
    TestBed.tick();
    expect(service.observedInvocations()).toHaveLength(0);
  });

  it('a bare main-session invocation (null caller) never records an edge', () => {
    const { service, activePaths, activeInvocations } = bootstrap();
    service.setActive(true);
    activePaths.set(new Set([SKILL]));
    activeInvocations.set([{ target: SKILL, caller: null, detail: 'mcp__db__query' }]);
    TestBed.tick();
    expect(service.observedInvocations()).toHaveLength(0);
  });

  it('an observed spawn keeps its last spawnId after the live spawn ends', () => {
    const { service, activePaths, spawnEdges } = bootstrap();
    service.setActive(true);
    activePaths.set(new Set([SKILL, AGENT]));
    spawnEdges.set([
      { spawnId: 'toolu_01', parentOwner: 'main:abc', parentNodePath: AGENT, childNodePath: SKILL },
    ]);
    TestBed.tick();

    spawnEdges.set([]); // the end frame released the live entry
    TestBed.tick();
    expect(service.observedSpawns()).toHaveLength(1);
    expect(service.observedSpawns()[0]?.lastSpawnId).toBe('toolu_01');
  });

  it('session-parent spawns (no parent node) are not recorded', () => {
    const { service, activePaths, spawnEdges } = bootstrap();
    service.setActive(true);
    activePaths.set(new Set([SKILL]));
    spawnEdges.set([
      { spawnId: 'toolu_02', parentOwner: 'main:abc', parentSession: 'main:abc', childNodePath: SKILL },
    ]);
    TestBed.tick();
    expect(service.observedSpawns()).toHaveLength(0);
  });

  it('a spine pair persists after the glow and expires with the watermark', async () => {
    const { service, activePaths, loadBranch } = bootstrap();
    loadBranch.mockResolvedValue({
      nodes: [apiNode(SKILL), apiNode(AGENT)],
      links: [
        { source: AGENT, target: SKILL, kind: 'invokes', confidence: 0.9, sources: ['ext'] },
      ],
      issues: [],
    });
    service.setActive(true);
    activePaths.set(new Set([SKILL, AGENT]));
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(400); // link cache fill
    TestBed.tick(); // spine sighting stamped against the cached link

    const key = `${AGENT}|${SKILL}`;
    expect(service.observedSpinePairs().has(key)).toBe(true);

    // Glow ends: the spine treatment persists while both linger.
    activePaths.set(new Set());
    TestBed.tick();
    expect(service.observedSpinePairs().has(key)).toBe(true);

    // Watermark ages the whole thing out (nodes and relation together).
    vi.advanceTimersByTime(LIVE_LENS_DEFAULT_WINDOW_MS + 100);
    TestBed.tick();
    expect(service.observedSpinePairs().has(key)).toBe(false);
  });

  it('reset hides relations even when one endpoint keeps executing', () => {
    const { service, activePaths, activeInvocations, stats } = bootstrap();
    service.setActive(true);
    // AGENT executes and stays executing; SKILL only lingers via stats.
    stats.set(new Map([[SKILL, statsOf(T0 - 1000)]]));
    activePaths.set(new Set([AGENT]));
    activeInvocations.set([{ target: SKILL, caller: AGENT, detail: 'mcp__db__query' }]);
    TestBed.tick();
    activeInvocations.set([]);
    TestBed.tick();
    expect(service.observedInvocations()).toHaveLength(1);

    // Reset drops SKILL (linger-only member); AGENT survives as
    // executing, so the relation loses an endpoint and hides.
    vi.advanceTimersByTime(10);
    service.reset();
    TestBed.tick();
    expect(service.membership().has(AGENT)).toBe(true);
    expect(service.observedInvocations()).toHaveLength(0);
  });
});
