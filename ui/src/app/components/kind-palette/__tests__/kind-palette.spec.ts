import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';

import { KindPalette } from '../kind-palette';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { FilterStoreService } from '../../../../services/filter-store';
import { KindRegistryService, type IKindRegistryEntry } from '../../../../services/kind-registry';
import type { INodeView } from '../../../../models/node';

interface IKindPaletteFixture {
  readonly fixture: ReturnType<typeof TestBed.createComponent<KindPalette>>;
  readonly searchText: WritableSignal<string>;
  readonly setSearchTextSpy: ReturnType<typeof vi.fn>;
}

/**
 * Stubs the three services `KindPalette` depends on so tests can drive
 * the visible-rows logic without booting the full data layer. Each
 * stub mirrors only the surface the component actually reads:
 *
 *   - `CollectionLoaderService.nodes()` / `hasAnyFavorites()`.
 *   - `KindRegistryService.kinds()`.
 *   - `FilterStoreService.isKindActive` / `favoritesOnly` /
 *     `searchText`.
 *
 * `searchText` is exposed as a writable signal on the returned fixture
 * so the search-affordance tests can drive the store value imperatively
 * without reaching into the real `FilterStoreService` implementation.
 *
 * The TestBed override pattern (instead of constructor injection)
 * mirrors `demo-banner.spec.ts` and the other component specs in this
 * workspace.
 */
function makeFixture(opts: {
  nodes: INodeView[];
  kinds: Array<Pick<IKindRegistryEntry, 'name' | 'label'>>;
  initialSearchText?: string;
}): IKindPaletteFixture {
  const loader = {
    nodes: signal<INodeView[]>(opts.nodes).asReadonly(),
    hasAnyFavorites: () => opts.nodes.some((n) => n.isFavorite === true),
  };
  const kinds: IKindRegistryEntry[] = opts.kinds.map((k) => ({
    name: k.name,
    label: k.label,
    primaryProviderId: 'core',
    providers: {},
    color: '#000000',
  }));
  const kindsByName = new Map(kinds.map((k) => [k.name, k]));
  const registry = {
    kinds: signal<readonly IKindRegistryEntry[]>(kinds).asReadonly(),
    lookup: (name: string) => kindsByName.get(name),
    labelOf: (name: string) => kindsByName.get(name)?.label ?? name,
    colorOf: (_name: string) => '#000000',
    iconOf: (_name: string) => undefined,
    emojiOf: (_name: string) => undefined,
  };
  const searchText = signal<string>(opts.initialSearchText ?? '');
  const setSearchTextSpy = vi.fn((value: string) => searchText.set(value));
  const filters = {
    isKindActive: () => true,
    favoritesOnly: signal(false).asReadonly(),
    searchText: searchText.asReadonly(),
    toggleKind: () => undefined,
    setFavoritesOnly: () => undefined,
    setSearchText: setSearchTextSpy,
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [KindPalette],
    providers: [
      { provide: CollectionLoaderService, useValue: loader },
      { provide: KindRegistryService, useValue: registry },
      { provide: FilterStoreService, useValue: filters },
    ],
  });
  const fixture = TestBed.createComponent(KindPalette);
  fixture.detectChanges();
  return { fixture, searchText, setSearchTextSpy };
}

function makeNode(path: string, kind: string): INodeView {
  // Minimal shape; the palette reads only `kind` and `isFavorite`. The
  // cast routes through `unknown` because `INodeView.kind` is the
  // discriminated `TNodeKind` and tests want to exercise arbitrary
  // provider-declared kind names (mcp, command, etc.) without locking
  // the test fixture to the kernel's literal union.
  return {
    path,
    kind,
    provider: 'core',
    frontmatter: { name: path },
  } as unknown as INodeView;
}

describe('KindPalette', () => {
  it('renders one button per kind that has at least one node', () => {
    const { fixture } = makeFixture({
      nodes: [
        makeNode('a.md', 'agent'),
        makeNode('b.md', 'agent'),
        makeNode('c.md', 'skill'),
      ],
      kinds: [
        { name: 'agent', label: 'Agents' },
        { name: 'skill', label: 'Skills' },
      ],
    });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="kind-palette-agent"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="kind-palette-skill"]')).not.toBeNull();
  });

  it('hides kinds whose count is zero', () => {
    // `command` and `mcp` are registered in the catalog but no node in
    // the loaded set carries those kinds; the palette filters them
    // out so the operator does not see a row that is permanently `0`
    // and whose toggle would be a no-op.
    const { fixture } = makeFixture({
      nodes: [makeNode('a.md', 'agent')],
      kinds: [
        { name: 'agent', label: 'Agents' },
        { name: 'command', label: 'Commands' },
        { name: 'mcp', label: 'MCP servers' },
      ],
    });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="kind-palette-agent"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="kind-palette-command"]')).toBeNull();
    expect(root.querySelector('[data-testid="kind-palette-mcp"]')).toBeNull();
  });

  it('renders an empty palette when no node matches any registered kind', () => {
    // Empty scan or a scan whose nodes only carry kinds outside the
    // registry. Either way: zero buttons (favourites stays gated by
    // hasAnyFavorites and is independent).
    const { fixture } = makeFixture({
      nodes: [],
      kinds: [
        { name: 'agent', label: 'Agents' },
        { name: 'skill', label: 'Skills' },
      ],
    });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('[data-testid^="kind-palette-"][data-testid$="-agent"]').length).toBe(0);
    expect(root.querySelectorAll('[data-testid^="kind-palette-"][data-testid$="-skill"]').length).toBe(0);
  });
});

/**
 * Inline search affordance added in `aca5f17c`. The toggle pill sits
 * above the kind buttons and expands horizontally into an `<input>`
 * that mirrors `FilterStoreService.searchText`. The behaviour matrix:
 *
 *   - `toggleSearch` flips `searchExpanded` (and the host class).
 *   - `onSearchInput` forwards to the store via `setSearchText`.
 *   - `onSearchKeydown` collapses on `Escape` and calls
 *     `stopPropagation` so the keystroke does not also reach any
 *     parent keyboard shortcut. Non-Escape keys are pass-through.
 *   - `onSearchBlur` collapses iff the trimmed search text is empty;
 *     a non-empty query keeps the pill expanded so the operator sees
 *     what they filtered by.
 *   - `searchActive` reflects the trimmed length of the store signal,
 *     whitespace-only counts as inactive.
 *   - The autofocus effect focuses the input the microtask after
 *     `searchExpanded` flips to true.
 */
describe('KindPalette, inline search', () => {
  function makeMinimalFixture(initialSearchText = ''): IKindPaletteFixture {
    // Search behaviour does not depend on nodes/kinds, the toggle row
    // renders unconditionally above the palette. A single kind keeps
    // the template happy without bloating the setup.
    return makeFixture({
      nodes: [makeNode('a.md', 'agent')],
      kinds: [{ name: 'agent', label: 'Agents' }],
      initialSearchText,
    });
  }

  function instance(fx: IKindPaletteFixture): {
    toggleSearch: () => void;
    onSearchInput: (value: string) => void;
    onSearchKeydown: (event: KeyboardEvent) => void;
    onSearchBlur: () => void;
    searchExpanded: () => boolean;
    searchActive: () => boolean;
  } {
    // `toggleSearch` etc. are public methods, but `searchExpanded` and
    // `searchActive` are `protected`. Cast through `unknown` to read
    // them without exposing them publicly on the component contract.
    return fx.fixture.componentInstance as unknown as {
      toggleSearch: () => void;
      onSearchInput: (value: string) => void;
      onSearchKeydown: (event: KeyboardEvent) => void;
      onSearchBlur: () => void;
      searchExpanded: () => boolean;
      searchActive: () => boolean;
    };
  }

  it('starts collapsed', () => {
    const fx = makeMinimalFixture();
    expect(instance(fx).searchExpanded()).toBe(false);
    const host = fx.fixture.nativeElement as HTMLElement;
    const search = host.querySelector('[data-testid="kind-palette-search"]')!;
    expect(search.classList.contains('kind-palette-search--expanded')).toBe(false);
  });

  it('toggleSearch expands then collapses', () => {
    const fx = makeMinimalFixture();
    const c = instance(fx);
    c.toggleSearch();
    expect(c.searchExpanded()).toBe(true);
    c.toggleSearch();
    expect(c.searchExpanded()).toBe(false);
  });

  it('reflects expanded state on the host element class and aria-expanded', () => {
    const fx = makeMinimalFixture();
    instance(fx).toggleSearch();
    fx.fixture.detectChanges();
    const host = fx.fixture.nativeElement as HTMLElement;
    const search = host.querySelector('[data-testid="kind-palette-search"]')!;
    expect(search.classList.contains('kind-palette-search--expanded')).toBe(true);
    const toggleBtn = host.querySelector('[data-testid="kind-palette-search-toggle"]')!;
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
  });

  it('onSearchInput forwards the value to FilterStoreService.setSearchText', () => {
    const fx = makeMinimalFixture();
    instance(fx).onSearchInput('agent');
    expect(fx.setSearchTextSpy).toHaveBeenCalledWith('agent');
    expect(fx.searchText()).toBe('agent');
  });

  it('Escape keydown collapses the pill and stops propagation', () => {
    const fx = makeMinimalFixture();
    const c = instance(fx);
    c.toggleSearch();
    expect(c.searchExpanded()).toBe(true);
    const stopPropagation = vi.fn();
    c.onSearchKeydown({ key: 'Escape', stopPropagation } as unknown as KeyboardEvent);
    expect(c.searchExpanded()).toBe(false);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('non-Escape keydown does not collapse and does not stop propagation', () => {
    const fx = makeMinimalFixture();
    const c = instance(fx);
    c.toggleSearch();
    const stopPropagation = vi.fn();
    c.onSearchKeydown({ key: 'a', stopPropagation } as unknown as KeyboardEvent);
    expect(c.searchExpanded()).toBe(true);
    expect(stopPropagation).not.toHaveBeenCalled();
  });

  it('blur with empty search collapses the pill', () => {
    const fx = makeMinimalFixture();
    const c = instance(fx);
    c.toggleSearch();
    expect(c.searchExpanded()).toBe(true);
    c.onSearchBlur();
    expect(c.searchExpanded()).toBe(false);
  });

  it('blur with non-empty search keeps the pill expanded', () => {
    const fx = makeMinimalFixture('agent');
    const c = instance(fx);
    c.toggleSearch();
    expect(c.searchExpanded()).toBe(true);
    c.onSearchBlur();
    expect(c.searchExpanded()).toBe(true);
  });

  it('blur with whitespace-only search collapses (whitespace is not active)', () => {
    // `searchActive` trims before measuring length, so a query of
    // `'   '` is treated as empty for the auto-collapse decision.
    const fx = makeMinimalFixture('   ');
    const c = instance(fx);
    c.toggleSearch();
    c.onSearchBlur();
    expect(c.searchExpanded()).toBe(false);
  });

  it('searchActive is true iff trimmed search text is non-empty', () => {
    const fx = makeMinimalFixture('');
    const c = instance(fx);
    expect(c.searchActive()).toBe(false);
    fx.searchText.set('   ');
    expect(c.searchActive()).toBe(false);
    fx.searchText.set('agent');
    expect(c.searchActive()).toBe(true);
  });

  it('host element gets the active class when searchText is non-empty', () => {
    const fx = makeMinimalFixture('agent');
    fx.fixture.detectChanges();
    const host = fx.fixture.nativeElement as HTMLElement;
    const search = host.querySelector('[data-testid="kind-palette-search"]')!;
    expect(search.classList.contains('kind-palette-search--active')).toBe(true);
  });

  it('autofocus effect focuses the input after expanding', async () => {
    const fx = makeMinimalFixture();
    const host = fx.fixture.nativeElement as HTMLElement;
    const input = host.querySelector('[data-testid="kind-palette-search-input"]') as HTMLInputElement;
    const focusSpy = vi.spyOn(input, 'focus');
    instance(fx).toggleSearch();
    fx.fixture.detectChanges();
    // The effect schedules the focus via `queueMicrotask`, await one
    // microtask drain so the focus call lands before we assert.
    await Promise.resolve();
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });
});
