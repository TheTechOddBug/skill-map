import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { ActionDispatchService } from '../action-dispatch';
import {
  DATA_SOURCE,
  DataSourceError,
  type IDataSourcePort,
} from '../data-source/data-source.port';

/**
 * ActionDispatchService, generic kernel-Action dispatch + the `.sm`
 * write-consent handshake. The key behaviours: a clean POST on success,
 * the 412 `confirm-required` gate opening the consent dialog, and the
 * retry carrying `{ confirm }` (one-shot) vs `{ confirm, always }`
 * (persist) per the user's checkbox choice. A decline abandons silently.
 */

type IStubDataSource = Pick<IDataSourcePort, 'dispatchAction'> & {
  dispatchAction: ReturnType<typeof vi.fn>;
};

function makeStub(): IStubDataSource {
  return {
    dispatchAction: vi.fn().mockResolvedValue({
      schemaVersion: '1',
      kind: 'action.applied',
      value: { actionId: 'core/node-bump', nodePath: 'a.md' },
      elapsedMs: 1,
    }),
  };
}

function setup(stub: IStubDataSource): ActionDispatchService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: stub },
    ],
  });
  return TestBed.inject(ActionDispatchService);
}

const NODE = 'agents/architect.md';

describe('ActionDispatchService, happy path', () => {
  it('POSTs the action with the node path and input, no consent flags', async () => {
    const stub = makeStub();
    const svc = setup(stub);
    await svc.dispatch('core/node-bump', NODE, { foo: 1 });
    expect(stub.dispatchAction).toHaveBeenCalledTimes(1);
    expect(stub.dispatchAction).toHaveBeenCalledWith('core/node-bump', NODE, { input: { foo: 1 } });
    expect(svc.error()).toBeNull();
    expect(svc.consentOpen()).toBe(false);
  });

  it('toggles inFlight around the dispatch', async () => {
    const stub = makeStub();
    let resolve!: () => void;
    stub.dispatchAction.mockImplementation(
      () => new Promise<void>((r) => { resolve = () => r(); }),
    );
    const svc = setup(stub);
    const p = svc.dispatch('core/node-bump', NODE);
    expect(svc.inFlight()).toBe(true);
    resolve();
    await p;
    expect(svc.inFlight()).toBe(false);
  });
});

describe('ActionDispatchService, consent gate', () => {
  function confirmRequired(): DataSourceError {
    return new DataSourceError('confirm-required', 'needs consent', { key: 'allowEditSmFiles' });
  }

  it('opens the consent dialog on a 412 confirm-required for allowEditSmFiles', async () => {
    const stub = makeStub();
    stub.dispatchAction.mockRejectedValueOnce(confirmRequired());
    const svc = setup(stub);
    await svc.dispatch('core/node-bump', NODE);
    expect(svc.consentOpen()).toBe(true);
    expect(svc.error()).toBeNull(); // no error banner while the dialog is up
    expect(stub.dispatchAction).toHaveBeenCalledTimes(1);
  });

  it('retries with { confirm: true } when the user accepts without "always"', async () => {
    const stub = makeStub();
    stub.dispatchAction.mockRejectedValueOnce(confirmRequired());
    const svc = setup(stub);
    await svc.dispatch('core/node-bump', NODE, { foo: 1 });
    expect(svc.consentOpen()).toBe(true);

    svc.resolveConsent({ accepted: true, always: false });
    await Promise.resolve();
    await Promise.resolve();

    expect(svc.consentOpen()).toBe(false);
    expect(stub.dispatchAction).toHaveBeenCalledTimes(2);
    expect(stub.dispatchAction).toHaveBeenNthCalledWith(2, 'core/node-bump', NODE, {
      input: { foo: 1 },
      confirm: true,
    });
    expect(svc.error()).toBeNull();
  });

  it('retries with { confirm: true, always: true } when the user ticks "always"', async () => {
    const stub = makeStub();
    stub.dispatchAction.mockRejectedValueOnce(confirmRequired());
    const svc = setup(stub);
    await svc.dispatch('core/node-bump', NODE);
    expect(svc.consentOpen()).toBe(true);

    svc.resolveConsent({ accepted: true, always: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(stub.dispatchAction).toHaveBeenCalledTimes(2);
    expect(stub.dispatchAction).toHaveBeenNthCalledWith(2, 'core/node-bump', NODE, {
      input: undefined,
      confirm: true,
      always: true,
    });
  });

  it('abandons silently when the user declines (no retry, no error)', async () => {
    const stub = makeStub();
    stub.dispatchAction.mockRejectedValueOnce(confirmRequired());
    const svc = setup(stub);
    await svc.dispatch('core/node-bump', NODE);
    expect(svc.consentOpen()).toBe(true);

    svc.resolveConsent({ accepted: false, always: false });
    await Promise.resolve();

    expect(svc.consentOpen()).toBe(false);
    expect(stub.dispatchAction).toHaveBeenCalledTimes(1);
    expect(svc.error()).toBeNull();
  });

  it('does NOT open the dialog for a confirm-required with an unknown details.key', async () => {
    const stub = makeStub();
    stub.dispatchAction.mockRejectedValueOnce(
      new DataSourceError('confirm-required', 'needs consent', { key: 'someOtherKey' }),
    );
    const svc = setup(stub);
    await svc.dispatch('core/node-bump', NODE);
    expect(svc.consentOpen()).toBe(false);
    expect(svc.error()).not.toBeNull();
  });
});

describe('ActionDispatchService, error surfacing', () => {
  it('formats a sidecar-fresh error', async () => {
    const stub = makeStub();
    stub.dispatchAction.mockRejectedValueOnce(new DataSourceError('sidecar-fresh', 'fresh'));
    const svc = setup(stub);
    await svc.dispatch('core/node-bump', NODE);
    expect(svc.error()).toMatch(/fresh/i);
  });

  it('formats a not-found error', async () => {
    const stub = makeStub();
    stub.dispatchAction.mockRejectedValueOnce(new DataSourceError('not-found', 'gone'));
    const svc = setup(stub);
    await svc.dispatch('core/node-bump', NODE);
    expect(svc.error()).toMatch(/not found/i);
  });

  it('formats a generic error with the original message', async () => {
    const stub = makeStub();
    stub.dispatchAction.mockRejectedValueOnce(new DataSourceError('internal', 'boom'));
    const svc = setup(stub);
    await svc.dispatch('core/node-bump', NODE);
    expect(svc.error()).toContain('boom');
  });

  it('dismissError clears the banner', async () => {
    const stub = makeStub();
    stub.dispatchAction.mockRejectedValueOnce(new DataSourceError('internal', 'boom'));
    const svc = setup(stub);
    await svc.dispatch('core/node-bump', NODE);
    expect(svc.error()).not.toBeNull();
    svc.dismissError();
    expect(svc.error()).toBeNull();
  });
});
