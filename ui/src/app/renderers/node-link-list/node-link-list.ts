import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import type { IRendererInputs } from '../../contracts/contract-renderer-map';
import { VIEW_CONTRIBUTIONS_TEXTS } from '../../../i18n/view-contributions.texts';

interface ILinkEntry {
  path: string;
  label?: string;
  kind?: string;
}

interface INodeLinkListPayload {
  entries: ILinkEntry[];
}

/**
 * Renderer for `node-link-list`. Clickable list of in-scope node
 * paths. Surfaces in `inspector.body.panel`. Caps already enforced at emit
 * time (≤ 100 entries, path ≤ 512 chars).
 *
 * Per the renderer attr-sanitization rule (isolation rule #6), we
 * never bind `path` to a raw `[href]`. Click emits `openPath` which
 * the inspector view routes via `Router.navigate` (same pattern as
 * `linked-nodes-panel`).
 */
@Component({
  selector: 'sm-node-link-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="vc-links" [attr.data-testid]="'renderer-node-link-list'">
      @if (label()) {
        <h5 class="vc-links__header">{{ label() }}</h5>
      }
      @if (entries().length === 0) {
        <p class="vc-links__empty">{{ emptyText() }}</p>
      } @else {
        <ul class="vc-links__list">
          @for (e of entries(); track e.path) {
            <li>
              <button type="button" class="vc-links__btn" (click)="openPath.emit(e.path)">
                @if (e.kind) {
                  <span class="vc-links__kind">{{ e.kind }}</span>
                }
                <span class="vc-links__label">{{ e.label ?? e.path }}</span>
              </button>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [`
    .vc-links__header { font-size: 0.85rem; color: var(--p-surface-700);
      margin: 0 0 0.5rem; }
    .vc-links__list { list-style: none; padding: 0; margin: 0;
      display: flex; flex-direction: column; gap: 0.125rem;
      font-size: 0.85rem; }
    .vc-links__btn { display: inline-flex; align-items: center; gap: 0.5rem;
      background: transparent; border: 0; padding: 0.25rem 0.5rem;
      border-radius: 0.25rem; color: var(--p-primary-600); cursor: pointer;
      text-align: left; width: 100%; }
    .vc-links__btn:hover { background: var(--p-surface-100); }
    .vc-links__kind { color: var(--p-surface-500);
      font-family: var(--p-font-family-mono, monospace); font-size: 0.75rem; }
    .vc-links__label { word-break: break-all; }
    .vc-links__empty { color: var(--p-surface-500); font-size: 0.85rem;
      margin: 0; }
  `],
})
export class NodeLinkList {
  readonly inputs = input.required<IRendererInputs>();
  readonly openPath = output<string>();

  protected readonly typed = computed<INodeLinkListPayload>(() => {
    const p = this.inputs().payload;
    if (typeof p !== 'object' || p === null) return { entries: [] };
    return p as INodeLinkListPayload;
  });

  protected readonly entries = computed(() => this.typed().entries ?? []);
  protected readonly label = computed(() => this.inputs().label);
  protected readonly emptyText = computed(
    () => this.inputs().emptyText ?? VIEW_CONTRIBUTIONS_TEXTS.emptyDefault,
  );
}
