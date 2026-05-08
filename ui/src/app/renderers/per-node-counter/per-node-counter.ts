import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import type { IRendererInputs } from '../../contracts/contract-renderer-map';

/**
 * Renderer for `per-node-counter`. Payload shape:
 *   `{ value: integer ≥ 0, label?, tooltip?, severity? }`.
 *
 * Displays as a single chip: `<icon> <value>` with optional label
 * suffix. Surfaces in `card.chip` and `inspector.header.badge`. The
 * host component decides the slot; this component does not branch
 * on context.
 */
interface IPerNodeCounterPayload {
  value: number;
  label?: string;
  tooltip?: string;
  severity?: 'info' | 'warn' | 'success' | 'danger';
}

@Component({
  selector: 'sm-per-node-counter',
  standalone: true,
  imports: [TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="vc-counter"
      [class.vc-counter--info]="severity() === 'info'"
      [class.vc-counter--warn]="severity() === 'warn'"
      [class.vc-counter--success]="severity() === 'success'"
      [class.vc-counter--danger]="severity() === 'danger'"
      [pTooltip]="resolvedTooltip()"
      [attr.data-testid]="'renderer-per-node-counter'"
    >
      @if (icon()) {
        <span class="vc-counter__icon" aria-hidden="true">{{ icon() }}</span>
      }
      <span class="vc-counter__value">{{ value() }}</span>
      @if (label()) {
        <span class="vc-counter__label">{{ label() }}</span>
      }
    </span>
  `,
  styles: [`
    .vc-counter { display: inline-flex; align-items: center; gap: 0.25rem;
      padding: 0.125rem 0.5rem; border-radius: 0.75rem; font-size: 0.85rem;
      background: var(--p-surface-100); color: var(--p-surface-700); }
    .vc-counter__label { color: var(--p-surface-500); font-size: 0.8rem; }
    .vc-counter--info    { background: var(--p-blue-100); color: var(--p-blue-700); }
    .vc-counter--warn    { background: var(--p-yellow-100); color: var(--p-yellow-800); }
    .vc-counter--success { background: var(--p-green-100); color: var(--p-green-700); }
    .vc-counter--danger  { background: var(--p-red-100); color: var(--p-red-700); }
  `],
})
export class PerNodeCounter {
  readonly inputs = input.required<IRendererInputs>();

  protected readonly typed = computed<IPerNodeCounterPayload>(() => {
    const p = this.inputs().payload;
    if (typeof p !== 'object' || p === null) return { value: 0 };
    return p as IPerNodeCounterPayload;
  });

  protected readonly value = computed(() => this.typed().value);
  protected readonly label = computed(
    () => this.typed().label ?? this.inputs().label,
  );
  protected readonly icon = computed(() => this.inputs().icon);
  protected readonly severity = computed(() => this.typed().severity);
  protected readonly resolvedTooltip = computed(
    () => this.typed().tooltip ?? this.inputs().tooltip ?? '',
  );
}
