import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import type { IRendererInputs } from '../../contracts/contract-renderer-map';

/**
 * Renderer for `node-counter`. Payload shape:
 *   `{ value: integer ≥ 0, severity?, tooltip? }`.
 *
 * Displays as `<icon> <value>` matching the look of the hardcoded
 * `.sm-gnode__stat` rows in the card footer. The manifest-declared
 * `label` is metadata (docs / plugin-doctor / aria) and is NOT rendered
 * inline — kept off-screen as `aria-label` on the value. Severity is
 * applied only when the host passes it through (`SLOT_REGISTRY[slot]
 * .respectSeverity !== false`); otherwise the host strips it before
 * the renderer sees the payload.
 */
interface INodeCounterPayload {
  value: number;
  tooltip?: string;
  severity?: 'info' | 'warn' | 'success' | 'danger';
}

@Component({
  selector: 'sm-node-counter',
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
      [attr.data-testid]="'renderer-node-counter'"
    >
      @if (icon()) {
        <span class="vc-counter__icon" aria-hidden="true">{{ icon() }}</span>
      }
      <span class="vc-counter__value" [attr.aria-label]="ariaLabel()">{{ value() }}</span>
    </span>
  `,
  styles: [`
    /* Mirror of .sm-gnode__stat in node-card.css. Same rules,
       same selectors-by-role, so the counter reads identically to the
       hardcoded footer stats next to it. Font-size is inherited from
       the slot host (0.7rem inside the footer) — no override here. */
    .vc-counter { display: inline-flex; align-items: center; gap: 0.3rem;
      line-height: 1; }
    .vc-counter__icon { font-size: 0.6rem; line-height: 1; display: block; }
    .vc-counter__value { font-weight: 600; color: var(--p-text-color);
      line-height: 1; display: block; }
    /* Severity overrides — for the value color and the row tint, both
       parallel to .sm-gnode__stat--<sev> + ...-num. */
    .vc-counter--info    .vc-counter__value { color: var(--sm-severity-info); }
    .vc-counter--warn    .vc-counter__value { color: var(--sm-severity-warn); }
    .vc-counter--success .vc-counter__value { color: var(--sm-severity-success); }
    .vc-counter--danger  .vc-counter__value { color: var(--sm-severity-error); }
    .vc-counter--info {
      background: var(--sm-severity-info-bg);
      color: var(--sm-severity-info);
      padding: 0.1rem 0.4rem; border-radius: 3px;
    }
    .vc-counter--warn {
      background: var(--sm-severity-warn-bg);
      color: var(--sm-severity-warn);
      padding: 0.1rem 0.4rem; border-radius: 3px;
    }
    .vc-counter--success {
      background: var(--sm-severity-success-bg);
      color: var(--sm-severity-success);
      padding: 0.1rem 0.4rem; border-radius: 3px;
    }
    .vc-counter--danger {
      background: var(--sm-severity-error-bg);
      color: var(--sm-severity-error);
      padding: 0.1rem 0.4rem; border-radius: 3px;
    }
  `],
})
export class NodeCounter {
  readonly inputs = input.required<IRendererInputs>();

  protected readonly typed = computed<INodeCounterPayload>(() => {
    const p = this.inputs().payload;
    if (typeof p !== 'object' || p === null) return { value: 0 };
    return p as INodeCounterPayload;
  });

  protected readonly value = computed(() => this.typed().value);
  protected readonly icon = computed(() => this.inputs().icon);
  protected readonly severity = computed(() => this.typed().severity);
  protected readonly resolvedTooltip = computed(
    () => this.typed().tooltip ?? this.inputs().tooltip ?? '',
  );
  /** Manifest label as `aria-label` — the inline display went away with
   * the contract narrowing; the metadata still feeds screen readers. */
  protected readonly ariaLabel = computed(() => this.inputs().label ?? '');
}
