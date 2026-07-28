import { describe, expect, it } from 'vitest';
import { Component, computed, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';

import { MarkdownImagesDirective } from '../markdown-images.directive';

/**
 * `[smMarkdownImages]` is the ONLY path from a rendered markdown image to
 * a real network request: the renderer emits an inert placeholder, this
 * directive swaps it for an `<img>` on click. The specs below pin both
 * halves of that contract, the swap happens on a genuine placeholder
 * click, and nothing else (a click elsewhere, a tampered URL) produces an
 * image element.
 */
@Component({
  imports: [MarkdownImagesDirective],
  template: `<div
    class="outer"
    (click)="outerClicks.set(outerClicks() + 1)"
    data-testid="outer"
  >
    <div smMarkdownImages data-testid="host" [innerHTML]="html()"></div>
  </div>`,
})
class HostComponent {
  private readonly sanitizer = inject(DomSanitizer);
  readonly raw = signal('');
  readonly html = computed(() => this.sanitizer.bypassSecurityTrustHtml(this.raw()));
  /**
   * Stands in for the graph view's canvas-level click handler, which
   * deselects the node (closing the inspector) unless the click's target
   * sits inside a shielded subtree.
   */
  readonly outerClicks = signal(0);
}

function placeholder(url: string, label = 'Diagram'): string {
  return (
    '<button type="button" class="sm-md-img" data-testid="markdown-image-load"' +
    ` data-sm-img-src="${url}">` +
    `<span class="sm-md-img__label">${label}</span>` +
    '<span class="sm-md-img__host">cdn.example.com</span>' +
    '</button>'
  );
}

describe('MarkdownImagesDirective', () => {
  let host: HostComponent;

  function render(html: string): HTMLElement {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    host.raw.set(html);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('swaps the placeholder for an <img> when it is clicked', () => {
    const el = render(placeholder('https://cdn.example.com/a.png'));
    expect(el.querySelector('img')).toBeNull();

    el.querySelector<HTMLButtonElement>('[data-testid="markdown-image-load"]')?.click();

    const img = el.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://cdn.example.com/a.png');
    // Alt text is read back off the chip so the accessible name survives.
    expect(img?.getAttribute('alt')).toBe('Diagram');
    // The consented request must not also disclose the referring view.
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img?.getAttribute('data-testid')).toBe('markdown-image-loaded');
    // The placeholder is gone, replaced in place.
    expect(el.querySelector('[data-testid="markdown-image-load"]')).toBeNull();
  });

  it('resolves a click on a child of the placeholder', () => {
    const el = render(placeholder('https://cdn.example.com/a.png'));
    el.querySelector<HTMLElement>('.sm-md-img__label')?.click();
    expect(el.querySelector('img')).not.toBeNull();
  });

  it('ignores a click that lands outside a placeholder', () => {
    const el = render(`<p>prose</p>${placeholder('https://cdn.example.com/a.png')}`);
    el.querySelector<HTMLElement>('p')?.click();
    expect(el.querySelector('img')).toBeNull();
    // The placeholder is still there, untouched.
    expect(el.querySelector('[data-testid="markdown-image-load"]')).not.toBeNull();
  });

  it('ignores a static placeholder, it carries no URL to load', () => {
    const el = render(
      '<span class="sm-md-img sm-md-img--static" data-testid="markdown-image-static">Diagram</span>',
    );
    el.querySelector<HTMLElement>('[data-testid="markdown-image-static"]')?.click();
    expect(el.querySelector('img')).toBeNull();
  });

  it('refuses a tampered javascript: URL in data-sm-img-src', () => {
    // Defence in depth: the renderer already validated the URL, but the
    // markup sits in a mutable DOM, so the directive re-runs the guard.
    const el = render(placeholder('javascript:alert(1)'));
    el.querySelector<HTMLButtonElement>('[data-testid="markdown-image-load"]')?.click();
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('[data-testid="markdown-image-load"]')).not.toBeNull();
  });

  it('refuses a tampered data: URL in data-sm-img-src', () => {
    const el = render(placeholder('data:text/html,<script>alert(1)</script>'));
    el.querySelector<HTMLButtonElement>('[data-testid="markdown-image-load"]')?.click();
    expect(el.querySelector('img')).toBeNull();
  });

  // Regression: the swap detaches the placeholder mid-dispatch, so an
  // ancestor handler that walks up from `event.target` (the graph view's
  // canvas click deselects unless the target is inside a shielded
  // subtree) saw an orphaned node, found no shield, and closed the
  // inspector the operator was reading. The click must not reach it.
  it('consumes the click so ancestor handlers never see it', () => {
    const el = render(placeholder('https://cdn.example.com/a.png'));
    el.querySelector<HTMLButtonElement>('[data-testid="markdown-image-load"]')?.click();

    expect(el.querySelector('img')).not.toBeNull();
    expect(host.outerClicks()).toBe(0);
  });

  it('lets a click outside a placeholder bubble to ancestor handlers', () => {
    // Only the affordance's own clicks are consumed; ordinary prose
    // clicks keep whatever behaviour the host view defines for them.
    const el = render(`<p>prose</p>${placeholder('https://cdn.example.com/a.png')}`);
    el.querySelector<HTMLElement>('p')?.click();
    expect(host.outerClicks()).toBe(1);
  });
});
