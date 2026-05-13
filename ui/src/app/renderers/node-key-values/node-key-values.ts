import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import type { IRendererInputs } from '../../slots/slot-renderer-map';
import { isArrayField, isObjectPayload } from '../../slots/renderer-payload-guards';
import { VIEW_CONTRIBUTIONS_TEXTS } from '../../../i18n/view-contributions.texts';

interface IKvEntry {
  key: string;
  value: string | number | boolean | null;
  tooltip?: string;
}

interface INodeKeyValuesPayload {
  entries: IKvEntry[];
}

/**
 * Renderer for the `inspector.body.panel.key-values` slot. Definition
 * list rendering. Caps already enforced at emit time
 * (≤ 50 entries, value ≤ 512 chars).
 */
@Component({
  selector: 'sm-node-key-values',
  imports: [TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="vc-kv" [attr.data-testid]="'renderer-node-key-values'">
      @if (label()) {
        <h5 class="vc-kv__header">{{ label() }}</h5>
      }
      @if (entries().length === 0) {
        <p class="vc-kv__empty">{{ emptyText() }}</p>
      } @else {
        <dl class="vc-kv__list">
          @for (e of entries(); track e.key) {
            <dt [pTooltip]="e.tooltip ?? ''">{{ e.key }}</dt>
            <dd>{{ formatValue(e.value) }}</dd>
          }
        </dl>
      }
    </section>
  `,
  styles: [`
    .vc-kv__header { font-size: 0.85rem; color: var(--p-surface-700);
      margin: 0 0 0.5rem; }
    .vc-kv__list { display: grid;
      grid-template-columns: minmax(6rem, max-content) 1fr;
      gap: 0.25rem 0.75rem; margin: 0; font-size: 0.85rem; }
    .vc-kv__list dt { color: var(--p-surface-600); font-weight: 500; }
    .vc-kv__list dd { color: var(--p-surface-800); margin: 0;
      word-break: break-word; }
    .vc-kv__empty { color: var(--p-surface-500); font-size: 0.85rem;
      margin: 0; }
  `],
})
export class NodeKeyValues {
  readonly inputs = input.required<IRendererInputs>();

  protected readonly typed = computed<INodeKeyValuesPayload>(() => {
    const p = this.inputs().payload;
    if (!isObjectPayload(p)) return { entries: [] };
    // `entries` MUST be an array — the template @for over it would
    // throw on anything else. Drop to the empty branch.
    if (!isArrayField(p, 'entries')) return { entries: [] };
    return p as unknown as INodeKeyValuesPayload;
  });

  protected readonly entries = computed(() => this.typed().entries ?? []);
  protected readonly label = computed(() => this.inputs().label);
  protected readonly emptyText = computed(
    () => this.inputs().emptyText ?? VIEW_CONTRIBUTIONS_TEXTS.emptyDefault,
  );

  protected formatValue(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
  }
}
