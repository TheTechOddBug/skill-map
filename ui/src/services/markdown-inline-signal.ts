/**
 * Reactive markdown -> SafeHtml signals.
 *
 * `setupInlineMarkdown` renders a reactive source string into inline
 * `SafeHtml` (emphasis / code spans / links, no block wrapper), for
 * short fields like node / inspector descriptions. `setupBlockMarkdown`
 * renders full block markdown (paragraphs, lists, code blocks), for
 * richer fields such as an agent's initial prompt.
 *
 * Both mirror the token-guard shape of `setupBodyState`: each source
 * change bumps a monotonic token so a stale async render (the markdown
 * libs are lazy-loaded, so the first render resolves a tick or two
 * later) can never overwrite a newer value. The signal is cleared at the
 * start of every run so a previous node's value cannot linger on screen
 * while the next one renders.
 *
 * Must be called from an injection context (component field initializer
 * or constructor) so `effect()` can be created; the runtime guard turns a
 * misplaced call into a clear NG0203 instead of a delayed failure.
 */

import { assertInInjectionContext, effect, signal, type Signal } from '@angular/core';
import type { SafeHtml } from '@angular/platform-browser';

import type { MarkdownRenderer } from './markdown-renderer';

/**
 * Shared core: drive a `SafeHtml` signal off a reactive source string,
 * rendered through the given async renderer with a stale-result guard.
 */
function setupMarkdownSignal(
  source: () => string,
  render: (src: string) => Promise<SafeHtml>,
): Signal<SafeHtml | null> {
  const html = signal<SafeHtml | null>(null);
  let token = 0;

  effect(() => {
    const src = source().trim();
    const myToken = ++token;
    html.set(null);
    if (!src) return;
    void render(src)
      .then((rendered) => {
        if (myToken === token) html.set(rendered);
      })
      .catch(() => {
        // Render failure leaves the field empty rather than surfacing a
        // raw error; the source string is project-controlled, so this is
        // a defensive guard, not an expected path.
        if (myToken === token) html.set(null);
      });
  });

  return html.asReadonly();
}

/** Inline markdown (emphasis / code / links, no block wrapper). */
export function setupInlineMarkdown(
  source: () => string,
  markdown: MarkdownRenderer,
): Signal<SafeHtml | null> {
  assertInInjectionContext(setupInlineMarkdown);
  return setupMarkdownSignal(source, (src) => markdown.renderInline(src));
}

/** Full block markdown (paragraphs, lists, code blocks). */
export function setupBlockMarkdown(
  source: () => string,
  markdown: MarkdownRenderer,
): Signal<SafeHtml | null> {
  assertInInjectionContext(setupBlockMarkdown);
  return setupMarkdownSignal(source, (src) => markdown.render(src));
}
