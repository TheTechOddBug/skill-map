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
 *
 * **The swap is also a focus and status event** (WCAG 2.4.3 + 4.1.3).
 * Activating the chip DESTROYS the control that was focused, so without
 * deliberate handling focus falls to `<body>` and the next Tab restarts
 * from the skip link at the top of the document: in a long README with
 * several images that is one full restart per image. And because the
 * control simply vanishes, a screen-reader user is told nothing at all,
 * not that the image loaded, not that it failed, not what it shows. So
 * this directive owns two extra obligations beyond the swap:
 *
 *   - the replacement `<img>` carries `tabindex="-1"` and takes focus,
 *     so the reading position survives the gesture;
 *   - the outcome is announced through `A11yAnnouncerService`, polite on
 *     load, assertive on error (a broken remote image is otherwise
 *     completely invisible to assistive tech, and it is the one outcome
 *     the operator explicitly asked for and did not get).
 */

import { Directive, inject } from '@angular/core';

import { MARKDOWN_TEXTS } from '../../i18n/markdown.texts';
import { httpUrlOrNull } from '../../services/url-guard';
import { A11yAnnouncerService } from '../services/a11y-announcer';

/** Placeholder chip that carries a loadable URL (interactive mode only). */
const PLACEHOLDER_SELECTOR = '.sm-md-img[data-sm-img-src]';

@Directive({
  selector: '[smMarkdownImages]',
  host: {
    '(click)': 'onClick($event)',
  },
})
export class MarkdownImagesDirective {
  private readonly announcer = inject(A11yAnnouncerService);

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

    const label = placeholderLabel(placeholder);
    // `src` already passed `httpUrlOrNull`, so `new URL` cannot throw and
    // the host is the same string the chip displayed before the click.
    const host = new URL(src).host;

    const img = document.createElement('img');
    img.alt = label;
    img.className = 'sm-md-img__loaded';
    img.setAttribute('data-testid', 'markdown-image-loaded');
    // Focus destination for the control this swap is about to destroy.
    // `-1` keeps the image OUT of the tab order (it is content, not a
    // control) while still making it programmatically focusable, so the
    // caret lands here and the next Tab continues from this point in the
    // document instead of restarting at the skip link.
    img.setAttribute('tabindex', '-1');
    // Outcome listeners BEFORE `src`, same reasoning as the policy below:
    // the fetch is live from the assignment onward, and a response that
    // arrives before the listeners exist would be announced to nobody.
    // `once` because an `<img>` fires exactly one of the two and the
    // element is never re-pointed at another URL.
    img.addEventListener(
      'load',
      () => this.announcer.announce(MARKDOWN_TEXTS.imageLoadedAnnouncement(label)),
      { once: true },
    );
    img.addEventListener(
      'error',
      () =>
        this.announcer.announce(
          MARKDOWN_TEXTS.imageLoadFailedAnnouncement(label, host),
          'assertive',
        ),
      { once: true },
    );
    // `referrerpolicy` BEFORE `src`: a browser starts the fetch as soon
    // as `src` is set, even on a detached element, so setting the policy
    // afterwards would race the request it is meant to cover.
    img.setAttribute('referrerpolicy', 'no-referrer');
    img.src = src;
    placeholder.replaceWith(img);
    // AFTER the insertion, never before: `focus()` on a node that is not
    // in the document is a silent no-op.
    img.focus();
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
