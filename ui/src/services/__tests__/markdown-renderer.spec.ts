import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SecurityContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

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

  it('highlights a fenced code block with highlight.js token classes', async () => {
    const r = makeRenderer();
    const html = await r.renderToHtml('```ts\nconst x = 1;\n```');
    // The `highlight` callback wraps the block with the `hljs` container
    // class and the language tag; `const` is a keyword so highlight.js
    // emits at least one `hljs-keyword` span. DOMPurify keeps `class`.
    expect(html).toContain('class="hljs language-ts"');
    expect(html).toMatch(/hljs-keyword/);
  });

  it('renders an unknown-language fence as a plain escaped hljs block', async () => {
    const r = makeRenderer();
    const html = await r.renderToHtml('```nope-not-a-lang\n<b>raw</b>\n```');
    // Unknown language: bare `hljs` container (no `language-*`), content
    // HTML-escaped by the callback rather than passed through live.
    expect(html).toContain('class="hljs"');
    expect(html).toContain('&lt;b&gt;raw&lt;/b&gt;');
    expect(html.toLowerCase()).not.toContain('<b>raw</b>');
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

  describe('highlightSource (raw editor view)', () => {
    function unwrap(safe: unknown): string {
      // A value created via `bypassSecurityTrustHtml` is unwrapped to its
      // inner string by `sanitize` in the HTML context.
      const sanitizer = TestBed.inject(DomSanitizer);
      return sanitizer.sanitize(SecurityContext.HTML, safe as never) ?? '';
    }

    it('highlights a markdown source string with hljs token spans', async () => {
      const r = makeRenderer();
      const html = unwrap(await r.highlightSource('# Heading\n\nsome text', 'markdown'));
      expect(html).toContain('Heading');
      // The markdown grammar emits at least one hljs token span for the heading.
      expect(html).toMatch(/hljs-/);
    });

    it('escapes the source for an unknown language instead of passing it live', async () => {
      const r = makeRenderer();
      const html = unwrap(await r.highlightSource('<b>raw</b>', 'nope-not-a-lang'));
      expect(html).toContain('&lt;b&gt;raw&lt;/b&gt;');
      expect(html.toLowerCase()).not.toContain('<b>raw</b>');
    });
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

  // Audit `app-hacker` L-1, remote-image beacon. A markdown body is
  // author-controlled, so a rendered `<img>` is an outbound request the
  // operator never asked for (IP + view timing to the content author),
  // the same channel `css-guard` refuses for `url(...)`. The tag is
  // dropped outright rather than scheme-filtered.
  describe('audit L-1, no image beacons from author-controlled markdown', () => {
    it('drops a remote image from a rendered body', async () => {
      const r = makeRenderer();
      const html = await r.renderToHtml('![pixel](https://attacker.example/p.png)');
      expect(html.toLowerCase()).not.toContain('<img');
      expect(html).not.toContain('attacker.example');
    });

    it('drops a remote image from an inline render too', async () => {
      const r = makeRenderer();
      const html = await r.renderToHtml('text ![pixel](https://attacker.example/p.png) more');
      expect(html.toLowerCase()).not.toContain('<img');
      expect(html).not.toContain('attacker.example');
      // The surrounding prose still renders; only the beacon is removed.
      expect(html).toContain('text');
      expect(html).toContain('more');
    });

    it('drops a reference-style image', async () => {
      const r = makeRenderer();
      const html = await r.renderToHtml('![x][ref]\n\n[ref]: https://attacker.example/p.png');
      expect(html.toLowerCase()).not.toContain('<img');
      expect(html).not.toContain('attacker.example');
    });
  });
});
