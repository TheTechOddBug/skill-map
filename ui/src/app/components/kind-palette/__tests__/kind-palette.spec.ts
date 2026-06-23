import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { KindPalette } from '../kind-palette';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { FilterStoreService } from '../../../../services/filter-store';
import { IssuePathsService, type IIssuePathsBySeverity } from '../../../../services/issue-paths';
import { KindRegistryService, type IKindRegistryEntry } from '../../../../services/kind-registry';
import type { INodeView } from '../../../../models/node';

interface IKindPaletteFixture {
  readonly fixture: ReturnType<typeof TestBed.createComponent<KindPalette>>;
}

/**
 * Stubs the services `KindPalette` depends on so tests can drive the
 * visible-rows logic without booting the full data layer. Each stub
 * mirrors only the surface the component actually reads:
 *
 *   - `CollectionLoaderService.nodes()` (the rendered branch) /
 *     `hasAnyFavorites()`.
 *   - `KindRegistryService.kinds()`.
 *   - `FilterStoreService.isKindActive` / `favoritesOnly` /
 *     `searchAffectsMap` / `apply`.
 *   - `IssuePathsService.bySeverity()` (the severity facet context).
 *
 * The TestBed override pattern (instead of constructor injection)
 * mirrors `demo-banner.spec.ts` and the other component specs in this
 * workspace.
 */
function makeFixture(opts: {
  nodes: INodeView[];
  kinds: Array<Pick<IKindRegistryEntry, 'name' | 'label'>>;
  /**
   * Optional whole-corpus lite list, typically BIGGER than the branch
   * (`nodes`). Exposed on the loader stub purely to prove the palette
   * IGNORES it: the counts come from the rendered branch, never the
   * corpus. Defaults to `nodes` when omitted.
   */
  corpusNodes?: INodeView[];
}): IKindPaletteFixture {
  const corpus = opts.corpusNodes ?? opts.nodes;
  const loader = {
    // The palette counts kinds over the RENDERED branch (`nodes()`), so
    // the count tracks the map rather than the whole scanned corpus. The
    // lite (corpus) list is exposed too, bigger than the branch in the
    // dedicated guard test, so a regression back to corpus-scoping fails.
    nodes: signal<INodeView[]>(opts.nodes).asReadonly(),
    liteNodes: signal(corpus.map((n) => ({ path: n.path, kind: n.kind }))).asReadonly(),
    liteNodeViews: signal<INodeView[]>(
      corpus.map(
        (n) =>
          ({ path: n.path, kind: n.kind, frontmatter: { name: '', description: '' } }) as INodeView,
      ),
    ).asReadonly(),
    hasAnyFavorites: () => opts.nodes.some((n) => n.isFavorite === true),
  };
  const issuePaths = {
    bySeverity: signal<IIssuePathsBySeverity>({
      errors: new Set<string>(),
      warns: new Set<string>(),
    }).asReadonly(),
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
    searchAffectsMap: signal(false).asReadonly(),
    toggleKind: () => undefined,
    setFavoritesOnly: () => undefined,
    // Passthrough: tests exercise presence/show-hide, not filtering.
    apply: (nodes: INodeView[]) => nodes,
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [KindPalette],
    providers: [
      { provide: CollectionLoaderService, useValue: loader },
      { provide: KindRegistryService, useValue: registry },
      { provide: FilterStoreService, useValue: filters },
      { provide: IssuePathsService, useValue: issuePaths },
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

  it('counts the RENDERED branch per kind, not the whole corpus (corpus/render split guard)', () => {
    // The branch (`nodes()`) renders 3 agents; the corpus (`liteNodes()`)
    // carries 9. The badge must show the BRANCH count (3): the palette
    // reads `loader.nodes()`, never the whole-corpus lite list. Guards the
    // regression where a folder selection / a >256 corpus left the palette
    // reporting scan totals instead of what is actually on the map. The
    // icon falls back to the kind label's first letter ("A"), so the
    // rendered text is "A3"; assert the digit rather than an exact match.
    const { fixture } = makeFixture({
      nodes: [makeNode('a.md', 'agent'), makeNode('b.md', 'agent'), makeNode('c.md', 'agent')],
      corpusNodes: Array.from({ length: 9 }, (_, i) => makeNode(`x${i}.md`, 'agent')),
      kinds: [{ name: 'agent', label: 'Agents' }],
    });
    const btn = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="kind-palette-agent"]',
    );
    expect(btn?.textContent).toContain('3'); // branch count
    expect(btn?.textContent).not.toContain('9'); // not the corpus count
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
