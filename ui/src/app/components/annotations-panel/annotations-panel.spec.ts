import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { AnnotationsPanel } from './annotations-panel';
import type { ISidecarOverlay } from '../../../models/node';

/**
 * `<sm-annotations-panel>` — catalog curation 2026-05-07. Each
 * sub-section renders only when its data is non-empty; the whole
 * pre-curation `Display` section is gone, plus the cherry-picked
 * fields the orchestrator dropped end-to-end (`type`, `author`,
 * `category`, `keywords`, `provides`, `created`, `updated`).
 */

function bootstrap(
  overlay?: ISidecarOverlay | null,
  knownPaths?: ReadonlySet<string>,
): HTMLElement {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(AnnotationsPanel);
  fixture.componentRef.setInput('overlay', overlay ?? null);
  if (knownPaths) fixture.componentRef.setInput('knownPaths', knownPaths);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('AnnotationsPanel — empty states', () => {
  it('shows the no-overlay empty state when overlay is null', () => {
    const dom = bootstrap(null);
    expect(dom.querySelector('[data-testid="annotations-panel-empty-overlay"]')).not.toBeNull();
  });

  it('shows the no-overlay empty state when present is false', () => {
    const dom = bootstrap({ present: false });
    expect(dom.querySelector('[data-testid="annotations-panel-empty-overlay"]')).not.toBeNull();
  });

  it('shows the empty-annotations state when present is true but annotations is empty', () => {
    const dom = bootstrap({ present: true, status: 'fresh', annotations: {} });
    expect(dom.querySelector('[data-testid="annotations-panel-empty-annotations"]')).not.toBeNull();
  });

  it('renders nothing for sections with no content', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: { version: 1 },
    });
    // Lifecycle has version, so it renders.
    expect(dom.querySelector('[data-testid="annotations-section-lifecycle"]')).not.toBeNull();
    // Other sections collapse.
    expect(dom.querySelector('[data-testid="annotations-section-supersession"]')).toBeNull();
    expect(dom.querySelector('[data-testid="annotations-section-provenance"]')).toBeNull();
    expect(dom.querySelector('[data-testid="annotations-section-taxonomy"]')).toBeNull();
    expect(dom.querySelector('[data-testid="annotations-section-docs"]')).toBeNull();
  });

  it('does NOT render a Display section (whole section dropped in curation)', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: { version: 1, stability: 'stable' },
    });
    expect(dom.querySelector('[data-testid="annotations-section-display"]')).toBeNull();
  });
});

describe('AnnotationsPanel — section rendering', () => {
  it('renders the version field as integer', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: { version: 7 },
    });
    const v = dom.querySelector('[data-testid="annotations-version"]');
    expect(v).not.toBeNull();
    expect(v!.textContent).toContain('7');
  });

  it('renders a stability tag', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: { stability: 'stable' },
    });
    expect(dom.querySelector('[data-testid="annotations-stability"]')).not.toBeNull();
  });

  it('renders supersedes/requires/related as clickable chips', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: {
        supersedes: ['old/agent.md'],
        requires: ['lib/foo.md'],
        related: ['notes/bar.md'],
      },
    });
    expect(dom.querySelector('[data-testid="annotations-section-supersession"]')).not.toBeNull();
    const chips = dom.querySelectorAll('p-chip');
    expect(chips.length).toBeGreaterThanOrEqual(3);
  });

  it('renders source as an external link with rel=noopener', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: { source: 'https://example.com/agent.md' },
    });
    const a = dom.querySelector('[data-testid="annotations-section-provenance"] a') as HTMLAnchorElement;
    expect(a).not.toBeNull();
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
  });

  it('renders authors as a chip list (multi-author shape)', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: { authors: ['alice', 'bob'] },
    });
    const sec = dom.querySelector('[data-testid="annotations-section-provenance"]');
    expect(sec).not.toBeNull();
    expect(sec!.querySelectorAll('p-chip').length).toBe(2);
  });

  it('renders the taxonomy section with tags', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: {
        tags: ['t1', 't2'],
      },
    });
    expect(dom.querySelector('[data-testid="annotations-section-taxonomy"]')).not.toBeNull();
  });

  it('renders the docs section with docsUrl link', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: { docsUrl: 'https://docs.example.com' },
    });
    expect(dom.querySelector('[data-testid="annotations-section-docs"]')).not.toBeNull();
  });
});

describe('AnnotationsPanel — broken-ref chips (Step 9.6 catalog curation)', () => {
  it('renders supersededBy as a broken chip when path is not in knownPaths', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(AnnotationsPanel);
    fixture.componentRef.setInput('overlay', {
      present: true,
      status: 'fresh',
      annotations: { supersededBy: 'old/agent.md' },
    } as ISidecarOverlay);
    fixture.componentRef.setInput('knownPaths', new Set<string>());
    fixture.detectChanges();
    const chip = fixture.nativeElement.querySelector(
      '[data-testid="annotations-section-supersession"] p-chip',
    ) as HTMLElement;
    expect(chip).not.toBeNull();
    // The styleClass binding produces a `chip--broken` class on the
    // host element via PrimeNG's host binding.
    expect(chip.className).toContain('chip--broken');
  });

  it('does NOT emit openPath for a broken-ref chip click', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(AnnotationsPanel);
    fixture.componentRef.setInput('overlay', {
      present: true,
      status: 'fresh',
      annotations: { supersedes: ['old/agent.md'] },
    } as ISidecarOverlay);
    fixture.componentRef.setInput('knownPaths', new Set<string>());
    fixture.detectChanges();
    const emissions: string[] = [];
    fixture.componentInstance.openPath.subscribe((p: string) => emissions.push(p));
    const chip = fixture.nativeElement.querySelector(
      '[data-testid="annotations-section-supersession"] p-chip',
    ) as HTMLElement;
    chip.click();
    expect(emissions).toEqual([]);
  });
});

describe('AnnotationsPanel — openPath emission', () => {
  it('emits openPath when a supersedes chip is clicked (path in knownPaths)', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(AnnotationsPanel);
    fixture.componentRef.setInput('overlay', {
      present: true,
      status: 'fresh',
      annotations: { supersedes: ['old/agent.md'] },
    } as ISidecarOverlay);
    fixture.componentRef.setInput('knownPaths', new Set(['old/agent.md']));
    fixture.detectChanges();
    const emissions: string[] = [];
    fixture.componentInstance.openPath.subscribe((p: string) => emissions.push(p));
    const chip = fixture.nativeElement.querySelector(
      '[data-testid="annotations-section-supersession"] p-chip',
    ) as HTMLElement;
    expect(chip).not.toBeNull();
    chip.click();
    expect(emissions).toEqual(['old/agent.md']);
  });

  it('emits openPath when knownPaths is null (legacy / no resolution)', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(AnnotationsPanel);
    fixture.componentRef.setInput('overlay', {
      present: true,
      status: 'fresh',
      annotations: { supersedes: ['old/agent.md'] },
    } as ISidecarOverlay);
    fixture.detectChanges();
    const emissions: string[] = [];
    fixture.componentInstance.openPath.subscribe((p: string) => emissions.push(p));
    const chip = fixture.nativeElement.querySelector(
      '[data-testid="annotations-section-supersession"] p-chip',
    ) as HTMLElement;
    chip.click();
    expect(emissions).toEqual(['old/agent.md']);
  });
});
