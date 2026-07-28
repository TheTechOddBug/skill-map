import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

/** Per-instance suffix for the heading / body ids the ARIA wiring needs. */
let nextSectionId = 0;

/**
 * Generic collapsible section built on the shared `.sm-block` visual
 * vocabulary (left accent rail, hairline divider, chevron toggle).
 * Visually it owns nothing: the `.sm-block*` classes it emits are styled
 * globally (see `styles.css`), the same contract
 * `<sm-vendor-frontmatter>` and `<sm-annotations-panel>` already
 * follow, so the host view's accent hue flows in via the inherited
 * `--accent` var (neutral fallback when no host provides one). The one
 * local style block is structural, it belongs to the body wrapper this
 * component itself renders (see the `styles` comment below).
 *
 * The body is projected and gated by the CALLER's `@if (expanded)` so a
 * collapsed section never instantiates its (often data-fetching)
 * content. This component owns the toggle row (title, an optional
 * title-extra slot for a count badge / filename caption, the chevron,
 * the aria / tooltip wiring) plus the labelled region wrapper the
 * projected body lands in.
 *
 * Projection: title-extra goes through `[smSectionTitleExtra]`; the
 * section body is the default slot.
 *
 * Public API (inputs / outputs / projection slots) is consumed across the
 * whole inspector, so it is deliberately unchanged by the a11y wiring:
 * the ids, the `aria-controls` link and the body region are all internal.
 */
@Component({
  selector: 'sm-collapsible-section',
  imports: [TooltipModule],
  templateUrl: './collapsible-section.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sm-block sm-block--collapsible' },
  // The ONLY styles this component owns, and they exist for the body
  // wrapper the ARIA region needs, nothing visual is being taken back
  // from the global `.sm-block*` vocabulary in `styles.css`:
  //   - flex column so the projected children, now one level deeper than
  //     they used to be, still stack the way the host stacked them (the
  //     body-section consumer projects a view toggle PLUS the body, so
  //     the spacing between them is load-bearing);
  //   - `gap: inherit` rather than a literal, so the wrapper reproduces
  //     whatever gap its host resolved: 0.45rem from `.sm-block`, or the
  //     0.6rem `.inspector__body-section` overrides it with. A literal
  //     would silently retune that one section;
  //   - `:empty` collapses the wrapper while the caller renders no body,
  //     so the global divider rule (`.sm-block--collapsible >
  //     .sm-block__heading + *`, which now lands on this wrapper) does
  //     not draw a hairline plus its margin under a collapsed section.
  //     Comment nodes (the anchors the caller's own `@if` leaves behind)
  //     do not defeat `:empty`; a whitespace text node would, which is
  //     why the template writes the projection with no gaps around it.
  styles: `
    .sm-block__body {
      display: flex;
      flex-direction: column;
      gap: inherit;
    }
    .sm-block__body:empty {
      display: none;
    }
  `,
})
export class CollapsibleSection {
  /** Stable ids for the heading / body pair (see the template's ARIA wiring). */
  private readonly instanceId = nextSectionId++;
  protected readonly titleId = `sm-section-title-${this.instanceId}`;
  protected readonly bodyId = `sm-section-body-${this.instanceId}`;

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
