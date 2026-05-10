import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import type { IRendererInputs } from '../../slots/slot-renderer-map';
import { IconGlyph } from '../../slots/icon-glyph';

interface IScopeStatPayload {
  value: number | string;
  label?: string;
  tooltip?: string;
  severity?: 'info' | 'warn' | 'success' | 'danger';
}

/**
 * Renderer for `scope-stat`. Single chip in the topbar carrying a
 * scope-wide value (total node count, last-sync timestamp, etc.).
 * Emitted ONCE per scan via `ctx.emitScopeContribution(...)` (rules
 * only — extractors do not see scope-level emit).
 *
 * Surfaces in `topbar.nav.start`. Cap 3 per scope (slot config).
 */
@Component({
  selector: 'sm-scope-stat',
  standalone: true,
  imports: [TooltipModule, IconGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="vc-stat"
      [class.vc-stat--info]="severity() === 'info'"
      [class.vc-stat--warn]="severity() === 'warn'"
      [class.vc-stat--success]="severity() === 'success'"
      [class.vc-stat--danger]="severity() === 'danger'"
      [pTooltip]="resolvedTooltip()"
      [attr.data-testid]="'renderer-scope-stat'"
    >
      <sm-icon-glyph [icon]="icon()" hostClass="vc-stat__icon" />
      <span class="vc-stat__value">{{ value() }}</span>
      @if (label()) {
        <span class="vc-stat__label">{{ label() }}</span>
      }
    </span>
  `,
  styles: [`
    .vc-stat { display: inline-flex; align-items: center; gap: 0.25rem;
      padding: 0.125rem 0.5rem; border-radius: 0.75rem; font-size: 0.85rem;
      background: var(--p-surface-100); color: var(--p-surface-800); }
    .vc-stat__label { color: var(--p-surface-500); font-size: 0.8rem; }
    .vc-stat--info    { background: var(--p-blue-100); color: var(--p-blue-700); }
    .vc-stat--warn    { background: var(--p-yellow-100); color: var(--p-yellow-800); }
    .vc-stat--success { background: var(--p-green-100); color: var(--p-green-700); }
    .vc-stat--danger  { background: var(--p-red-100); color: var(--p-red-700); }
  `],
})
export class ScopeStat {
  readonly inputs = input.required<IRendererInputs>();

  protected readonly typed = computed<IScopeStatPayload>(() => {
    const p = this.inputs().payload;
    if (typeof p !== 'object' || p === null) return { value: '' };
    return p as IScopeStatPayload;
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
