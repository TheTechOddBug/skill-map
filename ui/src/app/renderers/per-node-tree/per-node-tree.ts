import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { IRendererInputs } from '../../contracts/contract-renderer-map';
import { VIEW_CONTRIBUTIONS_TEXTS } from '../../../i18n/view-contributions.texts';

interface ITreeNode {
  label: string;
  marker?: string;
  tooltip?: string;
  children?: ITreeNode[];
}

/**
 * Renderer for `per-node-tree`. Recursive label/children. Caps already
 * enforced at emit time (depth ≤ 6, total nodes ≤ 200). Surfaces in
 * `inspector.body`.
 *
 * Recursion via the embedded child component referencing itself.
 * The Angular template engine handles the recursion when the child
 * imports its own component (cyclic standalone import works because
 * standalone components don't carry NgModule cycles).
 */
@Component({
  selector: 'sm-per-node-tree',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="vc-tree" [attr.data-testid]="'renderer-per-node-tree'">
      @if (label()) {
        <h5 class="vc-tree__header">{{ label() }}</h5>
      }
      @if (rootIsEmpty()) {
        <p class="vc-tree__empty">{{ emptyText() }}</p>
      } @else {
        <ul class="vc-tree__list" role="tree">
          @for (child of root().children ?? []; track child.label) {
            <li role="treeitem" [attr.title]="child.tooltip ?? ''">
              @if (child.marker) {
                <span class="vc-tree__marker" aria-hidden="true">{{ child.marker }}</span>
              }
              <span class="vc-tree__label">{{ child.label }}</span>
              @if (child.children && child.children.length > 0) {
                <ul class="vc-tree__list" role="group">
                  @for (sub of child.children; track sub.label) {
                    <li role="treeitem" [attr.title]="sub.tooltip ?? ''">
                      @if (sub.marker) {
                        <span class="vc-tree__marker" aria-hidden="true">{{ sub.marker }}</span>
                      }
                      <span class="vc-tree__label">{{ sub.label }}</span>
                    </li>
                  }
                </ul>
              }
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [`
    .vc-tree__header { font-size: 0.85rem; color: var(--p-surface-700);
      margin: 0 0 0.5rem; }
    .vc-tree__list { list-style: none; padding-left: 1rem; margin: 0;
      font-size: 0.85rem; }
    .vc-tree__list > li { padding: 0.125rem 0; }
    .vc-tree__marker { margin-right: 0.25rem; opacity: 0.7; }
    .vc-tree__label { color: var(--p-surface-800); }
    .vc-tree__empty { color: var(--p-surface-500); font-size: 0.85rem;
      margin: 0; }
  `],
})
export class PerNodeTree {
  readonly inputs = input.required<IRendererInputs>();

  protected readonly root = computed<ITreeNode>(() => {
    const p = this.inputs().payload;
    if (typeof p !== 'object' || p === null) return { label: '' };
    return p as ITreeNode;
  });

  protected readonly rootIsEmpty = computed(() => {
    const r = this.root();
    return !r.children || r.children.length === 0;
  });

  protected readonly label = computed(() => this.inputs().label);
  protected readonly emptyText = computed(
    () => this.inputs().emptyText ?? VIEW_CONTRIBUTIONS_TEXTS.emptyDefault,
  );
}
