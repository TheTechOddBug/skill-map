import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { IRendererInputs } from '../../slots/slot-renderer-map';
import { isArrayField, isObjectPayload } from '../../slots/renderer-payload-guards';
import { VIEW_CONTRIBUTIONS_TEXTS } from '../../../i18n/view-contributions.texts';

interface IColumnDecl {
  key: string;
  label: string;
}

interface INodeRecordsPayload {
  columns: IColumnDecl[];
  rows: Array<Record<string, string | number | boolean | null>>;
}

type TCellKind = 'empty' | 'bool-true' | 'bool-false' | 'text';

/**
 * Renderer for the `inspector.body.panel.records` slot. Compact
 * table, caps already enforced at emit time (≤6 cols, ≤50 rows).
 *
 * Cell rendering: scalar values via interpolation (auto-sanitized
 * text). Boolean values render as `pi-check` / `pi-minus` PrimeIcons
 * with an aria-label fallback for screen readers. Per the renderer
 * attr-sanitization rule (isolation rule #6), we never bind cell
 * values to `[innerHTML]` / `[style]` / `[src]` / `[href]`.
 */
@Component({
  selector: 'sm-node-records',
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
                  <td>
                    @switch (cellKind(row[col.key])) {
                      @case ('bool-true') {
                        <i class="pi pi-check vc-records__bool vc-records__bool--true"
                           role="img"
                           [attr.aria-label]="texts.boolTrue"></i>
                      }
                      @case ('bool-false') {
                        <i class="pi pi-minus vc-records__bool vc-records__bool--false"
                           role="img"
                           [attr.aria-label]="texts.boolFalse"></i>
                      }
                      @case ('empty') {}
                      @default {
                        {{ cellText(row[col.key]) }}
                      }
                    }
                  </td>
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
    .vc-records__bool { font-size: 0.9rem; line-height: 1; }
    .vc-records__bool--true { color: var(--p-primary-color); }
    .vc-records__bool--false { color: var(--p-text-muted-color); }
  `],
})
export class NodeRecords {
  readonly inputs = input.required<IRendererInputs>();

  protected readonly typed = computed<INodeRecordsPayload>(() => {
    const p = this.inputs().payload;
    if (!isObjectPayload(p)) return { columns: [], rows: [] };
    // Both `columns` and `rows` MUST be arrays, the template iterates
    // each. A malformed top-level shape drops to the empty branch
    // instead of throwing inside `@for`.
    if (!isArrayField(p, 'columns') || !isArrayField(p, 'rows')) {
      return { columns: [], rows: [] };
    }
    return p as unknown as INodeRecordsPayload;
  });

  protected readonly columns = computed(() => this.typed().columns ?? []);
  protected readonly rows = computed(() => this.typed().rows ?? []);
  protected readonly label = computed(() => this.inputs().label);
  protected readonly emptyText = computed(
    () => this.inputs().emptyText ?? VIEW_CONTRIBUTIONS_TEXTS.emptyDefault,
  );
  protected readonly texts = VIEW_CONTRIBUTIONS_TEXTS.recordsCell;

  protected cellKind(value: unknown): TCellKind {
    if (value === null || value === undefined) return 'empty';
    if (typeof value === 'boolean') return value ? 'bool-true' : 'bool-false';
    return 'text';
  }

  protected cellText(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value);
  }
}
