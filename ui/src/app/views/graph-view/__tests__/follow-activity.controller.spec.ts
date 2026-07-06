/**
 * Unit spec for `setupFollowActivity`. Ported from the two component-
 * level tests that used to spy on GraphView's private
 * `followTargetsFingerprint` / `runFollowActivityFit`; the controller
 * extraction made the state machine testable through its OBSERVABLE
 * surface instead: the `animateToTransform` config callback. Every
 * assertion here counts / inspects those calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { LivePreferencesService } from '../../../../services/live-preferences';
import type { NodeActivityService } from '../../../../services/node-activity';
import {
  setupFollowActivity,
  type IFollowActivityHandle,
  type IFollowSession,
} from '../follow-activity.controller';
import type { IViewportTransform } from '../viewport-animation';

const FOLLOW_KEY = 'sm.live.follow-activity';

describe('follow-activity.controller', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    // LivePreferencesService's server-backed pair injects the port; the
    // follow-activity preference itself still lives in localStorage.
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DATA_SOURCE,
          useValue: {
            getProjectPreferences: () => Promise.resolve({}),
            setProjectPreferences: () => Promise.resolve({}),
          } as unknown as IDataSourcePort,
        },
      ],
    });
    localStorage.removeItem(FOLLOW_KEY);
  });
  afterEach(() => {
    localStorage.removeItem(FOLLOW_KEY);
  });

  function makeHarness(opts?: { bootDone?: boolean }) {
    const active = signal<ReadonlySet<string>>(new Set());
    const activityEnabled = signal(true);
    const visiblePaths = signal<ReadonlySet<string>>(new Set());
    const sessions = signal<readonly IFollowSession[]>([]);
    const layoutComputedAt = signal(0);
    const bootFitDone = signal(opts?.bootDone ?? true);
    const animateToTransform = vi.fn<(t: IViewportTransform) => void>();

    let handle!: IFollowActivityHandle;
    TestBed.runInInjectionContext(() => {
      handle = setupFollowActivity({
        livePrefs: TestBed.inject(LivePreferencesService),
        nodeActivity: {
          enabled: activityEnabled.asReadonly(),
          activePaths: active.asReadonly(),
        } as unknown as NodeActivityService,
        visiblePaths,
        sessions: () => sessions(),
        layoutComputedAt,
        bootFitDone: () => bootFitDone(),
        hostElement: () => ({ clientWidth: 800, clientHeight: 600 }) as HTMLElement,
        positionOf: (path) => ({ x: path.length * 10, y: 5 }),
        panelWidth: () => 0,
        zoomMin: 0.1,
        animateToTransform,
      });
    });

    return {
      handle,
      active,
      activityEnabled,
      visiblePaths,
      sessions,
      layoutComputedAt,
      bootFitDone,
      animateToTransform,
    };
  }

  it('frames only the VISIBLE executing paths; membership is order-insensitive', () => {
    const h = makeHarness();
    h.visiblePaths.set(new Set(['a.md', 'b.md']));
    h.active.set(new Set(['b.md', 'a.md', 'hidden.md']));

    // Follow off: the empty-string sentinel, no framing at all.
    TestBed.tick();
    expect(h.animateToTransform).not.toHaveBeenCalled();

    h.handle.toggle();
    TestBed.tick();
    expect(h.animateToTransform).toHaveBeenCalledTimes(1);

    // Same members, different insertion order: the fingerprint sorts,
    // so this is NOT a membership change and must not re-frame.
    h.active.set(new Set(['a.md', 'b.md', 'hidden.md']));
    TestBed.tick();
    expect(h.animateToTransform).toHaveBeenCalledTimes(1);

    // `hidden.md` is not on the canvas: dropping it never contributed
    // to the fingerprint, so no re-frame either.
    h.active.set(new Set(['a.md', 'b.md']));
    TestBed.tick();
    expect(h.animateToTransform).toHaveBeenCalledTimes(1);
  });

  it('re-frames on membership change and stays quiet on an empty active set', () => {
    const h = makeHarness();
    h.visiblePaths.set(new Set(['a.md', 'b.md']));
    h.active.set(new Set(['a.md']));

    h.handle.toggle();
    TestBed.tick();
    expect(h.animateToTransform).toHaveBeenCalledTimes(1);

    // Activity ended: the camera stays where it is (no re-frame).
    h.active.set(new Set());
    TestBed.tick();
    expect(h.animateToTransform).toHaveBeenCalledTimes(1);

    // New execution wave: re-frame over the fresh membership.
    h.active.set(new Set(['a.md', 'b.md']));
    TestBed.tick();
    expect(h.animateToTransform).toHaveBeenCalledTimes(2);
  });

  it('waits for the boot fit: a persisted follow=ON frames as soon as it settles', () => {
    localStorage.setItem(FOLLOW_KEY, 'true');
    const h = makeHarness({ bootDone: false });
    h.visiblePaths.set(new Set(['a.md']));
    h.active.set(new Set(['a.md']));

    TestBed.tick();
    expect(h.animateToTransform).not.toHaveBeenCalled();

    // Boot fit settles (signal-backed flag): framing starts even though
    // the active set never changed again.
    h.bootFitDone.set(true);
    TestBed.tick();
    expect(h.animateToTransform).toHaveBeenCalledTimes(1);
  });

  it('session capsules join the framed bbox and count toward membership', () => {
    const h = makeHarness();
    h.visiblePaths.set(new Set(['a.md']));
    h.active.set(new Set(['a.md']));

    h.handle.toggle();
    TestBed.tick();
    expect(h.animateToTransform).toHaveBeenCalledTimes(1);

    // A live session capsule appearing IS a membership change.
    h.sessions.set([{ id: 'session:owner-1', position: { x: 300, y: 200 } }]);
    TestBed.tick();
    expect(h.animateToTransform).toHaveBeenCalledTimes(2);
  });

  it('disable() hands the camera back and the effect goes dormant', () => {
    const h = makeHarness();
    h.visiblePaths.set(new Set(['a.md']));
    h.active.set(new Set(['a.md']));

    h.handle.toggle();
    TestBed.tick();
    expect(h.handle.followActivity()).toBe(true);
    expect(h.animateToTransform).toHaveBeenCalledTimes(1);

    h.handle.disable();
    TestBed.tick();
    expect(h.handle.followActivity()).toBe(false);

    // Fresh membership while off: sentinel keeps the camera untouched.
    h.active.set(new Set(['a.md', 'b.md']));
    h.visiblePaths.set(new Set(['a.md', 'b.md']));
    TestBed.tick();
    expect(h.animateToTransform).toHaveBeenCalledTimes(1);
  });
});
