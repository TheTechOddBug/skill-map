import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { NODE_CARD_TEXTS } from '../../../i18n/node-card.texts';
import {
  isStaleSidecar,
  legacyFrontmatterMetadata,
  type IFrontmatterAgent,
  type IIssue,
  type INodeStats,
  type INodeView,
  type ISummaryAgent,
  type ISummaryCommand,
  type ISummaryNote,
  type ISummarySkill,
  type TSidecarStatus,
  type TSummary,
} from '../../../models/node';
import { KindIcon } from '../kind-icon/kind-icon';

/**
 * Graph node body. Visual contract for what every kind looks like in
 * the graph view: avatar (kind icon) + title + a row of physical
 * subtitle pills (tokens, bytes, days, version), an actions cluster
 * (LLM confidence %, expand chevron) and — when expanded — an LLM
 * summary block, the author description (scrollable), kind-specific
 * meta rows, and the deterministic issues list. Footer carries the
 * conditional stats (errors, warns, tools, links, external refs).
 *
 * Structural rule: this component is meant to live inline as a direct
 * content child of `[fNode]` in `<f-canvas>`. The `fNodeInput` /
 * `fNodeOutput` connectors stay as siblings of `<sm-node-card>` so
 * Foblex's `@ContentChildren` queries still find them. Do NOT wrap
 * the connectors inside this component or route the body through
 * `*ngTemplateOutlet` — see `foblex-flow` skill rule #10 / debug #10.
 */
@Component({
  selector: 'sm-node-card',
  imports: [KindIcon, TooltipModule],
  templateUrl: './node-card.html',
  styleUrl: './node-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'sm-gnode',
    '[class.sm-gnode--skill]': "node().kind === 'skill'",
    '[class.sm-gnode--agent]': "node().kind === 'agent'",
    '[class.sm-gnode--command]': "node().kind === 'command'",
    '[class.sm-gnode--note]': "node().kind === 'note'",
    '[class.sm-gnode--danger]': 'hasInjection()',
    '[class.sm-gnode--with-color]': '!!nodeColor()',
    '[class.sm-gnode--deprecated]': "stability() === 'deprecated'",
    '[class.sm-gnode--expanded]': 'expanded()',
    '[class.sm-gnode--selected]': 'selected()',
    '[class.sm-gnode--highlighted]': 'highlighted()',
    '[class.sm-gnode--dimmed]': 'dimmed()',
    '[style.--node-color]': 'nodeColor()',
  },
})
export class NodeCard {
  readonly node = input.required<INodeView>();
  readonly stats = input<INodeStats>({ linksIn: 0, linksOut: 0 });
  readonly summary = input<TSummary | null>(null);
  readonly issues = input<readonly IIssue[]>([]);

  /** Selection/highlight/dim states owned by the graph view. */
  readonly selected = input<boolean>(false);
  readonly highlighted = input<boolean>(false);
  readonly dimmed = input<boolean>(false);

  protected readonly texts = NODE_CARD_TEXTS;

  /**
   * Visibility flags for LLM-derived surfaces on the graph card.
   * Both default to `false` while the dedicated LLM panel / chat owns
   * this content. Flip to `true` here to bring the markup back without
   * touching the template — the template still references both flags
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
  protected readonly summaryNote = computed<ISummaryNote | null>(() => {
    const s = this.summary();
    return s?.kind === 'note' ? s : null;
  });

  /**
   * True if any LLM cluster row would render — gates the cluster wrapper
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
   * paint its padding when WHAT is hidden — without this check the card
   * would render an empty bordered box for kinds whose summary only had
   * `whatItDoes`/`whatItCovers` populated.
   */
  private hasNonWhatLlmContent(s: TSummary): boolean {
    switch (s.kind) {
      case 'note':
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

  /** True if the node has prompt-injection flagged in safety. */
  protected readonly hasInjection = computed<boolean>(
    () => this.summary()?.safety.injectionDetected === true,
  );

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

  /** Injection type from `safety` — `null` when no injection or no summary. */
  protected readonly injectionType = computed<string | null>(() => {
    const s = this.summary();
    return s?.safety.injectionDetected ? (s.safety.injectionType ?? null) : null;
  });

  /** Filtered issues — `info` never reaches the node, only error + warn. */
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
   * ISO date → days-ago string (`12d`). Source is
   * `sidecar.root.audit.lastBumpedAt` — the canonical activity timestamp
   * written by every `bump`. Returns null when absent or unparseable.
   */
  protected readonly daysAgo = computed<{ short: string; iso: string; days: number } | null>(() => {
    const audit = this.node().sidecar?.root?.['audit'];
    if (!audit || typeof audit !== 'object' || Array.isArray(audit)) return null;
    const raw = (audit as Record<string, unknown>)['lastBumpedAt'];
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
    return { short: `${days}d`, iso: raw, days };
  });

  /**
   * Card version label. Catalog curation 2026-05-07: the canonical
   * source is `sidecar.annotations.version` (integer monotonic
   * counter); fall back to legacy `frontmatter.metadata.version`
   * (semver string) for nodes that pre-date the migration via the
   * frontmatter's `additionalProperties: true` index signature.
   * Returns `null` when both are absent.
   */
  protected readonly version = computed<string | null>(() => {
    const ann = this.node().sidecar?.annotations;
    if (ann && typeof ann['version'] === 'number') return `v${ann['version']}`;
    const legacy = legacyFrontmatterMetadata(this.node().frontmatter)?.['version'];
    return typeof legacy === 'string' && legacy.length > 0 ? `v${legacy}` : null;
  });

  protected readonly stability = computed<'experimental' | 'stable' | 'deprecated' | null>(() => {
    // Sidecar `annotations.stability` wins; legacy `metadata.stability`
    // is the fallback for nodes that haven't been bumped post-curation.
    const ann = this.node().sidecar?.annotations;
    const fromAnn = ann?.['stability'];
    if (fromAnn === 'stable' || fromAnn === 'experimental' || fromAnn === 'deprecated') {
      return fromAnn;
    }
    const legacy = legacyFrontmatterMetadata(this.node().frontmatter)?.['stability'];
    if (legacy === 'stable' || legacy === 'experimental' || legacy === 'deprecated') {
      return legacy;
    }
    return null;
  });

  /**
   * Tags catalog (curation surface — first three on the card; "+N more"
   * suffix for longer lists). Source order is sidecar `annotations.tags`
   * (the catalog-curation home) → legacy `metadata.tags` for un-migrated
   * pre-9.5 `.md` files.
   */
  protected readonly tags = computed<readonly string[]>(() => {
    const ann = this.node().sidecar?.annotations;
    const fromAnn = ann?.['tags'];
    if (Array.isArray(fromAnn)) {
      return fromAnn.filter((t): t is string => typeof t === 'string' && t.length > 0);
    }
    const legacy = legacyFrontmatterMetadata(this.node().frontmatter)?.['tags'];
    if (Array.isArray(legacy)) {
      return legacy.filter((t): t is string => typeof t === 'string' && t.length > 0);
    }
    return [];
  });

  /** Top-3 tags rendered as chips. */
  protected readonly visibleTags = computed<readonly string[]>(() => this.tags().slice(0, 3));

  /** "+N more" suffix when the tag list overflows the visible cap. */
  protected readonly moreTagsCount = computed<number>(() => Math.max(0, this.tags().length - 3));

  /**
   * Anthropic vendor `color` from agent frontmatter — drives the card's
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

  /** Outgoing link count — `node.linksOutCount` wins, `stats.linksOut` is the fallback. */
  protected readonly linksOut = computed<number>(
    () => this.node().linksOutCount ?? this.stats().linksOut ?? 0,
  );
  /** Incoming link count — `node.linksInCount` wins, `stats.linksIn` is the fallback. */
  protected readonly linksIn = computed<number>(
    () => this.node().linksInCount ?? this.stats().linksIn ?? 0,
  );

  /**
   * Step 9.6.5 — true when the node's sidecar overlay reports drift.
   * Drives the stale badge in the footer status cluster.
   */
  protected readonly isStale = computed<boolean>(() => isStaleSidecar(this.node().sidecar));

  protected readonly sidecarStatus = computed<TSidecarStatus>(() => {
    return this.node().sidecar?.status ?? null;
  });

  protected readonly sidecarTooltip = computed<string>(() => {
    switch (this.sidecarStatus()) {
      case 'stale-body':
        return this.texts.sidecar.staleBody;
      case 'stale-frontmatter':
        return this.texts.sidecar.staleFrontmatter;
      case 'stale-both':
        return this.texts.sidecar.staleBoth;
      default:
        return '';
    }
  });

  protected readonly displayName = computed<string>(() => {
    const fm = this.node().frontmatter;
    return fm.name || this.node().path;
  });

  /** Description shown in the scrollable read-only block. */
  protected readonly description = computed<string>(() => {
    return this.node().frontmatter.description ?? '';
  });

  /**
   * Total declared tools across the per-kind vendor surface. For
   * `agent` the source is `tools[]` (allowlist); for `skill` /
   * `command` the source is the skill-base `allowed-tools` field
   * (Anthropic spelling, accepts string or string[]). Renders as a
   * single wrench-icon stat in the footer with a tooltip that breaks
   * the two halves down.
   *
   * The pre-curation skill-map-invented `allowedTools` (camelCase) on
   * the base shape was dropped at catalog curation 2026-05-07.
   */
  protected readonly toolsCount = computed<number>(() => {
    const { agentTools, skillBaseAllowedTools } = this.toolsBreakdown();
    return agentTools + skillBaseAllowedTools;
  });

  protected readonly toolsTooltip = computed<string>(() => {
    const { agentTools, skillBaseAllowedTools } = this.toolsBreakdown();
    return this.texts.stats.toolsBreakdown(agentTools, skillBaseAllowedTools);
  });

  /** Per-kind tool count split — agent `tools[]` vs skill-base `allowed-tools`. */
  private toolsBreakdown(): { agentTools: number; skillBaseAllowedTools: number } {
    const n = this.node();
    const fm = n.frontmatter as Record<string, unknown>;
    const agentTools = n.kind === 'agent' && Array.isArray(fm['tools'])
      ? (fm['tools'] as unknown[]).length
      : 0;
    const allowed = fm['allowed-tools'];
    let skillBaseAllowedTools = 0;
    if (n.kind === 'skill' || n.kind === 'command') {
      if (Array.isArray(allowed)) skillBaseAllowedTools = allowed.length;
      else if (typeof allowed === 'string' && allowed.length > 0) skillBaseAllowedTools = 1;
    }
    return { agentTools, skillBaseAllowedTools };
  }

  protected toggleExpanded(event: MouseEvent): void {
    // Stop propagation so the parent [fNode] doesn't treat this as a
    // node click (which would select the node and trigger highlight).
    event.stopPropagation();
    this.expanded.update((v) => !v);
  }
}

function compactNumber(n: number): string {
  if (n < 1_000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}
