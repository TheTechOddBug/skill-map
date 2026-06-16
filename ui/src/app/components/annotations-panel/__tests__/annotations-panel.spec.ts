import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { AnnotationsPanel } from '../annotations-panel';
import type { ISidecarOverlay } from '../../../../models/node';

/**
 * `<sm-annotations-panel>`, catalog curation 2026-05-07. Each
 * sub-section renders only when its data is non-empty; the whole
 * pre-curation `Display` section is gone, plus the cherry-picked
 * fields the orchestrator dropped end-to-end (`type`, `author`,
 * `category`, `keywords`, `provides`, `created`, `updated`).
 */

function bootstrap(overlay?: ISidecarOverlay | null): HTMLElement {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(AnnotationsPanel);
  fixture.componentRef.setInput('overlay', overlay ?? null);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('AnnotationsPanel, empty states', () => {
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
      annotations: { authors: ['crystian'] },
    });
    // Provenance has an author, so it renders.
    expect(dom.querySelector('[data-testid="annotations-section-provenance"]')).not.toBeNull();
    // Other sections collapse.
    expect(dom.querySelector('[data-testid="annotations-section-docs"]')).toBeNull();
  });

  it('does NOT render a Display section (whole section dropped in curation)', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: { authors: ['crystian'] },
    });
    expect(dom.querySelector('[data-testid="annotations-section-display"]')).toBeNull();
  });

  it('does NOT render a Lifecycle section (version + stability live in the header)', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: { version: 7, stability: 'stable' },
    });
    expect(dom.querySelector('[data-testid="annotations-section-lifecycle"]')).toBeNull();
    expect(dom.querySelector('[data-testid="annotations-version"]')).toBeNull();
    expect(dom.querySelector('[data-testid="annotations-stability"]')).toBeNull();
    // version / stability are the only annotations and neither renders now,
    // so the panel falls back to its empty-annotations state.
    expect(
      dom.querySelector('[data-testid="annotations-panel-empty-annotations"]'),
    ).not.toBeNull();
  });
});

describe('AnnotationsPanel, section rendering', () => {
  it('renders source as an external link with rel=noopener', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: { source: 'https://example.com/agent.md' },
    });
    const a = dom.querySelector('[data-testid="annotations-section-repository"] a') as HTMLAnchorElement;
    expect(a).not.toBeNull();
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
  });

  it('renders authors as inline meta tags (multi-author shape)', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: { authors: ['alice', 'bob'] },
    });
    const sec = dom.querySelector('[data-testid="annotations-section-provenance"]');
    expect(sec).not.toBeNull();
    // Authors now render as `<span class="sm-block__meta">` rows with a
    // pi-user icon (mirrors how license / source / sourceVersion render in
    // the same row). Locked to the count so multi-author shapes stay
    // visually distinct.
    const authors = sec!.querySelectorAll('.sm-block__meta');
    expect(authors.length).toBeGreaterThanOrEqual(2);
    expect(sec!.textContent).toContain('alice');
    expect(sec!.textContent).toContain('bob');
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

// Audit `app-hacker` L1, source/docsUrl narrowing to http(s)://.
//
// Annotation values are author-controlled (or curated by a plugin), so
// the component narrows them before binding to `[href]`. Angular's
// DomSanitizer already blocks `javascript:` in URL context; the
// narrower allowlist also rejects `data:`, `blob:`, `file:`, and
// custom schemes a stale sidecar might smuggle in.
describe('AnnotationsPanel, audit L1, URL scheme allowlist', () => {
  function sourceHref(dom: HTMLElement): string | null {
    const section = dom.querySelector('[data-testid="annotations-section-repository"]');
    if (!section) return null;
    const anchor = section.querySelector('a[target="_blank"]');
    return anchor?.getAttribute('href') ?? null;
  }

  function docsHref(dom: HTMLElement): string | null {
    const section = dom.querySelector('[data-testid="annotations-section-docs"]');
    if (!section) return null;
    const anchor = section.querySelector('a[target="_blank"]');
    return anchor?.getAttribute('href') ?? null;
  }

  it('accepts an https:// source', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: { source: 'https://example.com/file.md' },
    });
    expect(sourceHref(dom)).toBe('https://example.com/file.md');
  });

  it('accepts a plain http:// source', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: { source: 'http://example.com/file.md' },
    });
    expect(sourceHref(dom)).toBe('http://example.com/file.md');
  });

  for (const bad of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'blob:http://example.com/abc',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    'about:blank',
    'not-a-url',
    'mailto:a@b.c',
  ]) {
    it(`rejects ${JSON.stringify(bad)} as source (anchor hidden)`, () => {
      const dom = bootstrap({
        present: true,
        status: 'fresh',
        annotations: { source: bad },
      });
      expect(sourceHref(dom)).toBeNull();
    });
  }

  it('rejects a non-string source (number)', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: { source: 42 },
    });
    expect(sourceHref(dom)).toBeNull();
  });

  it('emits rel="noopener noreferrer" on the source anchor', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: { source: 'https://example.com/x' },
    });
    const anchor = dom
      .querySelector('[data-testid="annotations-section-repository"]')
      ?.querySelector('a[target="_blank"]') as HTMLAnchorElement | null;
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('accepts an https:// docsUrl', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: { docsUrl: 'https://docs.example.com/x' },
    });
    expect(docsHref(dom)).toBe('https://docs.example.com/x');
  });

  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'gopher://example.com',
  ]) {
    it(`rejects ${JSON.stringify(bad)} as docsUrl (anchor hidden)`, () => {
      const dom = bootstrap({
        present: true,
        status: 'fresh',
        annotations: { docsUrl: bad },
      });
      expect(docsHref(dom)).toBeNull();
    });
  }

  it('emits rel="noopener noreferrer" on the docsUrl anchor', () => {
    const dom = bootstrap({
      present: true,
      status: 'fresh',
      annotations: { docsUrl: 'https://docs.example.com/x' },
    });
    const anchor = dom
      .querySelector('[data-testid="annotations-section-docs"]')
      ?.querySelector('a[target="_blank"]') as HTMLAnchorElement | null;
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
