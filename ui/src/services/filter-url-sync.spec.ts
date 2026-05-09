import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Component } from '@angular/core';

import { FilterStoreService } from './filter-store';
import { FilterUrlSyncService } from './filter-url-sync';
import { KindRegistryService } from './kind-registry';

@Component({ template: '' })
class BlankPage {}

describe('FilterUrlSyncService', () => {
  let router: Router;
  let store: FilterStoreService;
  let registry: KindRegistryService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: BlankPage },
          { path: 'list', component: BlankPage },
        ]),
      ],
    });
    router = TestBed.inject(Router);
    store = TestBed.inject(FilterStoreService);
    registry = TestBed.inject(KindRegistryService);
    // Seed the registry so `parseKinds` recognises the test inputs. Step
    // 14.5.d opened the kind universe — without an ingest the registry
    // is empty and any deep-link kind would be rejected as unknown.
    registry.ingest({
      agent: { primaryProviderId: 'claude', providers: { claude: { label: 'Agents', color: '#3b82f6' } } },
      skill: { primaryProviderId: 'claude', providers: { claude: { label: 'Skills', color: '#10b981' } } },
    });
    await router.navigateByUrl('/');
  });

  afterEach(() => {
    store.reset();
  });

  it('seeds store from URL on construction', async () => {
    await router.navigateByUrl('/list?search=foo&kinds=agent,skill&hasIssues=true');
    TestBed.inject(FilterUrlSyncService);
    expect(store.searchText()).toBe('foo');
    expect(store.selectedKinds()).toEqual(['agent', 'skill']);
    expect(store.hasIssuesOnly()).toBe(true);
  });

  it('ignores unknown kinds when seeding from URL', async () => {
    await router.navigateByUrl('/list?kinds=agent,bogus,skill');
    TestBed.inject(FilterUrlSyncService);
    expect(store.selectedKinds()).toEqual(['agent', 'skill']);
  });

  it('pushes store changes to the URL', async () => {
    TestBed.inject(FilterUrlSyncService);
    await new Promise((r) => setTimeout(r, 0));

    store.setSearchText('hello');
    store.setKinds(['agent']);
    // Allow the effect + router navigation to flush.
    await new Promise((r) => setTimeout(r, 10));

    const url = router.url;
    expect(url).toContain('search=hello');
    expect(url).toContain('kinds=agent');
  });

  it('does not loop: a URL-driven seed does not trigger a redundant URL write', async () => {
    await router.navigateByUrl('/list?search=initial');
    TestBed.inject(FilterUrlSyncService);
    await new Promise((r) => setTimeout(r, 10));

    const before = router.url;
    // Re-set the same value: should be a no-op for the URL.
    store.setSearchText('initial');
    await new Promise((r) => setTimeout(r, 10));
    expect(router.url).toBe(before);
  });

  it('clears params when filters reset', async () => {
    TestBed.inject(FilterUrlSyncService);
    store.setSearchText('xyz');
    await new Promise((r) => setTimeout(r, 10));
    expect(router.url).toContain('search=xyz');

    store.reset();
    await new Promise((r) => setTimeout(r, 10));
    expect(router.url).not.toContain('search=');
  });

  it('seeds tag filter from `?tag` (union mode by default)', async () => {
    await router.navigateByUrl('/list?tag=urgent');
    TestBed.inject(FilterUrlSyncService);
    expect(store.tagFilter()).toEqual({ tag: 'urgent', source: 'any' });
  });

  it('seeds tag filter narrow source from `?tag-source`', async () => {
    await router.navigateByUrl('/list?tag=urgent&tag-source=user');
    TestBed.inject(FilterUrlSyncService);
    expect(store.tagFilter()).toEqual({ tag: 'urgent', source: 'user' });
  });

  it('falls back to union when `?tag-source` is unrecognised', async () => {
    await router.navigateByUrl('/list?tag=urgent&tag-source=bogus');
    TestBed.inject(FilterUrlSyncService);
    expect(store.tagFilter()).toEqual({ tag: 'urgent', source: 'any' });
  });

  it('ignores `?tag-source` when `?tag` is absent', async () => {
    await router.navigateByUrl('/list?tag-source=user');
    TestBed.inject(FilterUrlSyncService);
    expect(store.tagFilter()).toBeNull();
  });

  it('pushes a click-on-tag filter into the URL with both keys', async () => {
    TestBed.inject(FilterUrlSyncService);
    await new Promise((r) => setTimeout(r, 0));
    store.toggleTagFilter('urgent', 'author');
    await new Promise((r) => setTimeout(r, 10));
    expect(router.url).toContain('tag=urgent');
    expect(router.url).toContain('tag-source=author');
  });

  it('omits `tag-source` for the union mode (programmatic `setTagFilter`)', async () => {
    TestBed.inject(FilterUrlSyncService);
    await new Promise((r) => setTimeout(r, 0));
    store.setTagFilter({ tag: 'urgent', source: 'any' });
    await new Promise((r) => setTimeout(r, 10));
    expect(router.url).toContain('tag=urgent');
    expect(router.url).not.toContain('tag-source=');
  });

  it('clears `?tag` when the filter resets', async () => {
    await router.navigateByUrl('/list?tag=urgent&tag-source=user');
    TestBed.inject(FilterUrlSyncService);
    expect(store.tagFilter()).not.toBeNull();

    store.clearTagFilter();
    await new Promise((r) => setTimeout(r, 10));
    expect(router.url).not.toContain('tag=');
    expect(router.url).not.toContain('tag-source=');
  });
});
