import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { LinkKindPalette } from '../link-kind-palette';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { FilterStoreService } from '../../../../services/filter-store';
import { ProviderRegistryService } from '../../../../services/provider-registry';
import { ProjectInfoService } from '../../../services/project-info';
import type { TLinkKindApi } from '../../../../models/api';

/**
 * Stubs the four services `LinkKindPalette` reads so a test can drive the
 * lens-dependent `invokes` glyph without booting the data layer:
 *
 *   - `CollectionLoaderService.scan()` (the per-kind link counts that decide
 *     which buttons paint).
 *   - `FilterStoreService` (whitelist read + the toggle / set passthroughs).
 *   - `ProviderRegistryService.lookup(id)` (the active lens's `invocationSigil`).
 *   - `ProjectInfoService.activeProvider()` (which lens is active).
 *
 * The `invokes` button glyph follows the active lens's `invocationSigil`
 * (`$` on codex, `/` on claude / antigravity, `/` fallback otherwise), so the
 * toggle mirrors the lens's real source syntax. Mirrors the TestBed-override
 * pattern of `kind-palette.spec.ts`.
 */
function makeFixture(opts: {
  activeProvider: string | null;
  /** Provider id → its `invocationSigil`; absent ids resolve to no entry. */
  sigilByProvider?: Record<string, string | undefined>;
  linkKinds?: TLinkKindApi[];
}): ReturnType<typeof TestBed.createComponent<LinkKindPalette>> {
  const links = (opts.linkKinds ?? (['invokes'] as TLinkKindApi[])).map((kind) => ({ kind }));
  const loader = {
    scan: signal({ links }).asReadonly(),
  };
  const filters = {
    selectedLinkKinds: signal<TLinkKindApi[]>([]).asReadonly(),
    isLinkKindActive: (): boolean => false,
    setLinkKinds: (): void => undefined,
    toggleLinkKind: (): void => undefined,
  };
  const sigilMap = opts.sigilByProvider ?? {};
  const providerRegistry = {
    lookup: (id: string) =>
      id in sigilMap
        ? { id, label: id, color: '#000000', isLens: true, invocationSigil: sigilMap[id] }
        : undefined,
  };
  const projectInfo = {
    activeProvider: signal<string | null>(opts.activeProvider).asReadonly(),
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [LinkKindPalette],
    providers: [
      { provide: CollectionLoaderService, useValue: loader },
      { provide: FilterStoreService, useValue: filters },
      { provide: ProviderRegistryService, useValue: providerRegistry },
      { provide: ProjectInfoService, useValue: projectInfo },
    ],
  });
  const fixture = TestBed.createComponent(LinkKindPalette);
  fixture.detectChanges();
  return fixture;
}

/** Read the `invokes` button's rendered glyph + tooltip from the component. */
function invokesEntry(
  fixture: ReturnType<typeof TestBed.createComponent<LinkKindPalette>>,
): { text?: string; tooltip: string } {
  const entries = (
    fixture.componentInstance as unknown as {
      entries: () => readonly { kind: string; text?: string; tooltip: string }[];
    }
  ).entries();
  const entry = entries.find((e) => e.kind === 'invokes');
  if (!entry) throw new Error('invokes entry not painted');
  return entry;
}

describe('LinkKindPalette invocation glyph', () => {
  it('paints `$` for the codex lens (skills are `$skill`)', () => {
    const fixture = makeFixture({
      activeProvider: 'codex',
      sigilByProvider: { codex: '$' },
    });
    const entry = invokesEntry(fixture);
    expect(entry.text).toBe('$');
    expect(entry.tooltip).toContain('$skill-command');
    expect(entry.tooltip).not.toContain('/skill-command');

    const glyph = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="link-kind-palette-invokes"]',
    );
    expect(glyph?.textContent).toContain('$');
  });

  it('paints `/` for the claude lens', () => {
    const fixture = makeFixture({
      activeProvider: 'claude',
      sigilByProvider: { claude: '/' },
    });
    const entry = invokesEntry(fixture);
    expect(entry.text).toBe('/');
    expect(entry.tooltip).toContain('/skill-command');
  });

  it('falls back to `/` when the active lens declares no sigil', () => {
    // A lens whose registry entry carries no `invocationSigil` (or none
    // active at all) keeps the historical `/` glyph. Under such a lens
    // there are normally no `invokes` edges anyway, so this is a safety net.
    const fixture = makeFixture({
      activeProvider: 'agent-skills',
      sigilByProvider: { 'agent-skills': undefined },
    });
    expect(invokesEntry(fixture).text).toBe('/');

    const noLens = makeFixture({ activeProvider: null });
    expect(invokesEntry(noLens).text).toBe('/');
  });
});
