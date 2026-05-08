import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import type { IRendererInputs } from '../../contracts/contract-renderer-map';

interface IPerNodeTagPayload {
  label: string;
  severity?: 'info' | 'warn' | 'success' | 'danger';
  tooltip?: string;
}

/**
 * Renderer for `per-node-tag`. Single chip with a qualitative label
 * and optional severity tint. Surfaces in `card.chip` and
 * `inspector.header.badge`.
 */
@Component({
  selector: 'sm-per-node-tag',
  standalone: true,
  imports: [TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="vc-tag"
      [class.vc-tag--info]="severity() === 'info'"
      [class.vc-tag--warn]="severity() === 'warn'"
      [class.vc-tag--success]="severity() === 'success'"
      [class.vc-tag--danger]="severity() === 'danger'"
      [pTooltip]="resolvedTooltip()"
      [attr.data-testid]="'renderer-per-node-tag'"
    >
      @if (icon()) {
        <span class="vc-tag__icon" aria-hidden="true">{{ icon() }}</span>
      }
      <span class="vc-tag__label">{{ label() }}</span>
    </span>
  `,
  styles: [`
    .vc-tag { display: inline-flex; align-items: center; gap: 0.25rem;
      padding: 0.125rem 0.5rem; border-radius: 0.75rem; font-size: 0.85rem;
      background: var(--p-surface-100); color: var(--p-surface-700); }
    .vc-tag--info    { background: var(--p-blue-100); color: var(--p-blue-700); }
    .vc-tag--warn    { background: var(--p-yellow-100); color: var(--p-yellow-800); }
    .vc-tag--success { background: var(--p-green-100); color: var(--p-green-700); }
    .vc-tag--danger  { background: var(--p-red-100); color: var(--p-red-700); }
  `],
})
export class PerNodeTag {
  readonly inputs = input.required<IRendererInputs>();

  protected readonly typed = computed<IPerNodeTagPayload>(() => {
    const p = this.inputs().payload;
    if (typeof p !== 'object' || p === null) return { label: '' };
    return p as IPerNodeTagPayload;
  });

  protected readonly label = computed(() => this.typed().label || '');
  protected readonly icon = computed(() => this.inputs().icon);
  protected readonly severity = computed(() => this.typed().severity);
  protected readonly resolvedTooltip = computed(
    () => this.typed().tooltip ?? this.inputs().tooltip ?? '',
  );
}
