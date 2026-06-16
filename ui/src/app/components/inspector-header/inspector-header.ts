/**
 * `<sm-inspector-header>`, hero band of the inspector view.
 *
 * Owns the visual fingerprint of the node currently in focus: kind
 * eyebrow + icon box + name (with version chip and stability tag) +
 * path + meta strip (bytes), plus the right-edge actions cluster
 * (favorite star, unified header-badge slot), and the tag row (delegated
 * to `<sm-node-tags>`: clickable filter chips plus an inline add / remove
 * editor; the header only sources the tags and re-emits `tagClick`). The
 * stale signal and any other header badge now arrive as contributions on
 * `inspector.header.badge`; the header carries no hardcoded badge of its
 * own.
 *
 * Inputs are required: a non-null `node` is the precondition the host
 * already enforces before mounting the header (the `@else { ... }`
 * branch in `inspector-view.html`).
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { INSPECTOR_VIEW_TEXTS } from '../../../i18n/inspector-view.texts';
import { NODE_CARD_TEXTS } from '../../../i18n/node-card.texts';
import type { INodeView, TStability } from '../../../models/node';
import {
  effectiveStability,
  effectiveUserTags,
  effectiveVersion,
} from '../../../models/node-derived';
import { KindIcon } from '../kind-icon/kind-icon';
import { NodeTags } from '../node-tags/node-tags';
import { ViewContributionsHost } from '../view-contributions-host/view-contributions-host';

/**
 * Closed enum of Claude vendor `color` values from the agent
 * frontmatter schema. Any other string falls back to the kind-default
 * palette token (see `headerTitleColor`).
 */
const CLAUDE_VENDOR_COLORS: ReadonlySet<string> = new Set([
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
  'pink',
]);

@Component({
  selector: 'sm-inspector-header',
  imports: [TooltipModule, KindIcon, NodeTags, ViewContributionsHost],
  templateUrl: './inspector-header.html',
  styleUrl: './inspector-header.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorHeader {
  readonly node = input.required<INodeView>();
  /**
   * True when the node carries a `frontmatter-parse-error` issue, i.e.
   * its YAML frontmatter failed to parse and `frontmatter` came back
   * empty. Drives the "invalid frontmatter" badge and means the title
   * is showing the filename fallback rather than `frontmatter.name`.
   */
  readonly frontmatterInvalid = input<boolean>(false);

  /**
   * Tag currently driving the map's tag-selection (forwarded down from
   * the graph view's `activeTagSelection`). Highlights the matching chip
   * in the header tag row so the user sees which tag is active.
   */
  readonly activeTag = input<string | null>(null);

  /**
   * Emitted when the user clicks the heart. Carries the node path so
   * the host can call `loader.toggleFavorite(path, !isFavorite)`
   * without the header reaching into the loader itself.
   */
  readonly favoriteToggle = output<string>();

  /**
   * Emitted when the user clicks a tag chip in the header. Carries the
   * tag string; the host forwards it to the graph's tag-selection
   * (`onTagSelect`), which selects every node carrying that tag and
   * frames them on the map. Re-clicking the active tag clears it.
   */
  readonly tagClick = output<string>();

  protected readonly texts = INSPECTOR_VIEW_TEXTS;
  /** Reused so the card and the inspector header speak the same language. */
  protected readonly cardTexts = NODE_CARD_TEXTS;

  // ---------------------------------------------------------------------------
  // Header computeds, all derived from `node()`. Effective values follow
  // the sidecar-wins / legacy-fallback contract documented in
  // `models/node-derived.ts`.
  // ---------------------------------------------------------------------------

  /**
   * Title shown in the hero. Prefers `frontmatter.name`; falls back to
   * the file's basename when the name is missing (e.g. frontmatter
   * failed to parse, so `frontmatter` is empty). Never renders blank.
   */
  protected readonly headerName = computed<string>(() => {
    const n = this.node();
    const name = n.frontmatter.name;
    if (typeof name === 'string' && name.trim().length > 0) return name;
    return n.path.split('/').pop() ?? n.path;
  });

  protected readonly headerVersion = computed<string | null>(() => effectiveVersion(this.node()));

  protected readonly headerStability = computed<TStability | null>(() =>
    effectiveStability(this.node()),
  );

  protected readonly headerTitleColor = computed<string | null>(() => {
    const n = this.node();
    const fm = n.frontmatter as Record<string, unknown>;
    const c = fm['color'];
    if (typeof c === 'string' && CLAUDE_VENDOR_COLORS.has(c)) return c;
    return `var(--sm-kind-${n.kind})`;
  });

  /**
   * Sidecar-curated tags fed to `<sm-node-tags>` (the inline tag row,
   * which owns both the filter chips and the editor). Highlight / edit
   * state lives in that child; the header only sources the array and
   * forwards `tagClick`.
   */
  protected readonly headerTags = computed<readonly string[]>(() =>
    effectiveUserTags(this.node()),
  );

  protected onFavoriteClick(event: MouseEvent): void {
    event.stopPropagation();
    this.favoriteToggle.emit(this.node().path);
  }
}
