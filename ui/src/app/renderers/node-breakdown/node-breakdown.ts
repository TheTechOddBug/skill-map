import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { IRendererInputs } from '../../slots/slot-renderer-map';
import { isArrayField, isObjectPayload } from '../../slots/renderer-payload-guards';
import { VIEW_CONTRIBUTIONS_TEXTS } from '../../../i18n/view-contributions.texts';

interface IBreakdownEntry {
  label: string;
  value: number;
  tooltip?: string;
}

interface INodeBreakdownPayload {
  entries: IBreakdownEntry[];
}

/**
 * Renderer for the `inspector.body.panel.breakdown` slot. Horizontal
 * bar chart of labeled counts.
 *
 * Bars are width-relative to the max value in the slice (no axes,
 * no scale legend). Hard cap of 20 entries enforced at the kernel
 * via the AJV payload schema; this renderer trusts the input.
 */
@Component({
  selector: 'sm-node-breakdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="vc-breakdown" [attr.data-testid]="'renderer-node-breakdown'">
      @if (label()) {
        <h5 class="vc-breakdown__header">{{ label() }}</h5>
      }
      @if (entries().length === 0) {
        <p class="vc-breakdown__empty">{{ emptyText() }}</p>
      } @else {
        <ul class="vc-breakdown__rows">
          @for (e of entries(); track e.label) {
            <li class="vc-breakdown__row" [attr.title]="e.tooltip ?? ''">
              <span class="vc-breakdown__label">{{ e.label }}</span>
              <span class="vc-breakdown__bar-track">
                <span
                  class="vc-breakdown__bar"
                  [style.width.%]="percent(e.value)"
                  aria-hidden="true"
                ></span>
              </span>
              <span class="vc-breakdown__value">{{ e.value }}</span>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [`
    .vc-breakdown__header { font-size: 0.85rem; color: var(--p-surface-700);
      margin: 0 0 0.5rem; }
    .vc-breakdown__rows { list-style: none; padding: 0; margin: 0;
      display: flex; flex-direction: column; gap: 0.25rem; }
    .vc-breakdown__row { display: grid;
      grid-template-columns: minmax(4rem, 0.4fr) 1fr 3rem;
      align-items: center; gap: 0.5rem; font-size: 0.85rem; }
    .vc-breakdown__label { color: var(--p-surface-700); white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis; }
    .vc-breakdown__bar-track { background: var(--p-surface-100);
      border-radius: var(--sm-radius-md); height: 0.625rem; overflow: hidden; }
    .vc-breakdown__bar { display: block; height: 100%;
      background: var(--p-primary-500); }
    .vc-breakdown__value { text-align: right; color: var(--p-surface-600); }
    .vc-breakdown__empty { color: var(--p-surface-500); font-size: 0.85rem;
      margin: 0; }
  `],
})
export class NodeBreakdown {
  readonly inputs = input.required<IRendererInputs>();

  protected readonly typed = computed<INodeBreakdownPayload>(() => {
    const p = this.inputs().payload;
    if (!isObjectPayload(p)) return { entries: [] };
    // `entries` must be an array, the template @for over it would
    // throw otherwise. A non-array drops to the empty-text branch.
    if (!isArrayField(p, 'entries')) return { entries: [] };
    return p as unknown as INodeBreakdownPayload;
  });

  protected readonly entries = computed(() => this.typed().entries ?? []);
  protected readonly label = computed(() => this.inputs().label);
  protected readonly emptyText = computed(
    () => this.inputs().emptyText ?? VIEW_CONTRIBUTIONS_TEXTS.emptyDefault,
  );

  protected readonly maxValue = computed(() => {
    const list = this.entries();
    return list.reduce((m, e) => (e.value > m ? e.value : m), 0);
  });

  protected percent(value: number): number {
    const max = this.maxValue();
    if (max === 0) return 0;
    return Math.round((value / max) * 100);
  }
}
