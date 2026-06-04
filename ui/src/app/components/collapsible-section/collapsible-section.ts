import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

/**
 * Generic collapsible section built on the inspector's `.sm-block`
 * visual vocabulary (left accent rail, hairline divider, chevron
 * toggle). Intentionally style-free: the `.sm-block*` classes it emits
 * are styled by the host view through `::ng-deep` (see
 * `inspector-view.css`), the same contract `<sm-vendor-frontmatter>`
 * and `<sm-annotations-panel>` already follow, so the node's kind hue
 * flows in via the inherited `--accent` var.
 *
 * The body is projected and gated by the CALLER's `@if (expanded)` so a
 * collapsed section never instantiates its (often data-fetching)
 * content. This component owns only the toggle row: the title, an
 * optional title-extra slot (count badge / filename caption), the
 * chevron, and the aria / tooltip wiring.
 *
 * Projection: title-extra goes through `[smSectionTitleExtra]`; the
 * section body is the default slot.
 */
@Component({
  selector: 'sm-collapsible-section',
  imports: [TooltipModule],
  templateUrl: './collapsible-section.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sm-block sm-block--collapsible' },
})
export class CollapsibleSection {
  /** Section heading rendered in the toggle row. */
  readonly title = input.required<string>();
  /** Expanded state; owned + persisted by the caller. */
  readonly expanded = input.required<boolean>();
  /** `data-testid` for the toggle button (the host carries the section id). */
  readonly toggleTestid = input<string>();
  /** Optional aria-label override for the toggle (e.g. the Debug section). */
  readonly toggleAriaLabel = input<string>();
  /** Optional tooltip for the toggle (e.g. the Debug section). */
  readonly toggleTooltip = input<string>();

  /** Emitted when the user clicks the toggle row. */
  readonly toggle = output<void>();
}
