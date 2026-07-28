import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import type { IRendererInputs } from '../../slots/slot-renderer-map';
import { Icon } from '../../slots/icon';
import { NODE_BADGE_TEXTS } from '../../../i18n/node-badge.texts';

/**
 * Renderer for the unified `inspector.header.badge` slot. A generic
 * badge that folds the former `inspector.header.badge.counter`
 * (NodeCounter) and `inspector.header.badge.tag` (NodeTag) sub-slots
 * into one expressive shape:
 *
 *   `{ label?, count?, severity?, tooltip? }`
 *
 * plus the manifest-declared `icon`. Any combination renders: an
 * icon-only badge (a `staleBadge` clock), an icon + label tag, an
 * icon + count counter, or all three. Severity tints the whole badge
 * when the host forwards it (`SLOT_REGISTRY[slot].respectSeverity !==
 * false`); otherwise the host strips it before the renderer sees the
 * payload.
 *
 * LINT (renderer attr-sanitization, see context/view-slots.md):
 * contribution data is bound only via `{{ }}` interpolation and
 * `[pTooltip]` (auto-sanitized). No `[innerHTML]` / `[style]` /
 * `[src]` / `[href]`. The icon goes through the shared `<sm-icon>`
 * resolver, which discriminates emoji / PrimeIcons / FontAwesome from
 * the trusted manifest string, never raw markup.
 */
interface INodeBadgePayload {
  label?: string;
  count?: number;
  tooltip?: string;
  severity?: 'info' | 'warn' | 'success' | 'danger';
}

@Component({
  selector: 'sm-node-badge',
  imports: [TooltipModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="vc-badge"
      [class.vc-badge--tinted]="hasTint()"
      [class.vc-badge--info]="severity() === 'info'"
      [class.vc-badge--warn]="severity() === 'warn'"
      [class.vc-badge--success]="severity() === 'success'"
      [class.vc-badge--danger]="severity() === 'danger'"
      [pTooltip]="resolvedTooltip()"
      tooltipPosition="left"
      [attr.data-testid]="'renderer-node-badge'"
    >
      @if (icon()) {
        <span class="vc-badge__icon"><sm-icon [icon]="icon()" /></span>
      }
      @if (label()) {
        <span class="vc-badge__label">{{ label() }}</span>
      }
      @if (count() !== null) {
        <span class="vc-badge__count" [attr.aria-label]="countAria()">{{ count() }}</span>
      }
    </span>
  `,
  styles: [`
    /* Aligned with .vc-counter / .vc-tag (see node-counter.ts,
       node-tag.ts). The badge reads as one chromatic unit: icon, label
       and count share the severity colour. A badge with no severity
       reads neutral; a severity either tints the glyph + text inline
       (counter-style) or, when a label is present, paints the chip
       background (tag-style) via .vc-badge--tinted. */
    .vc-badge { display: inline-flex; align-items: center; gap: 0.3rem;
      line-height: 1; color: var(--p-text-color); }
    .vc-badge__icon { font-size: var(--sm-fs-2xs); line-height: 1; display: block; }
    .vc-badge__label { font-weight: 500; line-height: 1; display: block; }
    .vc-badge__count { font-weight: 600; line-height: 1; display: block; }

    /* Inline tint (no label, no chip): glyph + count share the colour. */
    .vc-badge--info:not(.vc-badge--tinted)    { color: var(--sm-severity-info); }
    .vc-badge--warn:not(.vc-badge--tinted)    { color: var(--sm-severity-warn); opacity: 0.85; }
    .vc-badge--success:not(.vc-badge--tinted) { color: var(--sm-severity-success); }
    .vc-badge--danger:not(.vc-badge--tinted)  { color: var(--sm-severity-error); opacity: 0.85; }

    /* Chip tint (label present): background + foreground, tag-style. */
    .vc-badge--tinted { padding: 0.1rem 0.4rem; border-radius: var(--sm-radius-sm); }
    .vc-badge--tinted.vc-badge--info {
      background: var(--sm-severity-info-bg); color: var(--sm-severity-info);
    }
    .vc-badge--tinted.vc-badge--warn {
      background: var(--sm-severity-warn-bg); color: var(--sm-severity-warn);
    }
    .vc-badge--tinted.vc-badge--success {
      background: var(--sm-severity-success-bg); color: var(--sm-severity-success);
    }
    .vc-badge--tinted.vc-badge--danger {
      background: var(--sm-severity-error-bg); color: var(--sm-severity-error);
    }
  `],
})
export class NodeBadge {
  readonly inputs = input.required<IRendererInputs>();
  protected readonly texts = NODE_BADGE_TEXTS;

  protected readonly typed = computed<INodeBadgePayload>(() => {
    const p = this.inputs().payload;
    if (typeof p !== 'object' || p === null) return {};
    return p as INodeBadgePayload;
  });

  protected readonly icon = computed(() => this.inputs().icon);

  protected readonly label = computed<string>(() => {
    const l = this.typed().label;
    return typeof l === 'string' ? l : '';
  });

  /** `null` when the payload carries no numeric count (icon / label only). */
  protected readonly count = computed<number | null>(() => {
    const c = this.typed().count;
    return typeof c === 'number' && Number.isFinite(c) ? c : null;
  });

  protected readonly severity = computed(() => this.typed().severity);

  /** A chip-style tint only makes sense when there is a label to wrap. */
  protected readonly hasTint = computed<boolean>(() => !!this.severity() && this.label().length > 0);

  protected readonly resolvedTooltip = computed<string>(
    () => this.typed().tooltip ?? this.inputs().tooltip ?? '',
  );

  /** Manifest label feeds the count's `aria-label` for screen readers. */
  protected readonly countAria = computed<string>(
    () => this.inputs().label ?? (this.label() || this.texts.countAriaFallback),
  );
}
