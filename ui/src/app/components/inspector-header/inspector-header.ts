/**
 * `<sm-inspector-header>` — hero band of the inspector view.
 *
 * Owns the visual fingerprint of the node currently in focus: kind
 * icon box + name + path, the right-edge actions cluster (favorite
 * star, stale clock, stability icon, version chip, header-badge
 * slots, embedded-mode close button), the plugin-actions row (hidden
 * behind a feature flag), and the tools chip row.
 *
 * Lives outside `inspector-view.ts` so the 9-computed header surface,
 * the `inspector.header.badge.*` slot hosts, the close-button focus
 * dance, and 350 lines of CSS sit in one place. The host (the
 * inspector view) keeps the cards below and the toolbar that wires
 * bump / debug + the empty / not-found branches.
 *
 * Inputs are required: a non-null `node` is the precondition the host
 * already enforces before mounting the header (the `@else { ... }`
 * branch in `inspector-view.html`).
 */

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { INSPECTOR_VIEW_TEXTS } from '../../../i18n/inspector-view.texts';
import { NODE_CARD_TEXTS } from '../../../i18n/node-card.texts';
import type { INodeView, TStability } from '../../../models/node';
import {
  effectiveIsStale,
  effectiveStability,
  effectiveStaleTooltip,
  effectiveToolsList,
  effectiveVersion,
} from '../../../models/node-derived';
import { KindIcon } from '../kind-icon/kind-icon';
import { ViewContributionsHost } from '../view-contributions-host/view-contributions-host';

/** Mirrors the parent's inspector mode — kept local to avoid a circular import. */
type TInspectorMode = 'standalone' | 'embedded';

@Component({
  selector: 'sm-inspector-header',
  standalone: true,
  imports: [TooltipModule, KindIcon, ViewContributionsHost],
  templateUrl: './inspector-header.html',
  styleUrl: './inspector-header.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorHeader {
  readonly node = input.required<INodeView>();
  readonly mode = input<TInspectorMode>('standalone');
  /**
   * Mirrors `DEFAULT_SETTINGS.inspector.actionMocks`. When false the
   * Actions row is hidden — see inspector-view.ts for the source.
   */
  readonly showActionMocks = input<boolean>(false);

  /**
   * Emitted by the X button (embedded mode only). The host (the
   * inspector view) decides what "close" means — its own `close`
   * output bubbles up to the graph view, which clears its selection.
   */
  readonly close = output<void>();

  /**
   * Emitted when the user clicks the heart. Carries the node path
   * so the host can call `loader.toggleFavorite(path, !isFavorite)`
   * without the header reaching into the loader itself.
   */
  readonly favoriteToggle = output<string>();

  protected readonly texts = INSPECTOR_VIEW_TEXTS;
  /** Reused so the card and the inspector header speak the same language. */
  protected readonly cardTexts = NODE_CARD_TEXTS;

  /**
   * Close button host element — focused on every path transition into
   * embedded mode so keyboard users land on a meaningful target.
   * `preventScroll: true` is mandatory: the panel uses a 220ms
   * `translateX` animation, so when this effect fires the X is
   * partially off-screen. A bare `.focus()` would call
   * `scrollIntoView` on a transforming element, forcing horizontal
   * scroll on the document; with `overflow-y: auto` on `.shell__main`,
   * the cascading reflow shifts the canvas-wrap laterally. Visible
   * symptom: the graph "moves and then relocates" every time the
   * panel opens.
   */
  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');

  constructor() {
    effect(() => {
      if (this.mode() !== 'embedded') return;
      // Subscribe to node so the focus fires after a node-to-node
      // change in embedded mode too (clicking a different graph card).
      this.node();
      queueMicrotask(() => this.closeBtn()?.nativeElement.focus({ preventScroll: true }));
    });
  }

  // ---------------------------------------------------------------------------
  // Header computeds — all derived from `node()`. Effective values
  // follow the sidecar-wins / legacy-fallback contract documented in
  // `models/node-derived.ts`.
  // ---------------------------------------------------------------------------

  protected readonly headerVersion = computed<string | null>(() => effectiveVersion(this.node()));

  protected readonly headerStability = computed<TStability | null>(() =>
    effectiveStability(this.node()),
  );

  /**
   * Catalog curation refinement (2026-05-07): the inspector title
   * surfaces the vendor `frontmatter.color` as a subtle shading.
   * Agents typically carry a Claude vendor color (`red`, `cyan`, …);
   * non-agent kinds (or agents without a color) fall back to the
   * kind-default palette token. The result feeds a CSS variable on
   * the title element so the host stays theme-friendly.
   */
  protected readonly headerTitleColor = computed<string | null>(() => {
    const n = this.node();
    const fm = n.frontmatter as Record<string, unknown>;
    const c = fm['color'];
    if (typeof c === 'string' && c.length > 0) return c;
    return `var(--sm-kind-${n.kind})`;
  });

  /**
   * Header tools — vendor frontmatter `tools` (agents) /
   * `allowed-tools` (skills / commands) rendered as individual chips
   * in the header.
   */
  protected readonly headerTools = computed<readonly string[]>(() =>
    effectiveToolsList(this.node()),
  );

  /**
   * Stale flag for the header — drives the clock icon next to the
   * stability / version cluster. Same source as the card via
   * `effectiveIsStale`.
   */
  protected readonly headerIsStale = computed<boolean>(() => effectiveIsStale(this.node()));

  /** Drift status tooltip; mirrors the card's vocabulary. */
  protected readonly headerStaleTooltip = computed<string>(() =>
    effectiveStaleTooltip(this.node(), NODE_CARD_TEXTS.sidecar),
  );

  protected onCloseClick(event: MouseEvent): void {
    event.stopPropagation();
    this.close.emit();
  }

  protected onFavoriteClick(event: MouseEvent): void {
    event.stopPropagation();
    this.favoriteToggle.emit(this.node().path);
  }
}
