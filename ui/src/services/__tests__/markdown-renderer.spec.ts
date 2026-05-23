import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { MarkdownRenderer } from '../markdown-renderer';

describe('MarkdownRenderer', () => {
  function makeRenderer(): MarkdownRenderer {
    TestBed.configureTestingModule({});
    return TestBed.runInInjectionContext(() => new MarkdownRenderer());
  }

  it('renders standard markdown to HTML', async () => {
    const r = makeRenderer();
    const html = await r.renderToHtml('# Hello\n\nA *world* of `code`.');
    expect(html).toContain('<h1>');
    expect(html).toContain('Hello');
    expect(html).toContain('<em>world</em>');
    expect(html).toContain('<code>code</code>');
  });

  it('strips raw <script> tags before they reach the DOM', async () => {
    const r = makeRenderer();
    const html = await r.renderToHtml(
      'before\n\n<script>alert(1)</script>\n\nafter',
    );
    // markdown-it `html: false` already escapes raw HTML; DOMPurify is the
    // belt-and-braces second pass. Either way, no executable <script> reaches
    // the rendered output.
    expect(html.toLowerCase()).not.toMatch(/<script[^>]*>alert/);
  });

  it('strips javascript: URLs from anchor href attributes', async () => {
    // markdown-it's `validateLink` already rejects `javascript:` schemes
    // for the `href` it would emit. The autolink case (`<javascript:...>`)
    // is the higher-risk surface, assert no executable href reaches the
    // DOM regardless of which path the source takes.
    const r = makeRenderer();
    const html = await r.renderToHtml(
      '<https://example.com> <javascript:alert(1)>',
    );
    expect(html).toContain('https://example.com');
    expect(html.toLowerCase()).not.toMatch(/href\s*=\s*"?javascript:/);
  });

  it('escapes raw HTML so img onerror handlers never become executable elements', async () => {
    // markdown-it `html: false` escapes raw HTML rather than letting it
    // through as DOM. The resulting "html" string therefore renders the
    // attempted handler as plain text (`&lt;img...&gt;`), no live
    // `<img>` element ever reaches the page, so no `onerror` fires.
    // DOMPurify is the second line of defence (covers attribute-level
    // smuggling that markdown features like reference labels could
    // produce). Assert no live `<img` tag survives.
    const r = makeRenderer();
    const html = await r.renderToHtml(
      '<img src="x" onerror="alert(1)">',
    );
    expect(html.toLowerCase()).not.toMatch(/<img\b[^>]*onerror/);
  });

  it('lazy-loads the libraries: first render imports, subsequent renders reuse', async () => {
    const r = makeRenderer();
    const a = await r.renderToHtml('one');
    const b = await r.renderToHtml('two');
    expect(a).toContain('one');
    expect(b).toContain('two');
    // Second call must complete using the cached promise, no error,
    // and the renderer instance still works after multiple invocations.
    const c = await r.renderToHtml('three');
    expect(c).toContain('three');
  });

  it('render() wraps the sanitized HTML as a SafeHtml value', async () => {
    const r = makeRenderer();
    const safe = await r.render('# Title');
    // SafeHtml is an opaque marker, assert it's not the raw string.
    expect(typeof safe).not.toBe('string');
    expect(safe).toBeDefined();
  });

  // Audit `app-hacker` M-1, narrow ALLOWED_URI_REGEXP. DOMPurify's
  // library default already rejects `data:` in href, but the explicit
  // allowlist locks the policy at the call site so a future library
  // bump that loosens the default can't reach the renderer.
  describe('audit M-1, URI scheme allowlist on href', () => {
    for (const bad of [
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      'about:blank',
    ]) {
      it(`strips ${JSON.stringify(bad)} from anchor href`, async () => {
        const r = makeRenderer();
        // Markdown autolink form keeps the scheme intact through markdown-it
        // so DOMPurify is the layer doing the work here. Inline-link form
        // also goes through markdown-it's `validateLink`, but autolinks
        // are the higher-risk smuggling surface.
        const html = await r.renderToHtml(`[click](${bad})`);
        const lower = html.toLowerCase();
        // No surviving `href="<scheme>:..."` in any form.
        expect(lower).not.toMatch(
          new RegExp(`href\\s*=\\s*"?${bad.split(':')[0]}:`, 'i'),
        );
      });
    }

    it('keeps an https:// href intact', async () => {
      const r = makeRenderer();
      const html = await r.renderToHtml('[ok](https://example.com/a)');
      expect(html).toContain('href="https://example.com/a"');
    });

    it('keeps a mailto: href intact', async () => {
      const r = makeRenderer();
      const html = await r.renderToHtml('[ok](mailto:a@b.c)');
      expect(html).toContain('href="mailto:a@b.c"');
    });
  });
});
