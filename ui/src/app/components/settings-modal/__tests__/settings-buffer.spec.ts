import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import {
  SettingsBufferService,
  type IBufferOwner,
} from '../settings-buffer';
import { ScanTriggerService } from '../../../services/scan-trigger';
import {
  DATA_SOURCE,
  type IDataSourcePort,
  type IPluginChange,
} from '../../../../services/data-source/data-source.port';
import type { IListEnvelopeApi, IPluginItemApi } from '../../../../models/api';

/**
 * SettingsBufferService, the multi-owner global Apply coordinator. The
 * key behaviours under test:
 *   - `dirtyCount` sums every registered owner's `dirtyIds().size`.
 *   - `applyChanges()` MERGES every owner's `collectChanges()` into ONE
 *     `applyPluginChanges(...)` call (single bulk PATCH), then reseeds
 *     every owner from the response and fires a scan.
 *   - on error the buffers stay dirty and `applyError` surfaces.
 *   - `discardChanges()` reverts every owner.
 *   - register / deregister add / remove owners from the set.
 */

function pluginsEnvelope(items: IPluginItemApi[]): IListEnvelopeApi<IPluginItemApi> {
  return {
    schemaVersion: '1',
    kind: 'plugins',
    items,
    filters: {},
    counts: { total: items.length, returned: items.length },
    kindRegistry: {},
  };
}

/**
 * Minimal scriptable buffer owner: a writable dirty set + a fixed change
 * list it collects, plus spies for `reseed` / `discardChanges`.
 */
function makeOwner(
  changes: IPluginChange[],
  dirty: string[] = changes.map((c) => c.id),
): IBufferOwner & {
  reseedSpy: ReturnType<typeof vi.fn>;
  discardSpy: ReturnType<typeof vi.fn>;
  dirtySig: ReturnType<typeof signal<ReadonlySet<string>>>;
} {
  const dirtySig = signal<ReadonlySet<string>>(new Set(dirty));
  const reseedSpy = vi.fn();
  const discardSpy = vi.fn();
  return {
    dirtyIds: dirtySig,
    collectChanges: () => changes,
    reseed: (plugins) => reseedSpy(plugins),
    discardChanges: () => {
      discardSpy();
      dirtySig.set(new Set());
    },
    reseedSpy,
    discardSpy,
    dirtySig,
  };
}

interface ISetup {
  service: SettingsBufferService;
  applyPluginChanges: ReturnType<typeof vi.fn>;
  scanRun: ReturnType<typeof vi.fn>;
}

function setup(
  applyImpl: (changes: ReadonlyArray<IPluginChange>) => Promise<IListEnvelopeApi<IPluginItemApi>>,
): ISetup {
  TestBed.resetTestingModule();
  const applyPluginChanges = vi.fn(applyImpl);
  const scanRun = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: { applyPluginChanges } as Partial<IDataSourcePort> },
      { provide: ScanTriggerService, useValue: { run: scanRun } },
    ],
  });
  return { service: TestBed.inject(SettingsBufferService), applyPluginChanges, scanRun };
}

describe('SettingsBufferService, dirtyCount', () => {
  it('sums every registered owner dirty set and tracks register / deregister', () => {
    const { service } = setup(async () => pluginsEnvelope([]));
    const a = makeOwner([{ id: 'a/x', enabled: false }], ['a/x']);
    const b = makeOwner(
      [{ id: 'b/y', settings: { tok: 's' } }],
      ['b/y', 'b/z'],
    );

    expect(service.dirtyCount()).toBe(0);
    service.register(a);
    expect(service.dirtyCount()).toBe(1);
    service.register(b);
    expect(service.dirtyCount()).toBe(3); // 1 (a) + 2 (b)

    service.deregister(a);
    expect(service.dirtyCount()).toBe(2);
    service.deregister(b);
    expect(service.dirtyCount()).toBe(0);
  });

  it('register is idempotent for the same instance', () => {
    const { service } = setup(async () => pluginsEnvelope([]));
    const a = makeOwner([{ id: 'a/x', enabled: false }], ['a/x']);
    service.register(a);
    service.register(a);
    expect(service.dirtyCount()).toBe(1);
  });
});

describe('SettingsBufferService, restartRecommended', () => {
  it('is true when any owner advises a restart, false otherwise', () => {
    const { service } = setup(async () => pluginsEnvelope([]));
    const plain = makeOwner([{ id: 'a/x', enabled: false }], ['a/x']);
    const advising: IBufferOwner = {
      ...makeOwner([{ id: 'b/y', enabled: true }], ['b/y']),
      restartRecommended: signal(true),
    };

    service.register(plain);
    expect(service.restartRecommended()).toBe(false);

    service.register(advising);
    expect(service.restartRecommended()).toBe(true);
  });
});

describe('SettingsBufferService, applyChanges merges into ONE PATCH', () => {
  it('merges every owner collectChanges into one applyPluginChanges call, reseeds all, fires a scan', async () => {
    const after = [
      { id: 'a', version: null, kinds: ['extractor'], status: 'enabled', reason: null, source: 'built-in' } as IPluginItemApi,
    ];
    const { service, applyPluginChanges, scanRun } = setup(async () => pluginsEnvelope(after));

    const a = makeOwner([{ id: 'a/x', enabled: false }], ['a/x']);
    const b = makeOwner([{ id: 'b/y', settings: { tok: 'secret' } }], ['b/y']);
    service.register(a);
    service.register(b);

    const result = await service.applyChanges();

    expect(result.ok).toBe(true);
    // ONE bulk PATCH carrying BOTH owners' changes.
    expect(applyPluginChanges).toHaveBeenCalledTimes(1);
    const merged = applyPluginChanges.mock.calls[0][0] as IPluginChange[];
    expect(merged).toEqual(
      expect.arrayContaining([
        { id: 'a/x', enabled: false },
        { id: 'b/y', settings: { tok: 'secret' } },
      ]),
    );
    expect(merged).toHaveLength(2);

    // Every owner reseeded from the response, then a scan fires.
    expect(a.reseedSpy).toHaveBeenCalledWith(after);
    expect(b.reseedSpy).toHaveBeenCalledWith(after);
    expect(scanRun).toHaveBeenCalledTimes(1);
    expect(service.applyError()).toBeNull();
  });

  it('resolves ok=false and does not PATCH when nothing is dirty', async () => {
    const { service, applyPluginChanges, scanRun } = setup(async () => pluginsEnvelope([]));
    const clean = makeOwner([], []);
    service.register(clean);

    const result = await service.applyChanges();

    expect(result.ok).toBe(false);
    expect(applyPluginChanges).not.toHaveBeenCalled();
    expect(scanRun).not.toHaveBeenCalled();
  });

  it('on error surfaces applyError, leaves buffers dirty, and does not scan', async () => {
    const { service, scanRun } = setup(async () => {
      throw new Error('apply boom');
    });
    const a = makeOwner([{ id: 'a/x', enabled: false }], ['a/x']);
    service.register(a);

    const result = await service.applyChanges();

    expect(result.ok).toBe(false);
    expect(service.applyError()).toBe('apply boom');
    expect(a.reseedSpy).not.toHaveBeenCalled();
    expect(scanRun).not.toHaveBeenCalled();
    // Buffer stays dirty so the user can retry or discard.
    expect(service.dirtyCount()).toBe(1);
  });
});

describe('SettingsBufferService, discardChanges', () => {
  it('reverts every owner and clears the error', async () => {
    const { service } = setup(async () => pluginsEnvelope([]));
    const a = makeOwner([{ id: 'a/x', enabled: false }], ['a/x']);
    const b = makeOwner([{ id: 'b/y', enabled: true }], ['b/y']);
    service.register(a);
    service.register(b);
    expect(service.dirtyCount()).toBe(2);

    service.discardChanges();

    expect(a.discardSpy).toHaveBeenCalledTimes(1);
    expect(b.discardSpy).toHaveBeenCalledTimes(1);
    expect(service.dirtyCount()).toBe(0);
    expect(service.applyError()).toBeNull();
  });
});
