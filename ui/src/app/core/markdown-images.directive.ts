/**
 * `[smMarkdownImages]`, click-to-load activation for the image
 * placeholders emitted by `MarkdownRenderer`.
 *
 * Rendered markdown lands in the DOM through `[innerHTML]`, which is
 * inert: Angular binds no events into it, so the placeholder buttons
 * need a listener on the HOST element that carries the binding. This
 * directive is that listener, applied to the BLOCK-render hosts only
 * (inspector body, vendor initial prompt, conversation bubbles). The
 * inline hosts (node-card and inspector descriptions) render the static,
 * non-interactive placeholder by design and get no directive.
 *
 * Why the swap happens here and not in the renderer: the placeholder is
 * the whole point of the security posture (see the renderer's header),
 * so the live `<img>` must exist only as the direct consequence of a
 * user gesture. The directive re-runs `httpUrlOrNull` on the stored URL
 * rather than trusting it: the placeholder markup sits in a mutable DOM,
 * and defence in depth is cheap here.
 *
 * Deliberately stateless: no signals, no persistence, no bookkeeping of
 * which images were loaded. A re-render restores the placeholder, which
 * is the correct default, consenting to one request is not consenting to
 * every future one.
 *
 * `referrerpolicy="no-referrer"` on the created element keeps the second
 * half of the leak closed: the operator consented to the request, not to
 * telling the author which page they were on.
 */

import { Directive } from '@angular/core';

import { MARKDOWN_TEXTS } from '../../i18n/markdown.texts';
import { httpUrlOrNull } from '../../services/url-guard';

/** Placeholder chip that carries a loadable URL (interactive mode only). */
const PLACEHOLDER_SELECTOR = '.sm-md-img[data-sm-img-src]';

@Directive({
  selector: '[smMarkdownImages]',
  host: {
    '(click)': 'onClick($event)',
  },
})
export class MarkdownImagesDirective {
  onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const placeholder = target.closest(PLACEHOLDER_SELECTOR);
    if (placeholder === null) return;

    // The click is CONSUMED here, it never reaches an ancestor handler.
    // Load-bearing, not defensive: the graph view deselects the node (and
    // closes the inspector) on any click inside `.graph__canvas-wrap`
    // whose target is not inside a `[data-canvas-click-shield]` subtree.
    // That guard is an ancestor walk from `event.target`, and the swap
    // below DETACHES the placeholder mid-dispatch, so by the time the
    // event bubbles up its target has no ancestors left, the shield is
    // unreachable, and the panel the operator was reading closes under
    // them. Stopping here also states the right thing: a click on the
    // chip is an answer to this affordance, not a background click.
    event.stopPropagation();

    // Re-validate: only `http(s)` ever becomes a request, whatever the
    // attribute currently holds.
    const src = httpUrlOrNull(placeholder.getAttribute('data-sm-img-src'));
    if (src === null) return;

    const img = document.createElement('img');
    img.alt = placeholderLabel(placeholder);
    img.className = 'sm-md-img__loaded';
    img.setAttribute('data-testid', 'markdown-image-loaded');
    // `referrerpolicy` BEFORE `src`: a browser starts the fetch as soon
    // as `src` is set, even on a detached element, so setting the policy
    // afterwards would race the request it is meant to cover.
    img.setAttribute('referrerpolicy', 'no-referrer');
    img.src = src;
    placeholder.replaceWith(img);
  }
}

/**
 * Alt text for the loaded image, read back from the chip the operator
 * clicked so the accessible name survives the swap. Falls back to the
 * generic label when the chip carries no label span.
 */
function placeholderLabel(placeholder: Element): string {
  const label = placeholder.querySelector('.sm-md-img__label')?.textContent?.trim();
  return label !== undefined && label.length > 0 ? label : MARKDOWN_TEXTS.imageFallbackLabel;
}
