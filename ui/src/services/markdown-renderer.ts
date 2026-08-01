/**
 * `MarkdownRenderer`, lazy markdown → safe HTML pipeline.
 *
 * Rendering pipeline:
 *
 *   1. `markdown-it` (CommonMark + linkify) renders the source string
 *      into HTML with raw HTML PASSED THROUGH (`html: true`). Fenced
 *      code blocks run through a `highlight` callback (highlight.js)
 *      that emits `hljs-*` token spans; the spans survive step 2
 *      (DOMPurify keeps `class`).
 *   2. `DOMPurify` is THE sanitization boundary, not a second opinion.
 *      Its config narrows the library defaults well past stock: the
 *      URI-scheme allowlist is explicit, the SVG and MathML profiles are
 *      off, and every tag that fetches on render is forbidden (see
 *      `setConfig`). An `uponSanitizeElement` hook turns images into
 *      click-to-load placeholders on the way through.
 *
 * The parser used to escape raw HTML (`html: false`) as a crude first
 * line of defence. It was dropped because real markdown leans on HTML
 * blocks (`<details><summary>`, `<div align>`, `<picture>` chart and
 * badge embeds) and escaping them rendered a wall of literal tags in the
 * inspector, hiding real content behind what read as a bug. The
 * remaining line is the one actually designed for hostile HTML, and the
 * config below closes the vectors that flag was incidentally covering.
 *   3. The resulting HTML is wrapped via `bypassSecurityTrustHtml` so
 *      Angular's template binding renders it as DOM rather than text.
 *
 * **Image placeholders (click to load)**: a markdown body is
 * AUTHOR-controlled, so an `<img src="https://…">` is an outbound
 * request the operator never asked for, leaking their IP and view timing
 * to the content author the moment the node opens. The `imageHook`
 * therefore rewrites every image, however it arrived (markdown syntax or
 * raw HTML), into an inert placeholder naming the image and the host the
 * request would go to; the fetch happens only after an explicit click,
 * handled by the `[smMarkdownImages]` directive. Two shapes, picked by
 * `currentImageMode`:
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
 * attribute, so no gesture can ever resolve it.
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
    const clean = sanitizeImages(renderer, renderer.md.render(src), 'interactive');
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
    const clean = sanitizeImages(renderer, renderer.md.renderInline(src), 'static');
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  }

  /**
   * Render to a sanitised HTML string (no `bypassSecurityTrustHtml`
   * wrap). Useful for tests, server-side rendering, or any caller that
   * wants the raw string instead of an Angular `SafeHtml`.
   */
  async renderToHtml(src: string): Promise<string> {
    const renderer = await this.loadLibs();
    return sanitizeImages(renderer, renderer.md.render(src), 'interactive');
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

/** Minimal slice of the markdown-it instance surface the renderer drives. */
interface IMarkdownIt {
  render(src: string): string;
  renderInline(src: string): string;
}

/** Which placeholder shape the image hook builds for this pass. */
type TImageMode = 'interactive' | 'static';

/**
 * Mode for the sanitize pass currently in flight, read by the DOMPurify
 * `uponSanitizeElement` hook (hooks receive no per-call context, so the
 * mode cannot ride an argument). Module scope is safe here for one
 * reason only: `sanitize()` is fully synchronous, so no second render can
 * interleave between the assignment and the read. `sanitizeImages` owns
 * every write and restores the safe default in a `finally`, so a throw
 * mid-sanitize can never leave `interactive` armed for a later inline
 * render.
 */
let currentImageMode: TImageMode = 'static';

/**
 * Placeholders THIS pass created, tracked by object identity so the
 * anti-impersonation strip below can tell them from author markup. A
 * WeakSet of live nodes is the one discriminator raw HTML cannot forge:
 * an author can copy our class and our `data-sm-img-src` attribute, but
 * not the identity of a node we constructed.
 */
const ownPlaceholders = new WeakSet<object>();

/**
 * Run the sanitizer with the image mode set for its hook. Restores the
 * static default afterwards, including on a throw.
 */
function sanitizeImages(renderer: IRenderer, html: string, mode: TImageMode): string {
  currentImageMode = mode;
  try {
    return renderer.purify.sanitize(html);
  } finally {
    currentImageMode = 'static';
  }
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
    // Raw HTML is PASSED THROUGH to DOMPurify rather than escaped. Real
    // markdown in the wild leans on HTML blocks (`<details><summary>`,
    // `<div align>`, `<picture><img>` badge and chart embeds); escaping
    // them rendered a wall of literal tags in the inspector, which read
    // as a bug and hid real content. DOMPurify is the tool built for
    // exactly this input, and the config below narrows it well past its
    // defaults (see `setConfig`). The trade is deliberate: one strong
    // sanitizer instead of a blunt parser flag plus that sanitizer.
    html: true,
    linkify: true,
    // Fenced code blocks render with highlight.js token spans; the theme
    // colours live in `themes/highlight.css`. See `highlightCode`.
    highlight: (str: string, lang: string): string => highlightCode(hljs, str, lang),
  });
  // DOMPurify's default export doubles as a factory: calling it with a
  // window binds a FRESH instance, so the hook + config below are
  // scoped to this renderer instead of mutating the process-wide
  // singleton (where a second root injector in one document, or a test
  // rig, would stack the `uponSanitizeElement` hook on every re-entry;
  // audit F-3).
  //
  // `setConfig` pins this instance's baseline for every subsequent
  // `sanitize()` call. Verified against dompurify@3.4.12: once
  // `setConfig` has run, a per-call `sanitize(html, {...})` config is
  // IGNORED, the instance restores the `setConfig` baseline instead
  // (`SET_CONFIG` short-circuit in `purify.js`). Do NOT attempt a
  // per-call override; a caller that genuinely needs a different
  // policy must bind its own `DOMPurify(window)` instance so this
  // hardened baseline stays untouched.
  const createDOMPurify = (purifyMod as unknown as {
    default: (win: Window & typeof globalThis) => {
      sanitize: (html: string) => string;
      setConfig: (cfg: Record<string, unknown>) => void;
      addHook: (name: string, cb: (node: Element, data: { tagName: string }) => void) => void;
    };
  }).default;
  const purify = createDOMPurify(window);
  purify.addHook('uponSanitizeElement', imageHook);
  purify.setConfig({
    ALLOWED_URI_REGEXP,
    // HTML only: drops the SVG and MathML profiles DOMPurify allows by
    // default. Load-bearing since `html: true`, an `<svg><image href>`
    // (and `<use href>`) fetches on render exactly like an `<img>`, and
    // author markup can now reach the sanitizer verbatim. Verified
    // against dompurify@3.4.12: with the profile off, both collapse to
    // nothing.
    USE_PROFILES: { html: true },
    // Every remaining tag that issues a network request purely by being
    // rendered. `img` heads the list but is a special case: the
    // `imageHook` above converts an image into a click-to-load
    // placeholder BEFORE the sanitizer removes it, so the ban here is
    // the backstop that catches any image the hook did not rewrite.
    // The others have no placeholder treatment and are simply dropped:
    //   - `video` / `audio`: `src` preloads on render.
    //   - `source`: feeds `<video>` / `<audio>` a `src` (its `srcset`
    //     for `<picture>` is separately killed by FORBID_ATTR).
    //   - `input`: `type="image"` has a fetching `src`.
    //   - `track`: fetch-capable (it is in DOMPurify's data-URI tag
    //     set) and only inert today because its `<audio>` / `<video>`
    //     parents are banned; listed on its own so its safety never
    //     depends on a sibling tag's ban (audit F-2).
    //   - `form`: cannot fetch on render and its fields are gone with
    //     `input` banned; banned anyway as a free backstop against
    //     phishing chrome, same reasoning as the BFF CSP's
    //     `object-src 'none'`.
    // Rationale for the whole policy, `context/ui.md` §No outbound
    // requests from author-controlled content.
    FORBID_TAGS: ['style', 'img', 'video', 'audio', 'source', 'input', 'track', 'form'],
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
 * DOMPurify `uponSanitizeElement` hook, the single place an image
 * becomes a click-to-load placeholder.
 *
 * It sits at the SANITIZER rather than in a markdown-it renderer rule so
 * one implementation covers both ways an image can arrive: markdown
 * syntax (`![alt](url)`, which markdown-it turns into an `<img>`) and
 * raw HTML written by the author (`<img>`, including the `<picture>`
 * badge and chart embeds common in real READMEs). A markdown-it rule
 * would only ever see the first.
 *
 * The hook runs BEFORE the element is removed for being in
 * `FORBID_TAGS`, so it can read the `src` and swap the node. Two shapes:
 *
 *   - INTERACTIVE, an inert `<button>` carrying the URL in
 *     `data-sm-img-src`. Only a real click, handled by the
 *     `[smMarkdownImages]` directive which re-validates the URL, swaps
 *     in a live `<img>`.
 *   - STATIC, a plain `<span>` with no URL attribute at all.
 *
 * A `src` that is not `http(s)` degrades to the static shape even in
 * interactive mode, so a `data:` / `file:` / custom-scheme URL is never
 * reachable by any gesture. The markup is built with DOM APIs and
 * `textContent`, so author-controlled alt text cannot escape into
 * markup, no manual escaping is involved.
 *
 * The non-image branch is the anti-impersonation guard. Now that raw
 * HTML reaches the sanitizer, an author can write a chip that LOOKS like
 * ours (same class, same attribute) but points somewhere other than the
 * host it displays, turning informed consent into a lie. Stripping
 * `data-sm-img-src` from every element we did not build ourselves leaves
 * such a forgery inert: it renders as a dead chip and no click can load
 * it. Identity comes from `ownPlaceholders`, the one property markup
 * cannot forge.
 */
function imageHook(node: Element, data: { tagName: string }): void {
  if (node.nodeType !== 1) return;
  if (data.tagName !== 'img') {
    if (!ownPlaceholders.has(node)) node.removeAttribute?.('data-sm-img-src');
    return;
  }
  const doc = node.ownerDocument;
  const parent = node.parentNode;
  if (doc === null || parent === null) return;

  const alt = (node.getAttribute('alt') ?? '').trim();
  const label = alt.length > 0 ? alt : MARKDOWN_TEXTS.imageFallbackLabel;
  const url = httpUrlOrNull(node.getAttribute('src'));

  const placeholder =
    url === null || currentImageMode !== 'interactive'
      ? buildStaticPlaceholder(doc, label)
      : buildInteractivePlaceholder(doc, label, url);
  ownPlaceholders.add(placeholder);
  parent.replaceChild(placeholder, node);
}

/**
 * Non-interactive chip: names the image, carries no URL to load.
 *
 * `role="img"` + `aria-label` are load-bearing for parity (WCAG 1.1.1 +
 * 1.4.1). Visually the dotted border and the dimmed fill say "there is
 * an image here and it was not loaded"; without the role the same chip
 * reaches assistive tech as the bare alt string dropped mid-sentence,
 * or as the literal word "Image" when the markdown carried no alt,
 * which reads as corrupted copy rather than as a deliberate state. The
 * role also collapses the inner label span into one atomic node, so the
 * chip is announced as a single object instead of stray prose.
 *
 * Still built with DOM APIs and `textContent` only: the label lands via
 * `setAttribute` / `labelSpan`, never through markup interpolation, so
 * the escaping posture of this file is unchanged.
 */
function buildStaticPlaceholder(doc: Document, label: string): Element {
  const span = doc.createElement('span');
  span.className = 'sm-md-img sm-md-img--static';
  span.setAttribute('data-testid', 'markdown-image-static');
  span.setAttribute('role', 'img');
  span.setAttribute('aria-label', MARKDOWN_TEXTS.imageStaticAriaLabel(label));
  span.appendChild(labelSpan(doc, label));
  return span;
}

/**
 * Click-to-load chip. Shows the HOST beside the label: the operator is
 * consenting to a request, so they get to see where it goes first.
 */
function buildInteractivePlaceholder(doc: Document, label: string, url: string): Element {
  const host = new URL(url).host;
  const button = doc.createElement('button');
  button.setAttribute('type', 'button');
  button.className = 'sm-md-img';
  button.setAttribute('data-testid', 'markdown-image-load');
  button.setAttribute('data-sm-img-src', url);
  button.setAttribute('title', MARKDOWN_TEXTS.imageLoadTooltip);
  button.setAttribute('aria-label', MARKDOWN_TEXTS.imageLoadAriaLabel(label, host));

  const icon = doc.createElement('i');
  icon.className = 'pi pi-image';
  icon.setAttribute('aria-hidden', 'true');
  button.appendChild(icon);
  button.appendChild(labelSpan(doc, label));

  const hostSpan = doc.createElement('span');
  hostSpan.className = 'sm-md-img__host';
  hostSpan.textContent = host;
  button.appendChild(hostSpan);
  return button;
}

function labelSpan(doc: Document, label: string): Element {
  const span = doc.createElement('span');
  span.className = 'sm-md-img__label';
  span.textContent = label;
  return span;
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
