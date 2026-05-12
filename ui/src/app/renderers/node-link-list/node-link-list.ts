import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import type { IRendererInputs } from '../../slots/slot-renderer-map';
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
 * Renderer for the `inspector.body.panel.link-list` slot. Clickable
 * list of in-scope node paths. Caps already enforced at emit time
 * (≤ 100 entries, path ≤ 512 chars).
 *
 * Per the renderer attr-sanitization rule (isolation rule #6), we
 * never bind `path` to a raw `[href]`. The renderer is part of the
 * shell's closed renderer catalog (not plugin code), so it injects
 * `Router` directly and navigates on click. `NgComponentOutlet`
 * (used by `view-contributions-host`) does not propagate outputs,
 * so an `output<>()` here would be unreachable.
 */
@Component({
  selector: 'sm-node-link-list',
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
              <button type="button" class="vc-links__btn" (click)="onOpenPath(e.path)">
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
      border-radius: var(--sm-radius-md); color: var(--p-primary-600); cursor: pointer;
      text-align: left; width: 100%; }
    .vc-links__btn:hover { background: var(--p-surface-100); }
    .vc-links__kind { color: var(--p-surface-500);
      font-family: var(--p-font-family-mono); font-size: 0.75rem; }
    .vc-links__label { word-break: break-all; }
    .vc-links__empty { color: var(--p-surface-500); font-size: 0.85rem;
      margin: 0; }
  `],
})
export class NodeLinkList {
  private readonly router = inject(Router);

  readonly inputs = input.required<IRendererInputs>();

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

  protected onOpenPath(path: string): void {
    void this.router.navigate(['/graph'], { queryParams: { path } });
  }
}
