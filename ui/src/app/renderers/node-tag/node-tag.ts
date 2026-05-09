import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import type { IRendererInputs } from '../../contracts/contract-renderer-map';

interface INodeTagPayload {
  label: string;
  severity?: 'info' | 'warn' | 'success' | 'danger';
  tooltip?: string;
}

/**
 * Renderer for `node-tag`. Single chip with a qualitative label
 * and optional severity tint. Surfaces in `card.footer.left` and
 * `inspector.header.badge`.
 */
@Component({
  selector: 'sm-node-tag',
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
      [attr.data-testid]="'renderer-node-tag'"
    >
      @if (icon()) {
        <span class="vc-tag__icon" aria-hidden="true">{{ icon() }}</span>
      }
      <span class="vc-tag__label">{{ label() }}</span>
    </span>
  `,
  styles: [`
    /* Aligned with .sm-gnode__stat — see node-counter.ts for rationale.
       Tag carries a label instead of a number; layout is otherwise
       identical so chips inside the same slot read uniform. */
    .vc-tag { display: inline-flex; align-items: center; gap: 0.3rem;
      line-height: 1; }
    .vc-tag__icon { font-size: 0.85em; line-height: 1; display: block; }
    .vc-tag__label { font-weight: 500; line-height: 1; display: block; }
    .vc-tag--info {
      background: var(--sm-severity-info-bg);
      color: var(--sm-severity-info);
      padding: 0.1rem 0.4rem; border-radius: 3px;
    }
    .vc-tag--warn {
      background: var(--sm-severity-warn-bg);
      color: var(--sm-severity-warn);
      padding: 0.1rem 0.4rem; border-radius: 3px;
    }
    .vc-tag--success {
      background: var(--sm-severity-success-bg);
      color: var(--sm-severity-success);
      padding: 0.1rem 0.4rem; border-radius: 3px;
    }
    .vc-tag--danger {
      background: var(--sm-severity-error-bg);
      color: var(--sm-severity-error);
      padding: 0.1rem 0.4rem; border-radius: 3px;
    }
  `],
})
export class NodeTag {
  readonly inputs = input.required<IRendererInputs>();

  protected readonly typed = computed<INodeTagPayload>(() => {
    const p = this.inputs().payload;
    if (typeof p !== 'object' || p === null) return { label: '' };
    return p as INodeTagPayload;
  });

  protected readonly label = computed(() => this.typed().label || '');
  protected readonly icon = computed(() => this.inputs().icon);
  protected readonly severity = computed(() => this.typed().severity);
  protected readonly resolvedTooltip = computed(
    () => this.typed().tooltip ?? this.inputs().tooltip ?? '',
  );
}
