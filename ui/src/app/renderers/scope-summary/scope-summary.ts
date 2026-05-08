import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import type { IRendererInputs } from '../../contracts/contract-renderer-map';

interface IScopeSummaryPayload {
  value: number | string;
  label?: string;
  tooltip?: string;
  severity?: 'info' | 'warn' | 'success' | 'danger';
}

/**
 * Renderer for `scope-summary`. Single chip in the topbar carrying a
 * scope-wide value (total node count, last-sync timestamp, etc.).
 * Emitted ONCE per scan via `ctx.emitScopeContribution(...)` (rules
 * only — extractors do not see scope-level emit).
 *
 * Surfaces in `topbar.indicator`. Cap 3 per scope (slot config).
 */
@Component({
  selector: 'sm-scope-summary',
  standalone: true,
  imports: [TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="vc-scope"
      [class.vc-scope--info]="severity() === 'info'"
      [class.vc-scope--warn]="severity() === 'warn'"
      [class.vc-scope--success]="severity() === 'success'"
      [class.vc-scope--danger]="severity() === 'danger'"
      [pTooltip]="resolvedTooltip()"
      [attr.data-testid]="'renderer-scope-summary'"
    >
      @if (icon()) {
        <span class="vc-scope__icon" aria-hidden="true">{{ icon() }}</span>
      }
      <span class="vc-scope__value">{{ value() }}</span>
      @if (label()) {
        <span class="vc-scope__label">{{ label() }}</span>
      }
    </span>
  `,
  styles: [`
    .vc-scope { display: inline-flex; align-items: center; gap: 0.25rem;
      padding: 0.125rem 0.5rem; border-radius: 0.75rem; font-size: 0.85rem;
      background: var(--p-surface-100); color: var(--p-surface-800); }
    .vc-scope__label { color: var(--p-surface-500); font-size: 0.8rem; }
    .vc-scope--info    { background: var(--p-blue-100); color: var(--p-blue-700); }
    .vc-scope--warn    { background: var(--p-yellow-100); color: var(--p-yellow-800); }
    .vc-scope--success { background: var(--p-green-100); color: var(--p-green-700); }
    .vc-scope--danger  { background: var(--p-red-100); color: var(--p-red-700); }
  `],
})
export class ScopeSummary {
  readonly inputs = input.required<IRendererInputs>();

  protected readonly typed = computed<IScopeSummaryPayload>(() => {
    const p = this.inputs().payload;
    if (typeof p !== 'object' || p === null) return { value: '' };
    return p as IScopeSummaryPayload;
  });

  protected readonly value = computed(() => String(this.typed().value ?? ''));
  protected readonly label = computed(
    () => this.typed().label ?? this.inputs().label,
  );
  protected readonly icon = computed(() => this.inputs().icon);
  protected readonly severity = computed(() => this.typed().severity);
  protected readonly resolvedTooltip = computed(
    () => this.typed().tooltip ?? this.inputs().tooltip ?? '',
  );
}
