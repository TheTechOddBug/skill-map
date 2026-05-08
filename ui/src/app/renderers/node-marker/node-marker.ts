import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import type { IRendererInputs } from '../../contracts/contract-renderer-map';

interface INodeMarkerPayload {
  icon?: string;
  severity?: 'info' | 'warn' | 'success' | 'danger';
  count?: number;
  tooltip?: string;
}

/**
 * Renderer for `node-marker`. Small corner badge on graph nodes —
 * icon, optional count (1-99 enforced at emit time), severity tint.
 * Surfaces in `graph.node.marker`. Hard cap 1 marker per node per
 * extension (slot config enforces).
 */
@Component({
  selector: 'sm-node-marker',
  standalone: true,
  imports: [TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="vc-marker"
      [class.vc-marker--info]="severity() === 'info'"
      [class.vc-marker--warn]="severity() === 'warn'"
      [class.vc-marker--success]="severity() === 'success'"
      [class.vc-marker--danger]="severity() === 'danger'"
      [pTooltip]="resolvedTooltip()"
      [attr.data-testid]="'renderer-node-marker'"
    >
      @if (icon()) {
        <span class="vc-marker__icon" aria-hidden="true">{{ icon() }}</span>
      }
      @if (count() !== null) {
        <span class="vc-marker__count">{{ formattedCount() }}</span>
      }
    </span>
  `,
  styles: [`
    .vc-marker { display: inline-flex; align-items: center;
      justify-content: center; gap: 0.125rem;
      min-width: 1rem; min-height: 1rem; padding: 0.05rem 0.25rem;
      border-radius: 0.5rem; font-size: 0.7rem;
      background: var(--p-surface-200); color: var(--p-surface-800); }
    .vc-marker--info    { background: var(--p-blue-200); color: var(--p-blue-800); }
    .vc-marker--warn    { background: var(--p-yellow-200); color: var(--p-yellow-900); }
    .vc-marker--success { background: var(--p-green-200); color: var(--p-green-800); }
    .vc-marker--danger  { background: var(--p-red-200); color: var(--p-red-800); }
  `],
})
export class NodeMarker {
  readonly inputs = input.required<IRendererInputs>();

  protected readonly typed = computed<INodeMarkerPayload>(() => {
    const p = this.inputs().payload;
    if (typeof p !== 'object' || p === null) return {};
    return p as INodeMarkerPayload;
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
