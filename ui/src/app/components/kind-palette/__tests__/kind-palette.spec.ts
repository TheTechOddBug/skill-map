import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { KindPalette } from '../kind-palette';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { FilterStoreService } from '../../../../services/filter-store';
import { KindRegistryService, type IKindRegistryEntry } from '../../../../services/kind-registry';
import type { INodeView } from '../../../../models/node';

interface IKindPaletteFixture {
  readonly fixture: ReturnType<typeof TestBed.createComponent<KindPalette>>;
}

/**
 * Stubs the three services `KindPalette` depends on so tests can drive
 * the visible-rows logic without booting the full data layer. Each
 * stub mirrors only the surface the component actually reads:
 *
 *   - `CollectionLoaderService.nodes()` / `hasAnyFavorites()`.
 *   - `KindRegistryService.kinds()`.
 *   - `FilterStoreService.isKindActive` / `favoritesOnly`.
 *
 * The TestBed override pattern (instead of constructor injection)
 * mirrors `demo-banner.spec.ts` and the other component specs in this
 * workspace.
 */
function makeFixture(opts: {
  nodes: INodeView[];
  kinds: Array<Pick<IKindRegistryEntry, 'name' | 'label'>>;
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
  const filters = {
    isKindActive: () => true,
    favoritesOnly: signal(false).asReadonly(),
    toggleKind: () => undefined,
    setFavoritesOnly: () => undefined,
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
  return { fixture };
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
