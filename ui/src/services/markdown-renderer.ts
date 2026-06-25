/**
 * `MarkdownRenderer`, lazy markdown → safe HTML pipeline.
 *
 * Rendering pipeline:
 *
 *   1. `markdown-it` (CommonMark + linkify) renders the source string
 *      into HTML with raw HTML disabled (`html: false`). Disabling raw
 *      HTML at the parser level is the first sanitization line, the
 *      worst input the renderer can produce is text-styled markup, no
 *      direct `<script>` injection. Fenced code blocks run through a
 *      `highlight` callback (highlight.js) that emits `hljs-*` token
 *      spans; the spans survive step 2 (DOMPurify keeps `class`).
 *   2. `DOMPurify` runs over the rendered HTML as the second line of
 *      defence (markdown features that wrap user input, e.g. autolinks,
 *      reference labels, can still smuggle attribute-level vectors
 *      through a permissive parser config).
 *   3. The resulting HTML is wrapped via `bypassSecurityTrustHtml` so
 *      Angular's template binding renders it as DOM rather than text.
 *
 * **Lazy-loaded**: the heavy modules (`markdown-it` ~80 KB, `dompurify`
 * ~30 KB, `highlight.js/lib/common` ~common-language subset) are imported
 * via dynamic `import()` on first call. The renderer
 * is provided in the root injector and constructed cheaply (no work in
 * the constructor) so the inspector view can `inject()` it without
 * paying the cost until a card actually needs to render markdown.
 *
 * **Singleton libs**: the import promise is cached on the instance, so
 * subsequent calls await the same already-resolved modules, no double
 * import, no double parser construction.
 *
 * **DOMPurify default export shape**: the ESM default export is the
 * singleton DOMPurify instance, itself callable as `DOMPurify(window)`
 * to get a freshly-bound instance. Calling `.sanitize()` on the
 * default export directly works against the current global `window`
 * (the browser default) or jsdom's `window` in unit tests.
 */

import { Injectable, inject } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

@Injectable({ providedIn: 'root' })
export class MarkdownRenderer {
  private readonly sanitizer = inject(DomSanitizer);

  /**
   * Resolved on first use. Subsequent calls reuse the same promise so
   * the heavy libs are imported and instantiated exactly once per
   * root injector lifetime (the service is `providedIn: 'root'`, so a
   * single instance lives for the whole app session).
   */
  private libsPromise: Promise<IRenderer> | null = null;

  /**
   * Render a markdown source string into a `SafeHtml` value Angular
   * binds via `[innerHTML]` without re-sanitising. The two lines of
   * defence (`markdown-it` `html: false` + DOMPurify) run inside the
   * promise; failures bubble, callers decide whether to surface the
   * error or fall back to plain text.
   */
  async render(src: string): Promise<SafeHtml> {
    const renderer = await this.loadLibs();
    const rendered = renderer.md.render(src);
    const clean = renderer.purify.sanitize(rendered);
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  }

  /**
   * Render a markdown source string as INLINE HTML, no block wrapper
   * (`renderInline` skips paragraph / heading / list tokens). For short
   * fields like node and inspector descriptions where only inline marks
   * (emphasis, code spans, links) should apply. Same two sanitization
   * lines as `render`.
   */
  async renderInline(src: string): Promise<SafeHtml> {
    const renderer = await this.loadLibs();
    const rendered = renderer.md.renderInline(src);
    const clean = renderer.purify.sanitize(rendered);
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  }

  /**
   * Render to a sanitised HTML string (no `bypassSecurityTrustHtml`
   * wrap). Useful for tests, server-side rendering, or any caller that
   * wants the raw string instead of an Angular `SafeHtml`.
   */
  async renderToHtml(src: string): Promise<string> {
    const renderer = await this.loadLibs();
    const rendered = renderer.md.render(src);
    return renderer.purify.sanitize(rendered);
  }

  /**
   * Syntax-highlight a SOURCE string as code (not as markdown to render):
   * returns highlight.js token spans (`class="hljs-*"`, coloured by
   * `themes/highlight.css`) so a caller can show the raw source like a
   * read-only code editor. A recognised `lang` highlights; an unknown one
   * falls back to a plain escaped block. Same DOMPurify pass + `SafeHtml`
   * wrap as `render`, so it is safe for an `[innerHTML]` sink. This is the
   * raw / source counterpart to `render` (which turns markdown into prose).
   */
  async highlightSource(src: string, lang: string): Promise<SafeHtml> {
    const renderer = await this.loadLibs();
    const language = renderer.hljs.getLanguage(lang) ? lang : null;
    const out = language
      ? renderer.hljs.highlight(src, { language, ignoreIllegals: true }).value
      : escapeHtml(src);
    const clean = renderer.purify.sanitize(out);
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  }

  private loadLibs(): Promise<IRenderer> {
    if (!this.libsPromise) {
      this.libsPromise = importRenderer();
    }
    return this.libsPromise;
  }
}

interface IRenderer {
  md: { render(src: string): string; renderInline(src: string): string };
  purify: { sanitize(html: string): string };
  hljs: IHljs;
}

/**
 * Explicit URI-scheme allowlist for DOMPurify, used both on `<a href>`
 * and on every other attribute that takes a URI. Narrower than the
 * library default: only `http:`, `https:`, `mailto:`, and `tel:`. Every
 * other scheme (`data:`, `blob:`, `file:`, `vbscript:`, `about:`,
 * custom `…:`) is rejected. Belt-and-braces against attacker-controlled
 * markdown that might smuggle a `data:text/html,...` autolink past the
 * markdown-it `validateLink` and reach the `[innerHTML]` sink.
 *
 * The leading `(?:[^a-z]|...)` alternatives match library defaults that
 * the spec relies on (relative URLs, fragments, query-only refs).
 */
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/**
 * Dynamic import + instantiation of the markdown + sanitizer libraries.
 * Extracted so tests can swap it via `__testHooks` without touching the
 * Angular `inject()` graph.
 */
async function importRenderer(): Promise<IRenderer> {
  const [mdMod, purifyMod, hljsMod] = await Promise.all([
    import('markdown-it'),
    import('dompurify'),
    // `lib/common` ships highlight.js with the ~37 most-used languages
    // pre-registered (bash, json, yaml, ts / js, python, xml, css, sql,
    // diff, markdown, …), the bundle-size-conscious entry point the
    // upstream README recommends over the all-languages default.
    import('highlight.js/lib/common'),
  ]);
  // markdown-it ships its constructor on the default export. The
  // `.default` access works for both ESM and Vite's CJS interop.
  const MarkdownIt = (mdMod as unknown as { default: new (opts: unknown) => { render: (src: string) => string; renderInline: (src: string) => string } }).default;
  const hljs = (hljsMod as unknown as { default: IHljs }).default;
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    // Fenced code blocks render with highlight.js token spans; the theme
    // colours live in `themes/highlight.css`. See `highlightCode`.
    highlight: (str: string, lang: string): string => highlightCode(hljs, str, lang),
  });
  // DOMPurify's default export IS the singleton DOMPurify instance,
  // calling `.sanitize()` on it directly uses the current `window`
  // (browser default) or jsdom's `window` in unit tests.
  //
  // `setConfig` applies a process-wide default to every subsequent
  // `sanitize()` call. The renderer never relies on per-call configs
  // that would clash with this baseline; if a future caller needs a
  // looser policy it MUST pass an explicit `sanitize(html, {...})`
  // override rather than mutating the default.
  const purify = (purifyMod as unknown as {
    default: {
      sanitize: (html: string) => string;
      setConfig: (cfg: Record<string, unknown>) => void;
    };
  }).default;
  purify.setConfig({
    ALLOWED_URI_REGEXP,
    FORBID_TAGS: ['style'],
    FORBID_ATTR: ['style', 'srcset'],
  });
  return { md, purify, hljs };
}

/** Minimal slice of the highlight.js surface the renderer touches. */
interface IHljs {
  getLanguage(name: string): unknown;
  highlight(code: string, opts: { language: string; ignoreIllegals?: boolean }): { value: string };
}

/**
 * markdown-it `highlight` callback. Returns a complete `<pre><code>`
 * block so markdown-it uses it verbatim (its fence renderer skips its
 * own wrapper once the highlight result already starts with `<pre`).
 * A recognised language gets highlight.js token spans
 * (`class="hljs-*"`, coloured by `themes/highlight.css`); an unknown or
 * unlabelled fence falls back to a plain escaped block carrying just the
 * `hljs` container class. `ignoreIllegals` stops a malformed snippet
 * from throwing; the `catch` is belt-and-braces. The result still flows
 * through DOMPurify, which keeps `class` on `pre` / `code` / `span` (only
 * `style` is stripped), so the token spans survive sanitisation.
 */
function highlightCode(hljs: IHljs, code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      const out = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      return `<pre><code class="hljs language-${lang}">${out}</code></pre>`;
    } catch {
      // fall through to the escaped plain block
    }
  }
  return `<pre><code class="hljs">${escapeHtml(code)}</code></pre>`;
}

/**
 * Escape the four HTML-significant characters for the plain fallback
 * block. markdown-it escapes fence content itself, but only when no
 * `highlight` callback is set; once we own the callback we must escape
 * the unhighlighted branch ourselves before it reaches `[innerHTML]`.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Test hooks, exposed so unit tests can stub the dynamic import without
 * loading the real markdown-it / DOMPurify chunks. Callers replace
 * `importRendererImpl` with a fake factory before instantiating the
 * renderer; the prod call site never touches this.
 */
export const __testHooks = {
  importRenderer,
};
