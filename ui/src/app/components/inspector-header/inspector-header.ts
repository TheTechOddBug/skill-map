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
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { INSPECTOR_VIEW_TEXTS } from '../../../i18n/inspector-view.texts';
import { NODE_CARD_TEXTS } from '../../../i18n/node-card.texts';
import { ActionDispatchService } from '../../../services/action-dispatch';
import { ActionPromptDialog } from '../../renderers/node-action-button/action-prompt-dialog';
import type { IInputTypeDescriptor, TInputTypeValue } from '../../renderers/input-type-control/input-type-control';
import type { INodeSummaryRowApi } from '../../../models/api';
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
  imports: [ActionPromptDialog, TooltipModule, KindIcon, NodeTags, ViewContributionsHost],
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

  /**
   * Semantic-analysis affordance (user shape 2026-07-21): the header
   * hosts the summarizer's magic button and, once a
   * summary exists, the expandable analysis block under the tags row.
   * The header stays presentational: the host owns the state machine
   * (`hidden` / `idle` / `queued` / `running` / `ready`), the rows, and
   * the expansion; the header only renders and re-emits clicks.
   */
  readonly summaryState = input<'hidden' | 'idle' | 'queued' | 'running' | 'ready'>('hidden');
  readonly summaryRows = input<INodeSummaryRowApi[]>([]);
  readonly summaryExpanded = input<boolean>(false);
  readonly summaryStale = input<boolean>(false);
  /** Idle -> queue the run; ready -> toggle the block. */
  readonly summarizeClick = output<void>();
  /** Re-run from the expanded block (fresh judgment). */
  readonly summaryRefresh = output<void>();
  /** Delete the stored summary (carries the block's summarizer id). */
  readonly summaryDelete = output<string>();

  protected readonly texts = INSPECTOR_VIEW_TEXTS;
  /** Reused so the card and the inspector header speak the same language. */
  protected readonly cardTexts = NODE_CARD_TEXTS;

  /** Tooltip for the summary affordance, per state. */
  protected summaryTooltip(): string {
    const t = this.texts.header.summary;
    switch (this.summaryState()) {
      case 'queued':
        return t.tooltipQueued;
      case 'running':
        return t.tooltipRunning;
      case 'ready':
        return this.summaryStale() ? t.tooltipReadyStale : t.tooltipReady;
      default:
        return t.tooltipIdle;
    }
  }

  /** String list read from a summary report field (defensive). */
  protected reportList(row: INodeSummaryRowApi, field: string): string[] {
    const value = row.report[field];
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  }

  /** The report's required subject line. */
  protected reportSubject(row: INodeSummaryRowApi): string {
    const value = row.report['whatItCovers'];
    return typeof value === 'string' ? value : '';
  }

  /** Confidence percent, or null when the report omitted it. */
  protected reportConfidence(row: INodeSummaryRowApi): number | null {
    const value = row.report['confidence'];
    return typeof value === 'number' ? Math.round(value * 100) : null;
  }

  // --- stability chip = the Set stability affordance (user call 2026-07-21)

  private readonly dispatcher = inject(ActionDispatchService);

  /**
   * The `core/node-set-stability` action-button contribution, re-homed:
   * its button left the Actions section and the header's stability chip
   * (ALWAYS rendered, defaulting to `stable` when unset) became the
   * affordance. Clicking the chip opens the SAME enum-pick prompt dialog
   * the button used, seeded from the contribution's payload; the plugin
   * scheme is untouched, the action still projects onto
   * `inspector.action.button`, the header just consumes that payload
   * directly (documented UI exception, mirror of the host's
   * `excludeExtensionIds`).
   */
  protected readonly stabilityPayload = computed<{
    prompt: { inputType: string; paramKey: string; label: string; options?: { value: string; label: string }[]; defaultValue?: string | string[] };
    enabled: boolean;
  } | null>(() => {
    const contribution = (this.node().contributions ?? []).find(
      (c) =>
        c.slot === 'inspector.action.button' &&
        `${c.pluginId}/${c.extensionId}` === 'core/node-set-stability',
    );
    const payload = contribution?.payload;
    if (typeof payload !== 'object' || payload === null) return null;
    const typed = payload as { prompt?: { inputType?: string; paramKey?: string; label?: string; options?: { value: string; label: string }[]; defaultValue?: string | string[] }; enabled?: boolean };
    if (!typed.prompt?.inputType || !typed.prompt.paramKey) return null;
    return {
      prompt: typed.prompt as { inputType: string; paramKey: string; label: string },
      enabled: typed.enabled !== false,
    };
  });

  /** The chip's display value: the effective stability, `stable` by default. */
  protected readonly stabilityDisplay = computed<TStability | 'stable'>(
    () => this.headerStability() ?? 'stable',
  );

  protected readonly stabilityPromptOpen = signal(false);
  /** Sticky @defer latch, mirror of the action-button renderer. */
  protected readonly stabilityPromptOpened = signal(false);
  protected readonly stabilityBusy = signal(false);

  protected readonly stabilityDescriptor = computed<IInputTypeDescriptor>(() => {
    const p = this.stabilityPayload()?.prompt;
    return {
      inputType: p?.inputType ?? '',
      label: p?.label ?? '',
      options: p?.options,
      defaultValue: p?.defaultValue,
    };
  });

  protected onStabilityChipClick(): void {
    if (this.stabilityPayload() === null || this.stabilityBusy()) return;
    this.stabilityPromptOpened.set(true);
    this.stabilityPromptOpen.set(true);
  }

  protected async onStabilityConfirmed(value: TInputTypeValue): Promise<void> {
    const payload = this.stabilityPayload();
    if (payload === null) return;
    this.stabilityPromptOpen.set(false);
    this.stabilityBusy.set(true);
    try {
      await this.dispatcher.dispatch('core/node-set-stability', this.node().path, {
        [payload.prompt.paramKey]: value,
      });
    } finally {
      this.stabilityBusy.set(false);
    }
  }

  protected cancelStabilityPrompt(): void {
    this.stabilityPromptOpen.set(false);
  }

  // --- version chip = the Bump affordance (user call 2026-07-21) ----------

  /**
   * The `core/node-bump` action-button contribution, re-homed like the
   * stability chip: the header's version chip IS the bump affordance.
   * With the plugin enabled the chip always renders (the effective
   * version, or the short `bump` placeholder for a versionless file)
   * and clicking it dispatches the bump directly (no prompt; the
   * payload's `enabled` gate and `disabledReason` are honored). Plugin
   * off -> no version surface in the header at all, mirror of the
   * stability rule.
   */
  protected readonly bumpPayload = computed<{
    enabled: boolean;
    disabledReason?: string;
  } | null>(() => {
    const contribution = (this.node().contributions ?? []).find(
      (c) =>
        c.slot === 'inspector.action.button' &&
        `${c.pluginId}/${c.extensionId}` === 'core/node-bump',
    );
    const payload = contribution?.payload;
    if (typeof payload !== 'object' || payload === null) return null;
    const typed = payload as { enabled?: boolean; disabledReason?: string };
    return {
      enabled: typed.enabled !== false,
      ...(typed.disabledReason !== undefined ? { disabledReason: typed.disabledReason } : {}),
    };
  });

  protected readonly bumpBusy = signal(false);

  protected bumpTooltip(): string {
    const payload = this.bumpPayload();
    if (payload !== null && !payload.enabled) return payload.disabledReason ?? '';
    // Versionless file: the chip invites stamping the first version.
    if (this.headerVersion() === null) return this.texts.header.bump.placeholderTooltip;
    return this.texts.header.bump.tooltip;
  }

  protected async onBumpClick(): Promise<void> {
    const payload = this.bumpPayload();
    if (payload === null || !payload.enabled || this.bumpBusy()) return;
    this.bumpBusy.set(true);
    try {
      await this.dispatcher.dispatch('core/node-bump', this.node().path, undefined);
    } finally {
      this.bumpBusy.set(false);
    }
  }

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
