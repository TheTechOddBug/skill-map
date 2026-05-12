import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import type { IRendererInputs } from '../../slots/slot-renderer-map';
import { Icon } from '../../slots/icon';

interface INodeIconPayload {
  icon?: string;
  severity?: 'info' | 'warn' | 'success' | 'danger';
  tooltip?: string;
}

/**
 * Renderer for the `card.title.right` slot — a small standalone
 * marker rendered immediately after the node title (before the
 * actions cluster: confidence pill, version, chevron). Modeled on
 * the `graph.node.alert` renderer (sibling small-marker) but with no
 * count and a slightly different default chrome — alert sits on the
 * graph node corner, this one inlines with the title text so it stays
 * compact.
 *
 * Manifest requires `icon`; payload may override per-node and add
 * `severity` (color tint) / `tooltip`. The host strips `severity`
 * before this renderer sees it when the slot config has
 * `respectSeverity: false` — `card.title.right` honours severity by
 * default, so the tint applies.
 */
@Component({
  selector: 'sm-node-icon',
  imports: [TooltipModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="vc-icon"
      [class.vc-icon--info]="severity() === 'info'"
      [class.vc-icon--warn]="severity() === 'warn'"
      [class.vc-icon--success]="severity() === 'success'"
      [class.vc-icon--danger]="severity() === 'danger'"
      [pTooltip]="resolvedTooltip()"
      [attr.aria-label]="ariaLabel()"
      [attr.data-testid]="'renderer-node-icon'"
    >
      <sm-icon [icon]="icon()" hostClass="vc-icon__glyph" />
    </span>
  `,
  styles: [`
    /* Sized to match .sm-gnode__chevron (22x22, glyph 0.7rem) so
       the marker reads as a sibling of the chevron when both sit on
       the title row. The host wrapper (.vch) inside the slot is
       inline-flex; this span fills it without forcing extra padding.
       NO tinted wrapper — severity drives the glyph color directly,
       leaving the surrounding chrome quiet (the icon does the
       communicating). */
    .vc-icon { display: inline-flex; align-items: center;
      justify-content: center; line-height: 1;
      width: 22px; height: 22px; }
    .vc-icon__glyph { font-size: 0.7rem; line-height: 1; display: block; }
    .vc-icon--info    { color: var(--sm-severity-info); }
    .vc-icon--warn    { color: var(--sm-severity-warn); }
    .vc-icon--success { color: var(--sm-severity-success); }
    .vc-icon--danger  { color: var(--sm-severity-error); }
  `],
})
export class NodeIcon {
  readonly inputs = input.required<IRendererInputs>();

  protected readonly typed = computed<INodeIconPayload>(() => {
    const p = this.inputs().payload;
    if (typeof p !== 'object' || p === null) return {};
    return p as INodeIconPayload;
  });

  /** Payload icon takes precedence; manifest icon is the fallback. */
  protected readonly icon = computed(
    () => this.typed().icon ?? this.inputs().icon,
  );
  protected readonly severity = computed(() => this.typed().severity);
  protected readonly resolvedTooltip = computed(
    () => this.typed().tooltip ?? this.inputs().tooltip ?? '',
  );
  /** Manifest label feeds aria-label since the icon itself is aria-hidden. */
  protected readonly ariaLabel = computed(() => this.inputs().label ?? '');
}
