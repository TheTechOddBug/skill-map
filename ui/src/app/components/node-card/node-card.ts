import { ChangeDetectionStrategy, Component, computed, inject, input, model, output } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { KindRegistryService } from '../../../services/kind-registry';
import { NODE_CARD_TEXTS } from '../../../i18n/node-card.texts';
import {
  legacyFrontmatterMetadata,
  type IFrontmatterAgent,
  type IIssue,
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
  effectiveVersion,
} from '../../../models/node-derived';
import { providerUi, type IProviderUi } from '../../../services/provider-ui';
import type { ISelectionView } from '../../views/graph-view/selection-state';
import { KindIcon } from '../kind-icon/kind-icon';
import { ViewContributionsHost } from '../view-contributions-host/view-contributions-host';

/**
 * Default selection state for the card when its host did not bind one
 * (list view, prototype harnesses). Three booleans rolled into one
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
  readonly issues = input<readonly IIssue[]>([]);

  /**
   * Selection / highlight / dim bundle owned by the graph view's
   * `selectionState` helper. A single input avoids N × 3 function
   * calls per CD pass on dense graphs; the parent passes one Map
   * lookup result and the host bindings read three boolean fields off
   * it. Defaults to all-`false` so list-view and prototype harnesses
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
   * Visibility flags for LLM-derived surfaces on the graph card.
   * Both default to `false` while the dedicated LLM panel / chat owns
   * this content. Flip to `true` here to bring the markup back without
   * touching the template, the template still references both flags
   * around the original elements, preserving structure & position.
   */
  protected readonly showLlmWhat = false;
  protected readonly showLlmConfidence = false;

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
   * True if any LLM cluster row would render, gates the cluster wrapper
   * so it does not paint its padding around an empty body. WHAT is the
   * one row every kind has; when `showLlmWhat` is off, we drop the
   * cluster entirely unless some other kind-specific row has data.
   */
  protected readonly hasLlmCluster = computed<boolean>(() => {
    const s = this.summary();
    if (s === null) return false;
    if (this.showLlmWhat) return true;
    return this.hasNonWhatLlmContent(s);
  });

  /**
   * True when any LLM-derived field OTHER than WHAT has content for the
   * given summary. Used to decide whether the cluster wrapper should
   * paint its padding when WHAT is hidden, without this check the card
   * would render an empty bordered box for kinds whose summary only had
   * `whatItDoes`/`whatItCovers` populated.
   */
  private hasNonWhatLlmContent(s: TSummary): boolean {
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
   * Confidence tier for the marker color. `null` when no summary loaded.
   * Thresholds match the prototype: >0.8 high, 0.5–0.8 med, <0.5 low.
   */
  protected readonly confidenceTier = computed<'high' | 'med' | 'low' | null>(() => {
    const s = this.summary();
    if (!s) return null;
    if (s.confidence > 0.8) return 'high';
    if (s.confidence >= 0.5) return 'med';
    return 'low';
  });

  /** Confidence as integer percent (e.g. 92). `null` when no summary. */
  protected readonly confidencePct = computed<number | null>(() => {
    const s = this.summary();
    return s ? Math.round(s.confidence * 100) : null;
  });

  /** Filtered issues, `info` never reaches the node, only error + warn. */
  protected readonly visibleIssues = computed<readonly IIssue[]>(() =>
    this.issues().filter((i) => i.severity === 'error' || i.severity === 'warn'),
  );

  protected readonly errorCount = computed<number>(
    () => this.visibleIssues().filter((i) => i.severity === 'error').length,
  );
  protected readonly warnCount = computed<number>(
    () => this.visibleIssues().filter((i) => i.severity === 'warn').length,
  );

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
   * Per-Provider accent override. Returns:
   *   - `null` when the node has no provider, the kind isn't in the
   *     registry, or this node IS the primary Provider's contribution
   *     (the existing kind-class CSS rule already paints the right
   *     color via `--sm-kind-<kind>`).
   *   - `null` when the dark-theme toggle prefers a `colorDark` and
   *     a sibling provider declared one, letting the cascade pick
   *     the dark variant from the registered CSS var. (Today this
   *     simplification stays light-theme-only; the dark variant
   *     ships as a follow-up when a real Gemini-sourced node is
   *     visible in the inspector.)
   *   - the secondary Provider's hex color when the node was
   *     classified by a non-primary contributor (e.g. Gemini-sourced
   *     `agent` while Claude is primary).
   *
   * Bound via `[style.--accent]` on the host so it overrides the
   * `:host(.sm-gnode--<kind>) { --accent: var(--sm-kind-<kind>); }`
   * rule that paints the primary's color.
   */
  protected readonly providerAccent = computed<string | null>(() => {
    const node = this.node();
    if (!node.provider) return null;
    const entry = this.kindRegistry.lookup(node.kind);
    if (!entry) return null;
    if (node.provider === entry.primaryProviderId) return null;
    const providerUi = entry.providers[node.provider];
    return providerUi?.color ?? null;
  });

  /**
   * Provider identity chip, label + per-Provider color rendered in the
   * subtitle row, telling the user at a glance which platform a node
   * came from. Returns `null` for nodes without a provider (cold-start,
   * demo data); unknown providers fall back to a neutral gray chip with
   * the raw id as label (see `providerUi` in `services/provider-ui.ts`).
   */
  protected readonly providerChip = computed<IProviderUi | null>(() =>
    providerUi(this.node().provider),
  );

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

    const ann = node.sidecar?.annotations;
    const user = ann?.['tags'];
    if (Array.isArray(user)) {
      for (const t of user) {
        if (typeof t === 'string' && t.length > 0) out.push({ tag: t, source: 'user' });
      }
    } else {
      const legacy = legacyFrontmatterMetadata(node.frontmatter)?.['tags'];
      if (Array.isArray(legacy)) {
        for (const t of legacy) {
          if (typeof t === 'string' && t.length > 0) out.push({ tag: t, source: 'user' });
        }
      }
    }

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
    return fm.name || this.node().path;
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
