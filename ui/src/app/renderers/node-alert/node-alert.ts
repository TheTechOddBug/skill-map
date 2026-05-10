import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import type { IRendererInputs } from '../../slots/slot-renderer-map';
import { IconGlyph } from '../../slots/icon-glyph';

interface INodeAlertPayload {
  icon?: string;
  severity?: 'info' | 'warn' | 'success' | 'danger';
  count?: number;
  tooltip?: string;
}

/**
 * Renderer for `node-alert`. Small corner badge on graph nodes —
 * icon, optional count (1-99 enforced at emit time), severity tint.
 * Surfaces in `graph.node.alert`. Hard cap 1 marker per node per
 * extension (slot config enforces).
 */
@Component({
  selector: 'sm-node-alert',
  standalone: true,
  imports: [TooltipModule, IconGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="vc-alert"
      [class.vc-alert--info]="severity() === 'info'"
      [class.vc-alert--warn]="severity() === 'warn'"
      [class.vc-alert--success]="severity() === 'success'"
      [class.vc-alert--danger]="severity() === 'danger'"
      [pTooltip]="resolvedTooltip()"
      [attr.data-testid]="'renderer-node-alert'"
    >
      <sm-icon-glyph [icon]="icon()" hostClass="vc-alert__icon" />
      @if (count() !== null) {
        <span class="vc-alert__count">{{ formattedCount() }}</span>
      }
    </span>
  `,
  styles: [`
    .vc-alert { display: inline-flex; align-items: center;
      justify-content: center; gap: 0.125rem;
      min-width: 1rem; min-height: 1rem; padding: 0.05rem 0.25rem;
      border-radius: 0.5rem; font-size: 0.7rem;
      background: var(--p-surface-200); color: var(--p-surface-800); }
    .vc-alert--info    { background: var(--p-blue-200); color: var(--p-blue-800); }
    .vc-alert--warn    { background: var(--p-yellow-200); color: var(--p-yellow-900); }
    .vc-alert--success { background: var(--p-green-200); color: var(--p-green-800); }
    .vc-alert--danger  { background: var(--p-red-200); color: var(--p-red-800); }
  `],
})
export class NodeAlert {
  readonly inputs = input.required<IRendererInputs>();

  protected readonly typed = computed<INodeAlertPayload>(() => {
    const p = this.inputs().payload;
    if (typeof p !== 'object' || p === null) return {};
    return p as INodeAlertPayload;
  });

  protected readonly icon = computed(
    () => this.typed().icon ?? this.inputs().icon,
  );
  protected readonly severity = computed(() => this.typed().severity);
  protected readonly count = computed(() => this.typed().count ?? null);
  protected readonly resolvedTooltip = computed(
    () => this.typed().tooltip ?? this.inputs().tooltip ?? '',
  );

  protected readonly formattedCount = computed(() => {
    const c = this.count();
    if (c === null) return '';
    return c >= 99 ? '99+' : String(c);
  });
}
