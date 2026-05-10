import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { IRendererInputs } from '../../slots/slot-renderer-map';
import { VIEW_CONTRIBUTIONS_TEXTS } from '../../../i18n/view-contributions.texts';

interface IColumnDecl {
  key: string;
  label: string;
}

interface INodeRecordsPayload {
  columns: IColumnDecl[];
  rows: Array<Record<string, string | number | boolean | null>>;
}

/**
 * Renderer for the `inspector.body.panel.records` slot. Compact
 * table — caps already enforced at emit time (≤6 cols, ≤50 rows).
 *
 * Cell rendering: scalar values via interpolation (auto-sanitized
 * text). Per the renderer attr-sanitization rule (isolation rule #6),
 * we never bind cell values to `[innerHTML]` / `[style]` / `[src]` /
 * `[href]`.
 */
@Component({
  selector: 'sm-node-records',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="vc-records" [attr.data-testid]="'renderer-node-records'">
      @if (label()) {
        <h5 class="vc-records__header">{{ label() }}</h5>
      }
      @if (rows().length === 0) {
        <p class="vc-records__empty">{{ emptyText() }}</p>
      } @else {
        <table class="vc-records__table">
          <thead>
            <tr>
              @for (col of columns(); track col.key) {
                <th>{{ col.label }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track $index) {
              <tr>
                @for (col of columns(); track col.key) {
                  <td>{{ formatCell(row[col.key]) }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      }
    </section>
  `,
  styles: [`
    .vc-records__header { font-size: 0.85rem; color: var(--p-surface-700);
      margin: 0 0 0.5rem; }
    .vc-records__table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .vc-records__table th { text-align: left; padding: 0.25rem 0.5rem;
      border-bottom: 1px solid var(--p-surface-200);
      color: var(--p-surface-700); font-weight: 600; }
    .vc-records__table td { padding: 0.25rem 0.5rem;
      border-bottom: 1px solid var(--p-surface-100);
      color: var(--p-surface-800); white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis; max-width: 16rem; }
    .vc-records__empty { color: var(--p-surface-500); font-size: 0.85rem;
      margin: 0; }
  `],
})
export class NodeRecords {
  readonly inputs = input.required<IRendererInputs>();

  protected readonly typed = computed<INodeRecordsPayload>(() => {
    const p = this.inputs().payload;
    if (typeof p !== 'object' || p === null) return { columns: [], rows: [] };
    return p as INodeRecordsPayload;
  });

  protected readonly columns = computed(() => this.typed().columns ?? []);
  protected readonly rows = computed(() => this.typed().rows ?? []);
  protected readonly label = computed(() => this.inputs().label);
  protected readonly emptyText = computed(
    () => this.inputs().emptyText ?? VIEW_CONTRIBUTIONS_TEXTS.emptyDefault,
  );

  protected formatCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? '✓' : '·';
    return String(value);
  }
}
