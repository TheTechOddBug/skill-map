import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { EMPTY } from 'rxjs';

import { PluginContributions } from './plugin-contributions';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';
import type { IRegisteredAnnotationKeyApi } from '../../../models/api';

/**
 * `<sm-plugin-contributions>` — catalog curation 2026-05-07. Surfaces
 * sidecar root keys outside the four reserved blocks. Rendering
 * differentiates registered (with schema descriptions as tooltips)
 * vs unregistered (muted "unregistered" badge) namespaces, and
 * inlines registered root contributions with a `from plugin: X`
 * badge.
 */

interface IStubHandle {
  resolve: (items: readonly IRegisteredAnnotationKeyApi[]) => void;
  reject: (err?: unknown) => void;
}

function stubDataSource(): { port: IDataSourcePort; handle: IStubHandle } {
  let resolveFn: (items: readonly IRegisteredAnnotationKeyApi[]) => void = () => {};
  let rejectFn: (err?: unknown) => void = () => {};
  const promise = new Promise<readonly IRegisteredAnnotationKeyApi[]>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  const port = {
    getRegisteredAnnotations: () => promise,
    events: () => EMPTY,
  } as unknown as IDataSourcePort;
  return { port, handle: { resolve: resolveFn, reject: rejectFn } };
}

async function flushCatalog(
  handle: IStubHandle,
  items: readonly IRegisteredAnnotationKeyApi[],
): Promise<void> {
  handle.resolve(items);
  // The handler awaits the promise; drain a couple of microtasks so
  // `this.catalog.set(...)` runs before the test inspects the DOM.
  await Promise.resolve();
  await Promise.resolve();
}

describe('PluginContributions — empty', () => {
  let handle: IStubHandle;

  beforeEach(() => {
    TestBed.resetTestingModule();
    const stub = stubDataSource();
    handle = stub.handle;
    TestBed.configureTestingModule({
      providers: [{ provide: DATA_SOURCE, useValue: stub.port }],
    });
  });

  afterEach(() => {
    // Drain any pending promise so the test runner doesn't see
    // unhandled rejections from the still-pending catalog fetch.
    handle.resolve([]);
  });

  it('renders the empty state when no sidecar root', async () => {
    const fixture = TestBed.createComponent(PluginContributions);
    fixture.componentRef.setInput('sidecarRoot', null);
    fixture.detectChanges();
    await flushCatalog(handle, []);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="plugin-contributions-empty"]'),
    ).not.toBeNull();
  });

  it('renders the empty state when sidecar root has only reserved blocks', async () => {
    const fixture = TestBed.createComponent(PluginContributions);
    fixture.componentRef.setInput('sidecarRoot', {
      identity: { path: 'a.md', bodyHash: '0', frontmatterHash: '0' },
      annotations: { version: 1 },
      audit: { lastBumpedAt: '2026-05-01T00:00:00Z' },
      settings: {},
    });
    fixture.detectChanges();
    await flushCatalog(handle, []);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="plugin-contributions-empty"]'),
    ).not.toBeNull();
  });
});

describe('PluginContributions — registered vs unregistered', () => {
  let handle: IStubHandle;

  beforeEach(() => {
    TestBed.resetTestingModule();
    const stub = stubDataSource();
    handle = stub.handle;
    TestBed.configureTestingModule({
      providers: [{ provide: DATA_SOURCE, useValue: stub.port }],
    });
  });

  afterEach(() => {
    handle.resolve([]);
  });

  it('renders a known namespace WITHOUT the unregistered badge', async () => {
    const fixture = TestBed.createComponent(PluginContributions);
    fixture.componentRef.setInput('sidecarRoot', {
      'foo-plugin': { key1: 'v1' },
    });
    fixture.detectChanges();
    await flushCatalog(handle, [
      {
        pluginId: 'foo-plugin',
        key: 'key1',
        location: 'namespaced',
        ownership: 'shared',
        schema: { description: 'Foo description' },
      },
    ]);
    fixture.detectChanges();
    const ns = fixture.nativeElement.querySelector(
      '[data-testid="plugin-contributions-ns-foo-plugin"]',
    );
    expect(ns).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="plugin-contributions-unregistered-badge"]'),
    ).toBeNull();
  });

  it('renders an unknown namespace WITH the unregistered badge', async () => {
    const fixture = TestBed.createComponent(PluginContributions);
    fixture.componentRef.setInput('sidecarRoot', {
      'mystery-plugin': { weird: 42 },
    });
    fixture.detectChanges();
    await flushCatalog(handle, []);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="plugin-contributions-ns-mystery-plugin"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="plugin-contributions-unregistered-badge"]'),
    ).not.toBeNull();
  });

  it('routes registered root keys into the rootContributions list (NOT the namespace list)', async () => {
    const fixture = TestBed.createComponent(PluginContributions);
    fixture.componentRef.setInput('sidecarRoot', {
      myRootKey: { foo: 'bar' },
    });
    fixture.detectChanges();
    await flushCatalog(handle, [
      {
        pluginId: 'root-plugin',
        key: 'myRootKey',
        location: 'root',
        ownership: 'exclusive',
        schema: { description: 'Root key' },
      },
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="plugin-contributions-roots"]')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="plugin-contributions-ns-myRootKey"]'),
    ).toBeNull();
  });

  it('falls back to "all unregistered" when the catalog fetch fails', async () => {
    const fixture = TestBed.createComponent(PluginContributions);
    fixture.componentRef.setInput('sidecarRoot', {
      'some-plugin': { x: 1 },
    });
    fixture.detectChanges();
    handle.reject(new Error('transport'));
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="plugin-contributions-unregistered-badge"]'),
    ).not.toBeNull();
  });
});
