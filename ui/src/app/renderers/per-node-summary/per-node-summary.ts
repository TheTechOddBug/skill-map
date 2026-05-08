import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { IRendererInputs } from '../../contracts/contract-renderer-map';
import { VIEW_CONTRIBUTIONS_TEXTS } from '../../../i18n/view-contributions.texts';

interface IPerNodeSummaryPayload {
  markdown: string;
}

/**
 * Renderer for `per-node-summary`. Renders sanitized markdown text
 * (≤ 4096 chars cap enforced at emit time). Surfaces in
 * `inspector.body`.
 *
 * **Renderer attr-sanitization rule (isolation rule #6)** — we MUST
 * NOT bind to `[innerHTML]`. The cheapest safe path renders the
 * markdown as preformatted text via interpolation (auto-sanitized).
 * A full markdown-to-HTML pass would require a sanitizer pipeline
 * with allow-list (paragraphs / headings ≤H3 / lists / inline code /
 * fenced code / emphasis / strong / blockquote). Phase 4 ships the
 * preformatted fallback; the rich rendering lands in a follow-up
 * after the sanitizer pipeline is in place.
 */
@Component({
  selector: 'sm-per-node-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="vc-summary" [attr.data-testid]="'renderer-per-node-summary'">
      @if (label()) {
        <h5 class="vc-summary__header">{{ label() }}</h5>
      }
      @if (!markdown()) {
        <p class="vc-summary__empty">{{ emptyText() }}</p>
      } @else {
        <pre class="vc-summary__body">{{ markdown() }}</pre>
      }
    </section>
  `,
  styles: [`
    .vc-summary__header { font-size: 0.85rem; color: var(--p-surface-700);
      margin: 0 0 0.5rem; }
    .vc-summary__body { font-size: 0.85rem; color: var(--p-surface-800);
      background: var(--p-surface-50); padding: 0.5rem;
      border-radius: 0.25rem; white-space: pre-wrap; word-break: break-word;
      margin: 0; max-height: 12rem; overflow: auto; }
    .vc-summary__empty { color: var(--p-surface-500); font-size: 0.85rem;
      margin: 0; }
  `],
})
export class PerNodeSummary {
  readonly inputs = input.required<IRendererInputs>();

  protected readonly typed = computed<IPerNodeSummaryPayload>(() => {
    const p = this.inputs().payload;
    if (typeof p !== 'object' || p === null) return { markdown: '' };
    return p as IPerNodeSummaryPayload;
  });

  protected readonly markdown = computed(() => this.typed().markdown ?? '');
  protected readonly label = computed(() => this.inputs().label);
  protected readonly emptyText = computed(
    () => this.inputs().emptyText ?? VIEW_CONTRIBUTIONS_TEXTS.emptyDefault,
  );
}
