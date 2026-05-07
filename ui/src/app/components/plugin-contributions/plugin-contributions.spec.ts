import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { PluginContributions } from './plugin-contributions';

/**
 * `<sm-plugin-contributions>` — catalog curation 2026-05-07. Surfaces
 * sidecar root keys outside the four reserved blocks. Rendering
 * differentiates registered (with schema descriptions as tooltips)
 * vs unregistered (muted "unregistered" badge) namespaces, and
 * inlines registered root contributions with a `from plugin: X`
 * badge.
 */

function bootstrap(sidecarRoot: Record<string, unknown> | null): {
  dom: HTMLElement;
  fixture: ReturnType<typeof TestBed.createComponent<PluginContributions>>;
  http: HttpTestingController;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(PluginContributions);
  fixture.componentRef.setInput('sidecarRoot', sidecarRoot);
  // Initial render before catalog fetch resolves.
  fixture.detectChanges();
  return { dom: fixture.nativeElement as HTMLElement, fixture, http };
}

async function flushCatalog(
  http: HttpTestingController,
  items: Array<{
    pluginId: string;
    key: string;
    location: 'namespaced' | 'root';
    ownership: 'exclusive' | 'shared';
    schema: Record<string, unknown>;
  }>,
): Promise<void> {
  const req = http.expectOne('/api/annotations/registered');
  req.flush({
    schemaVersion: '1',
    kind: 'annotations.registered',
    items,
    counts: { total: items.length },
  });
  // The handler awaits `firstValueFrom`; drain a couple of microtasks
  // so `this.catalog.set(...)` runs before the test inspects the DOM.
  await Promise.resolve();
  await Promise.resolve();
}

describe('PluginContributions — empty', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('renders the empty state when no sidecar root', async () => {
    const fixture = TestBed.createComponent(PluginContributions);
    fixture.componentRef.setInput('sidecarRoot', null);
    fixture.detectChanges();
    await flushCatalog(http, []);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="plugin-contributions-empty"]'),
    ).not.toBeNull();
  });

  it('renders the empty state when sidecar root has only reserved blocks', async () => {
    const fixture = TestBed.createComponent(PluginContributions);
    fixture.componentRef.setInput('sidecarRoot', {
      for: { path: 'a.md', bodyHash: '0', frontmatterHash: '0' },
      annotations: { version: 1 },
      audit: { lastBumpedAt: '2026-05-01T00:00:00Z' },
      settings: {},
    });
    fixture.detectChanges();
    await flushCatalog(http, []);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="plugin-contributions-empty"]'),
    ).not.toBeNull();
  });
});

describe('PluginContributions — registered vs unregistered', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('renders a known namespace WITHOUT the unregistered badge', async () => {
    const fixture = TestBed.createComponent(PluginContributions);
    fixture.componentRef.setInput('sidecarRoot', {
      'foo-plugin': { key1: 'v1' },
    });
    fixture.detectChanges();
    await flushCatalog(http, [
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
    await flushCatalog(http, []);
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
    await flushCatalog(http, [
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
    const req = http.expectOne('/api/annotations/registered');
    req.error(new ProgressEvent('error'), { status: 0, statusText: 'transport' });
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="plugin-contributions-unregistered-badge"]'),
    ).not.toBeNull();
  });
});
