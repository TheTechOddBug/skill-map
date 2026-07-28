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
 *      through a permissive parser config). Its config also narrows the
 *      URI-scheme allowlist and drops the two tags that reach outside
 *      the document on render, `style` and `img` (see `setConfig`).
 *   3. The resulting HTML is wrapped via `bypassSecurityTrustHtml` so
 *      Angular's template binding renders it as DOM rather than text.
 *
 * **Image placeholders (click to load)**: a markdown body is
 * AUTHOR-controlled, so an `<img src="https://…">` is an outbound
 * request the operator never asked for, leaking their IP and view timing
 * to the content author the moment the node opens. The `image` renderer
 * rule (see `renderImagePlaceholder`) therefore NEVER emits an `<img>`;
 * it emits an inert placeholder naming the image and the host the
 * request would go to, and the fetch happens only after an explicit
 * click, handled by the `[smMarkdownImages]` directive. Two shapes,
 * picked by the `smImageMode` flag threaded through markdown-it's `env`
 * (one parser instance, one rule, per-call mode):
 *
 *   - `interactive` (`render` / `renderToHtml`, the block hosts): a
 *     `<button class="sm-md-img" data-sm-img-src="…">` chip.
 *   - `static` (`renderInline`, node-card and inspector descriptions):
 *     a plain `<span class="sm-md-img sm-md-img--static">`, no URL
 *     attribute, no click target. Those hosts already own click
 *     (selection) and drag (move) gestures, and hundreds of cards render
 *     at once.
 *
 * A `src` that is not `http(s)` (checked with the same `httpUrlOrNull`
 * guard the `[href]` sinks use) degrades to the static span with no URL
 * attribute, so no gesture can ever resolve it. `img` also stays in
 * `FORBID_TAGS` as the backstop: even if a future rule regressed, the
 * sanitizer would still strip the tag.
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

import { MARKDOWN_TEXTS } from '../i18n/markdown.texts';
import { httpUrlOrNull } from './url-guard';

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
    const rendered = renderer.md.render(src, INTERACTIVE_ENV);
    const clean = renderer.purify.sanitize(rendered);
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  }

  /**
   * Render a markdown source string as INLINE HTML, no block wrapper
   * (`renderInline` skips paragraph / heading / list tokens). For short
   * fields like node and inspector descriptions where only inline marks
   * (emphasis, code spans, links) should apply. Same two sanitization
   * lines as `render`.
   *
   * Images render as the STATIC placeholder here: the hosts of an inline
   * render (node cards, the inspector description) already own click and
   * drag, so a button inside them would fight those gestures.
   */
  async renderInline(src: string): Promise<SafeHtml> {
    const renderer = await this.loadLibs();
    const rendered = renderer.md.renderInline(src, STATIC_ENV);
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
    const rendered = renderer.md.render(src, INTERACTIVE_ENV);
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
  md: IMarkdownIt;
  purify: { sanitize(html: string): string };
  hljs: IHljs;
}

/**
 * Which placeholder shape the `image` rule emits for this render pass.
 * Threaded through markdown-it's `env` argument rather than built into
 * two parser instances: the mode is a per-CALL property (the same body
 * can be rendered inline in a card and as a block in the inspector), and
 * a second instance would double the parser + highlight setup for one
 * boolean.
 */
type TImageMode = 'interactive' | 'static';

/** Per-render environment markdown-it passes down to every rule. */
interface IMdEnv {
  smImageMode: TImageMode;
}

const INTERACTIVE_ENV: IMdEnv = { smImageMode: 'interactive' };
const STATIC_ENV: IMdEnv = { smImageMode: 'static' };

/** Minimal slice of a markdown-it token the image rule reads. */
interface IMdToken {
  content: string;
  children: IMdToken[] | null;
  attrGet(name: string): string | null;
}

/**
 * Minimal slice of markdown-it's `Renderer` passed back to a rule as
 * `self`. `renderInlineAsText` flattens the alt-text children to plain
 * text, exactly what the stock image renderer uses to fill `alt`.
 */
interface IMdRendererSelf {
  renderInlineAsText(tokens: IMdToken[], options: unknown, env: unknown): string;
}

type TRenderRule = (
  tokens: IMdToken[],
  idx: number,
  options: unknown,
  env: IMdEnv | undefined,
  self: IMdRendererSelf,
) => string;

/** Minimal slice of the markdown-it instance surface the renderer drives. */
interface IMarkdownIt {
  render(src: string, env?: IMdEnv): string;
  renderInline(src: string, env?: IMdEnv): string;
  renderer: { rules: Record<string, TRenderRule | undefined> };
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
  const MarkdownIt = (mdMod as unknown as { default: new (opts: unknown) => IMarkdownIt }).default;
  const hljs = (hljsMod as unknown as { default: IHljs }).default;
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    // Fenced code blocks render with highlight.js token spans; the theme
    // colours live in `themes/highlight.css`. See `highlightCode`.
    highlight: (str: string, lang: string): string => highlightCode(hljs, str, lang),
  });
  // Replace the stock `image` renderer so an image token can never
  // become an `<img>`. See `renderImagePlaceholder` and the file header.
  md.renderer.rules['image'] = renderImagePlaceholder;
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
    // `img` is forbidden, not merely scheme-restricted: markdown bodies
    // are AUTHOR-controlled (a cloned repo's `.md` files, sidecar
    // annotations, agent-written prompts), and an `<img src="https://…">`
    // fires an outbound request the moment the operator opens the node,
    // leaking their IP and view timing to the content author. That is the
    // same beacon channel `services/css-guard.ts` already refuses for
    // `url(...)` in author-controlled `[style.*]` values, so allowing it
    // here would leave the two policies contradicting each other. Remote
    // images are the only markdown feature that phones home on render,
    // hence the tag-level ban rather than a tighter URI policy (`data:`
    // is already rejected by ALLOWED_URI_REGEXP, and a local-file image
    // has no meaning in a browser-served SPA).
    //
    // This is now the BACKSTOP, not the whole policy: the `image`
    // renderer rule already emits a click-to-load placeholder instead of
    // an `<img>` (see the file header), so nothing should reach the
    // sanitizer as an image tag. Keeping the tag forbidden means a
    // regression in that rule, or a raw `<img>` smuggled through some
    // other markdown feature, still cannot fire a request. The
    // placeholder path emits `button` / `span` / `i` with `class`,
    // `type`, `title`, `aria-label` and `data-*`, all preserved by this
    // config as-is, so no widening was needed.
    FORBID_TAGS: ['style', 'img'],
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
 * Escape the four HTML-significant characters for markup this file
 * builds by hand. markdown-it escapes fence content itself, but only
 * when no `highlight` callback is set; once we own the callback we must
 * escape the unhighlighted branch ourselves before it reaches
 * `[innerHTML]`. `renderImagePlaceholder` reuses it for the alt text,
 * host, and URL it interpolates.
 *
 * CAVEAT: it does NOT escape `'`. Every attribute in the markup this
 * file emits is therefore DOUBLE-quoted; a single-quoted attribute
 * context would be an injection hole.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * markdown-it `image` renderer rule, the click-to-load placeholder.
 *
 * Replaces the stock renderer entirely: an image token NEVER becomes an
 * `<img>`, so opening a node from a hostile repo issues no request. What
 * it emits instead:
 *
 *   - INTERACTIVE mode, an inert button carrying the URL in
 *     `data-sm-img-src`. Only a real click (handled by the
 *     `[smMarkdownImages]` directive, which re-validates the URL) swaps
 *     in a live `<img>`.
 *   - STATIC mode, a plain span with no URL attribute at all.
 *
 * A `src` that is not `http(s)` degrades to the static span even in
 * interactive mode, so a `data:` / `file:` / custom-scheme URL is never
 * reachable by any gesture. Everything interpolated into the markup (alt
 * text, host, URL) goes through `escapeHtml` first, and every attribute
 * is DOUBLE-quoted: `escapeHtml` does not escape `'`, so a
 * single-quoted attribute context here would be an injection hole.
 */
function renderImagePlaceholder(
  tokens: IMdToken[],
  idx: number,
  options: unknown,
  env: IMdEnv | undefined,
  self: IMdRendererSelf,
): string {
  const token = tokens[idx];
  const alt = imageAltText(token, options, env, self);
  const label = alt.length > 0 ? alt : MARKDOWN_TEXTS.imageFallbackLabel;
  const safeLabel = escapeHtml(label);
  const url = httpUrlOrNull(token.attrGet('src'));
  if (url === null || env?.smImageMode !== 'interactive') {
    return (
      '<span class="sm-md-img sm-md-img--static" data-testid="markdown-image-static">' +
      `<span class="sm-md-img__label">${safeLabel}</span>` +
      '</span>'
    );
  }
  const host = new URL(url).host;
  return (
    '<button type="button" class="sm-md-img" data-testid="markdown-image-load"' +
    ` data-sm-img-src="${escapeHtml(url)}"` +
    ` title="${escapeHtml(MARKDOWN_TEXTS.imageLoadTooltip)}"` +
    ` aria-label="${escapeHtml(MARKDOWN_TEXTS.imageLoadAriaLabel(label, host))}">` +
    '<i class="pi pi-image" aria-hidden="true"></i>' +
    `<span class="sm-md-img__label">${safeLabel}</span>` +
    `<span class="sm-md-img__host">${escapeHtml(host)}</span>` +
    '</button>'
  );
}

/**
 * Plain-text alt for an image token. markdown-it parses the alt into
 * child tokens and leaves the token's own `alt` attribute empty until
 * the stock renderer fills it, so reading `attrGet('alt')` would always
 * yield `''`. `renderInlineAsText` is the same flattening the stock
 * renderer uses; `token.content` (the raw alt source) is the fallback
 * for a token that carries no children.
 */
function imageAltText(
  token: IMdToken,
  options: unknown,
  env: IMdEnv | undefined,
  self: IMdRendererSelf,
): string {
  const children = token.children;
  const text = children ? self.renderInlineAsText(children, options, env) : token.content;
  return (text ?? '').trim();
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
