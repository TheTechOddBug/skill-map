import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { ProjectInfoService } from '../project-info';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';
import type { IActiveProviderApi } from '../../../models/api';

function makeService(port: Partial<IDataSourcePort>): ProjectInfoService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: DATA_SOURCE, useValue: port as IDataSourcePort }],
  });
  return TestBed.inject(ProjectInfoService);
}

const DRIFT = { added: ['claude'], removed: [], detected: ['claude'] } as const;

function driftedEnvelope(): IActiveProviderApi {
  return {
    activeProvider: 'opencode',
    detected: ['claude'],
    source: 'config',
    selectable: ['opencode'],
    markerDrift: { ...DRIFT, added: [...DRIFT.added], detected: [...DRIFT.detected] },
  };
}

describe('ProjectInfoService marker drift', () => {
  it('reloadActiveProvider stores the drift carried by the envelope', async () => {
    const svc = makeService({
      getActiveProvider: vi.fn().mockResolvedValue(driftedEnvelope()),
    });
    await svc.reloadActiveProvider();
    expect(svc.activeProvider()).toBe('opencode');
    expect(svc.markerDrift()).toEqual(DRIFT);
  });

  it('reloadActiveProvider clears the drift when the envelope reports none', async () => {
    const svc = makeService({
      getActiveProvider: vi
        .fn()
        .mockResolvedValue({ ...driftedEnvelope(), markerDrift: null }),
    });
    await svc.reloadActiveProvider();
    expect(svc.markerDrift()).toBeNull();
  });

  it('acceptMarkerDrift posts accept-markers and adopts the reconciled envelope', async () => {
    const acceptSpy = vi
      .fn()
      .mockResolvedValue({ ...driftedEnvelope(), markerDrift: null });
    const svc = makeService({
      getActiveProvider: vi.fn().mockResolvedValue(driftedEnvelope()),
      acceptActiveProviderMarkers: acceptSpy,
    });
    await svc.reloadActiveProvider();
    expect(svc.markerDrift()).toEqual(DRIFT);
    await svc.acceptMarkerDrift();
    expect(acceptSpy).toHaveBeenCalledTimes(1);
    expect(svc.markerDrift()).toBeNull();
  });

  it('acceptMarkerDrift rethrows and leaves the drift untouched on failure', async () => {
    const acceptSpy = vi.fn().mockRejectedValue(new Error('boom'));
    const svc = makeService({
      getActiveProvider: vi.fn().mockResolvedValue(driftedEnvelope()),
      acceptActiveProviderMarkers: acceptSpy,
    });
    await svc.reloadActiveProvider();
    await expect(svc.acceptMarkerDrift()).rejects.toThrow('boom');
    expect(svc.markerDrift()).toEqual(DRIFT);
  });
});
