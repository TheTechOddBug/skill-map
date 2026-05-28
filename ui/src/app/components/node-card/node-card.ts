import { ChangeDetectionStrategy, Component, computed, inject, input, model, output } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { KindRegistryService } from '../../../services/kind-registry';
import { NODE_CARD_TEXTS } from '../../../i18n/node-card.texts';
import {
  type IFrontmatterAgent,
  type INodeStats,
  type INodeView,
  type ISummaryAgent,
  type ISummaryCommand,
  type ISummaryMarkdown,
  type ISummarySkill,
  type TSummary,
} from '../../../models/node';
import {
  compactNumber,
  effectiveStability,
  effectiveUserTags,
  effectiveVersion,
} from '../../../models/node-derived';
import { pathBasenameForLink } from '../../../services/trigger-resolve';
import type { ISelectionView } from '../../views/graph-view/selection-state';
import { KindIcon } from '../kind-icon/kind-icon';
import { ViewContributionsHost } from '../view-contributions-host/view-contributions-host';

/**
 * Default selection state for the card when its host did not bind one
 * (files view, prototype harnesses). Three booleans rolled into one
 * record per the `ISelectionView` contract.
 */
const DEFAULT_SELECTION: ISelectionView = {
  selected: false,
  highlighted: false,
  dimmed: false,
};

/**
 * Graph node body. Visual contract for what every kind looks like in
 * the graph view: avatar (kind icon) + title + a row of physical
 * subtitle pills (tokens, bytes, days, version), an actions cluster
 * (LLM confidence %, expand chevron) and, when expanded, an LLM
 * summary block, the author description (scrollable), kind-specific
 * meta rows, and the deterministic issues list. Footer carries the
 * conditional stats (errors, warns, tools, links, external refs).
 *
 * Structural rule: this component is meant to live inline as a direct
 * content child of `[fNode]` in `<f-canvas>`. The `fNodeInput` /
 * `fNodeOutput` connectors stay as siblings of `<sm-node-card>` so
 * Foblex's `@ContentChildren` queries still find them. Do NOT wrap
 * the connectors inside this component or route the body through
 * `*ngTemplateOutlet`, see `foblex-flow` skill rule #10 / debug #10.
 */
@Component({
  selector: 'sm-node-card',
  imports: [KindIcon, TooltipModule, ViewContributionsHost],
  templateUrl: './node-card.html',
  styleUrl: './node-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'sm-gnode',
    '[attr.data-kind]': 'node().kind',
    '[class.sm-gnode--with-color]': '!!nodeColor()',
    '[class.sm-gnode--deprecated]': "stability() === 'deprecated'",
    '[class.sm-gnode--expanded]': 'expanded()',
    '[class.sm-gnode--selected]': 'selection().selected',
    '[class.sm-gnode--highlighted]': 'selection().highlighted',
    '[class.sm-gnode--dimmed]': 'selection().dimmed',
    '[style.--node-color]': 'nodeColor()',
    // Per-provider accent override. When a kind name is contributed
    // by several Providers (e.g. Claude `agent` and Gemini `agent`),
    // the kindRegistry's primary drives the shared `--sm-kind-<kind>`
    // CSS var. Nodes sourced from a non-primary Provider override the
    // accent here so each card paints with its own Provider's color.
    '[style.--accent]': 'providerAccent()',
  },
})
export class NodeCard {
  readonly node = input.required<INodeView>();
  readonly stats = input<INodeStats>({ linksIn: 0, linksOut: 0 });
  readonly summary = input<TSummary | null>(null);

  /**
   * Selection / highlight / dim bundle owned by the graph view's
   * `selectionState` helper. A single input avoids N × 3 function
   * calls per CD pass on dense graphs; the parent passes one Map
   * lookup result and the host bindings read three boolean fields off
   * it. Defaults to all-`false` so files-view and prototype harnesses
   * can mount the card without wiring selection state.
   */
  readonly selection = input<ISelectionView>(DEFAULT_SELECTION);

  /**
   * Per-user favorite state. Owned by the graph / list / inspector view
   * (which projects it from the loaded `INodeView.isFavorite`); the card
   * is a pure presenter and emits `(favoriteToggle)` when the user
   * clicks the heart so the parent can fire the BFF call + update the
   * collection-loader optimistically.
   */
  readonly isFavorite = input<boolean>(false);
  readonly favoriteToggle = output<{ path: string; value: boolean }>();

  protected readonly texts = NODE_CARD_TEXTS;

  /**
   * Expand state as a two-way model so the parent (graph-view) can own
   * persistence. Defaults to collapsed; the chevron toggles it via
   * `toggleExpanded()`, which writes back through the model and lets
   * the parent persist to localStorage.
   */
  readonly expanded = model<boolean>(false);

  /**
   * Fast accessor for the agent frontmatter block. Narrows the union to
   * the matching shape so the template can read fields without casts.
   */
  protected readonly fmAgent = computed<IFrontmatterAgent | null>(() => {
    const n = this.node();
    return n.kind === 'agent' ? (n.frontmatter as IFrontmatterAgent) : null;
  });

  /** Kind-specific summary narrowing. */
  protected readonly summaryAgent = computed<ISummaryAgent | null>(() => {
    const s = this.summary();
    return s?.kind === 'agent' ? s : null;
  });
  protected readonly summarySkill = computed<ISummarySkill | null>(() => {
    const s = this.summary();
    return s?.kind === 'skill' ? s : null;
  });
  protected readonly summaryCommand = computed<ISummaryCommand | null>(() => {
    const s = this.summary();
    return s?.kind === 'command' ? s : null;
  });
  protected readonly summaryMarkdown = computed<ISummaryMarkdown | null>(() => {
    const s = this.summary();
    return s?.kind === 'markdown' ? s : null;
  });

  /**
   * True when any kind-specific LLM row has content. Gates the cluster
   * wrapper so it does not paint its padding around an empty body.
   * (The per-kind WHAT lines were dropped, the LLM panel / chat owns
   * that surface now; the remaining rows are kind-specific facets.)
   */
  protected readonly hasLlmCluster = computed<boolean>(() => {
    const s = this.summary();
    return s !== null && this.hasLlmContent(s);
  });

  private hasLlmContent(s: TSummary): boolean {
    switch (s.kind) {
      case 'markdown':
        return (s.topics?.length ?? 0) > 0 || (s.keyFacts?.length ?? 0) > 0;
      case 'agent':
        return Boolean(s.whenToUse) || Boolean(s.interactionStyle) || (s.capabilities?.length ?? 0) > 0;
      case 'skill':
        return (
          (s.recipe?.length ?? 0) > 0 ||
          (s.preconditions?.length ?? 0) > 0 ||
          (s.outputs?.length ?? 0) > 0 ||
          (s.sideEffects?.length ?? 0) > 0
        );
      case 'command':
        return Boolean(s.invocationExample) || (s.sideEffects?.length ?? 0) > 0;
      default:
        return false;
    }
  }

  /**
   * Card accent color. Catalog curation 2026-05-07: the canonical
   * source is the Anthropic vendor `frontmatter.color` enum
   * (`red` / `blue` / `green` / …) on agent kind. Non-agent kinds have
   * no override and fall back to the kind-default palette via the
   * existing `--accent` CSS var. The pre-curation `metadata.color`
   * opt-in was dropped at curation 2026-05-07.
   */
  protected readonly nodeColor = computed<string | null>(() => this.agentVendorColor());

  private readonly kindRegistry = inject(KindRegistryService);

  /**
   * Per-Provider accent override. Disabled, the node card always paints
   * with the KIND's primary colour (via the `--sm-kind-<kind>` CSS var
   * the kind-class rule sets): kind dictates the visual. A Codex agent
   * reads as "an agent" first, not as a Codex-tinted card. Provider
   * identity is conveyed by the kind-icon's provider glyph (icon-box)
   * and surfaced in the chrome above the list, so the card no longer
   * carries a separate provider chip. Returning `null` unconditionally
   * keeps the `[style.--accent]` binding inert and lets the CSS cascade
   * pick up the kind primary.
   */
  protected readonly providerAccent = computed<string | null>(() => null);

  /** Pretty number formatting for bytes / tokens (e.g. 12420 → "12k"). */
  protected readonly bytesShort = computed<string | null>(() => {
    const v = this.stats().bytesTotal;
    return v === undefined ? null : compactNumber(v);
  });
  protected readonly tokensShort = computed<string | null>(() => {
    const v = this.stats().tokensTotal;
    return v === undefined ? null : compactNumber(v);
  });

  /**
   * Card version label, see `effectiveVersion` for source contract
   * (sidecar `annotations.version` wins, legacy `metadata.version` is
   * the un-migrated fallback).
   */
  protected readonly version = computed(() => effectiveVersion(this.node()));

  /**
   * Effective stability, see `effectiveStability` for source contract.
   */
  protected readonly stability = computed(() => effectiveStability(this.node()));

  /**
   * Tags · dual-source, author tags (`frontmatter.tags`) render first
   * with the outlined `--author` variant, user tags
   * (`sidecar.annotations.tags`) render second with the filled
   * `--user` variant. Mirrors the inspector annotations panel
   * attribution so the visual vocabulary stays consistent across
   * both surfaces. Legacy `frontmatter.metadata.tags` is treated as
   * user-side (the historical curation home) so old `.md` files
   * without the new `frontmatter.tags` field keep rendering.
   */
  protected readonly tagChips = computed<readonly { tag: string; source: 'author' | 'user' }[]>(() => {
    const node = this.node();
    const out: { tag: string; source: 'author' | 'user' }[] = [];

    const fm = node.frontmatter as Record<string, unknown>;
    const author = fm['tags'];
    if (Array.isArray(author)) {
      for (const t of author) {
        if (typeof t === 'string' && t.length > 0) out.push({ tag: t, source: 'author' });
      }
    }

    for (const t of effectiveUserTags(node)) out.push({ tag: t, source: 'user' });

    return out;
  });

  /** Top-3 chips rendered on the card. */
  protected readonly visibleTagChips = computed(() => this.tagChips().slice(0, 3));

  /** "+N more" suffix when the chip list overflows the visible cap. */
  protected readonly moreTagsCount = computed<number>(() =>
    Math.max(0, this.tagChips().length - 3),
  );

  /**
   * Anthropic vendor `color` from agent frontmatter, drives the card's
   * accent. Non-agent kinds fall back to the kind-default palette.
   * Catalog curation: vendor color rides on `frontmatter.color` (per
   * the Claude provider's agent schema), NOT `metadata.color`.
   */
  protected readonly agentVendorColor = computed<string | null>(() => {
    const n = this.node();
    if (n.kind !== 'agent') return null;
    const fm = n.frontmatter as Record<string, unknown>;
    const c = fm['color'];
    return typeof c === 'string' && c.length > 0 ? c : null;
  });

  protected readonly displayName = computed<string>(() => {
    const fm = this.node().frontmatter;
    if (fm.name) return fm.name;
    // Fallback when the .md has no parseable `name` (frontmatter
    // parse error, invalid frontmatter, or just a missing field):
    // derive a friendly title from the path instead of showing the
    // whole path verbatim. Skills live at `<dir>/<name>/SKILL.md`,
    // their useful identifier is the parent directory; everything
    // else uses the filename without the `.md` extension.
    return pathBasenameForLink(this.node().path);
  });

  /** Description shown in the scrollable read-only block. */
  protected readonly description = computed<string>(() => {
    return this.node().frontmatter.description ?? '';
  });

  protected toggleExpanded(event: MouseEvent): void {
    // Stop propagation so the parent [fNode] doesn't treat this as a
    // node click (which would select the node and trigger highlight).
    event.stopPropagation();
    this.expanded.update((v) => !v);
  }

  protected toggleFavorite(event: MouseEvent): void {
    event.stopPropagation();
    const next = !this.isFavorite();
    this.favoriteToggle.emit({ path: this.node().path, value: next });
  }
}
