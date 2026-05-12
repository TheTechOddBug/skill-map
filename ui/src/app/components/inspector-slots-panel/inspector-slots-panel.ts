/**
 * `<sm-inspector-slots-panel>` — single mount point for the six
 * inspector-body view-contribution sub-slots. Extracted from
 * `inspector-view.html` so the parent template reads as a row of
 * components rather than a stack of `<sm-view-contributions-host>`
 * invocations.
 *
 * The slot list lives here so adding / removing a sub-slot stays a
 * one-file change. Each host self-hides when its slot has no matching
 * contributions — the parent gates the surrounding `<p-card>` chrome
 * via `InspectorView.hasViewContributions()` so the whole row only
 * paints when at least one slot is non-empty.
 */

import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import {
  ViewContributionsHost,
  type IHostNode,
} from '../view-contributions-host/view-contributions-host';

@Component({
  selector: 'sm-inspector-slots-panel',
  imports: [ViewContributionsHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sm-view-contributions-host slot="inspector.body.panel.breakdown" [node]="node()" />
    <sm-view-contributions-host slot="inspector.body.panel.records" [node]="node()" />
    <sm-view-contributions-host slot="inspector.body.panel.tree" [node]="node()" />
    <sm-view-contributions-host slot="inspector.body.panel.key-values" [node]="node()" />
    <sm-view-contributions-host slot="inspector.body.panel.link-list" [node]="node()" />
    <sm-view-contributions-host slot="inspector.body.panel.markdown" [node]="node()" />
  `,
})
export class InspectorSlotsPanel {
  readonly node = input<IHostNode | null>(null);
}
