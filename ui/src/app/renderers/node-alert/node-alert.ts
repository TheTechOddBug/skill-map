import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import type { IRendererInputs } from '../../slots/slot-renderer-map';
import { Icon } from '../../slots/icon';

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
  imports: [TooltipModule, Icon],
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
      <sm-icon [icon]="icon()" hostClass="vc-alert__icon" />
      @if (count() !== null) {
        <span class="vc-alert__count">{{ formattedCount() }}</span>
      }
    </span>
  `,
  styles: [`
    /* Corner badge on the graph node. NO tinted wrapper — severity
       drives the glyph + count color directly, leaving the surrounding
       chrome quiet. */
    .vc-alert { display: inline-flex; align-items: center;
      justify-content: center; gap: 0.125rem;
      min-width: 1.1rem; min-height: 1.1rem; font-size: 0.85rem;
      color: var(--p-surface-700); }
    .vc-alert--info    { color: var(--sm-severity-info); }
    .vc-alert--warn    { color: var(--sm-severity-warn); }
    .vc-alert--success { color: var(--sm-severity-success); }
    .vc-alert--danger  { color: var(--sm-severity-error); }
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
