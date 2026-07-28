import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { IRendererInputs } from '../../slots/slot-renderer-map';
import { isObjectPayload, isStringField } from '../../slots/renderer-payload-guards';
import { VIEW_CONTRIBUTIONS_TEXTS } from '../../../i18n/view-contributions.texts';

interface ITreeNode {
  label: string;
  marker?: string;
  tooltip?: string;
  children?: ITreeNode[];
}

/**
 * Renderer for the `inspector.body.panel.tree` slot. Recursive
 * label/children. Caps already enforced at emit time
 * (depth ≤ 6, total nodes ≤ 200).
 *
 * Recursion via the embedded child component referencing itself.
 * The Angular template engine handles the recursion when the child
 * imports its own component (cyclic standalone import works because
 * standalone components don't carry NgModule cycles).
 */
@Component({
  selector: 'sm-node-tree',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="vc-tree" [attr.data-testid]="'renderer-node-tree'">
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
    .vc-tree__header { font-size: var(--sm-fs-md); color: var(--p-text-muted-color);
      margin: 0 0 0.5rem; }
    .vc-tree__list { list-style: none; padding-left: 1rem; margin: 0;
      font-size: var(--sm-fs-md); }
    .vc-tree__list > li { padding: 0.125rem 0; }
    .vc-tree__marker { margin-right: 0.25rem; opacity: 0.7; }
    .vc-tree__label { color: var(--p-text-color); }
    .vc-tree__empty { color: var(--p-text-muted-color); font-size: var(--sm-fs-md);
      margin: 0; }
  `],
})
export class NodeTree {
  readonly inputs = input.required<IRendererInputs>();

  protected readonly root = computed<ITreeNode>(() => {
    const p = this.inputs().payload;
    if (!isObjectPayload(p)) return { label: '' };
    // Guard the only field the template reads structurally: `label`
    // (string) and `children` (array, if present). A wildly malformed
    // payload (e.g. children is a number) drops to the empty branch.
    if (!isStringField(p, 'label')) return { label: '' };
    if (p['children'] !== undefined && !Array.isArray(p['children'])) {
      return { label: '' };
    }
    return p as unknown as ITreeNode;
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
