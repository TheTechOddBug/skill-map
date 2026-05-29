/**
 * `setupInlineMarkdown`: render a reactive source string into inline
 * `SafeHtml` (emphasis / code spans / links, no block wrapper), for short
 * fields like node and inspector descriptions.
 *
 * Mirrors the token-guard shape of `setupBodyState`: each source change
 * bumps a monotonic token so a stale async render (the markdown libs are
 * lazy-loaded, so the first render resolves a tick or two later) can
 * never overwrite a newer value. The signal is cleared at the start of
 * every run so a previous node's description cannot linger on screen
 * while the next one renders.
 *
 * Must be called from an injection context (component field initializer
 * or constructor) so `effect()` can be created; the runtime guard turns a
 * misplaced call into a clear NG0203 instead of a delayed failure.
 */

import { assertInInjectionContext, effect, signal, type Signal } from '@angular/core';
import type { SafeHtml } from '@angular/platform-browser';

import type { MarkdownRenderer } from './markdown-renderer';

export function setupInlineMarkdown(
  source: () => string,
  markdown: MarkdownRenderer,
): Signal<SafeHtml | null> {
  assertInInjectionContext(setupInlineMarkdown);

  const html = signal<SafeHtml | null>(null);
  let token = 0;

  effect(() => {
    const src = source().trim();
    const myToken = ++token;
    html.set(null);
    if (!src) return;
    void markdown
      .renderInline(src)
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
