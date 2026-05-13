import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { IRendererInputs } from '../../slots/slot-renderer-map';
import { isObjectPayload, isStringField } from '../../slots/renderer-payload-guards';
import { VIEW_CONTRIBUTIONS_TEXTS } from '../../../i18n/view-contributions.texts';

interface INodeMarkdownPayload {
  markdown: string;
}

/**
 * Renderer for the `inspector.body.panel.markdown` slot. Renders
 * sanitized markdown text (≤ 4096 chars cap enforced at emit time).
 *
 * **Renderer attr-sanitization rule (isolation rule #6)**, we MUST
 * NOT bind to `[innerHTML]`. The cheapest safe path renders the
 * markdown as preformatted text via interpolation (auto-sanitized).
 * A full markdown-to-HTML pass would require a sanitizer pipeline
 * with allow-list (paragraphs / headings ≤H3 / lists / inline code /
 * fenced code / emphasis / strong / blockquote). Phase 4 ships the
 * preformatted fallback; the rich rendering lands in a follow-up
 * after the sanitizer pipeline is in place.
 */
@Component({
  selector: 'sm-node-markdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="vc-markdown" [attr.data-testid]="'renderer-node-markdown'">
      @if (label()) {
        <h5 class="vc-markdown__header">{{ label() }}</h5>
      }
      @if (!markdown()) {
        <p class="vc-markdown__empty">{{ emptyText() }}</p>
      } @else {
        <pre class="vc-markdown__body">{{ markdown() }}</pre>
      }
    </section>
  `,
  styles: [`
    .vc-markdown__header { font-size: 0.85rem; color: var(--p-surface-700);
      margin: 0 0 0.5rem; }
    .vc-markdown__body { font-size: 0.85rem; color: var(--p-surface-800);
      background: var(--p-surface-50); padding: 0.5rem;
      border-radius: var(--sm-radius-md); white-space: pre-wrap; word-break: break-word;
      margin: 0; max-height: 12rem; overflow: auto; }
    .vc-markdown__empty { color: var(--p-surface-500); font-size: 0.85rem;
      margin: 0; }
  `],
})
export class NodeMarkdown {
  readonly inputs = input.required<IRendererInputs>();

  protected readonly typed = computed<INodeMarkdownPayload>(() => {
    const p = this.inputs().payload;
    if (!isObjectPayload(p)) return { markdown: '' };
    // The `<pre>` interpolation would render `[object Object]` if
    // `markdown` arrived as a non-string; drop to the empty branch
    // instead.
    if (!isStringField(p, 'markdown')) return { markdown: '' };
    return p as unknown as INodeMarkdownPayload;
  });

  protected readonly markdown = computed(() => this.typed().markdown ?? '');
  protected readonly label = computed(() => this.inputs().label);
  protected readonly emptyText = computed(
    () => this.inputs().emptyText ?? VIEW_CONTRIBUTIONS_TEXTS.emptyDefault,
  );
}
