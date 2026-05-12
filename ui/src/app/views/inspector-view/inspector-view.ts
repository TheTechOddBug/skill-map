import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  computed,
  viewChild,
  type ElementRef,
} from '@angular/core';
import type { OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TagModule } from 'primeng/tag';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';

import { INSPECTOR_VIEW_TEXTS } from '../../../i18n/inspector-view.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';
import { KindRegistryService } from '../../../services/kind-registry';
import { MarkdownRenderer } from '../../../services/markdown-renderer';
import { SidecarService } from '../../../services/sidecar';
import { AnnotationsPanel } from '../../components/annotations-panel/annotations-panel';
import { EmptyState } from '../../components/empty-state/empty-state';
import { LinkedNodesPanel } from '../../components/linked-nodes-panel/linked-nodes-panel';
import { VendorFrontmatter } from '../../components/vendor-frontmatter/vendor-frontmatter';
import { PluginContributions } from '../../components/plugin-contributions/plugin-contributions';
import { ViewContributionsHost } from '../../components/view-contributions-host/view-contributions-host';
import { InspectorDebugPanel } from '../../components/inspector-debug-panel/inspector-debug-panel';
import { InspectorAuditPanel } from '../../components/inspector-audit-panel/inspector-audit-panel';
import { KindIcon } from '../../components/kind-icon/kind-icon';
import { NODE_CARD_TEXTS } from '../../../i18n/node-card.texts';
import { DEFAULT_SETTINGS } from '../../../models/settings';
import { setupBodyState, type IBodyStateHandle } from './inspector-body-state';
import { setupBumpController, type IBumpHandle } from './inspector-bump-controller';
import type {
  TNodeKind,
  INodeView,
  TStability,
} from '../../../models/node';
import { legacyFrontmatterMetadata } from '../../../models/node';
import {
  effectiveIsStale,
  effectiveStability,
  effectiveStaleTooltip,
  effectiveToolsList,
  effectiveVersion,
  relativeTime,
} from '../../../models/node-derived';

const STABILITY_SEVERITY: Record<TStability, 'success' | 'info' | 'warn'> = {
  stable: 'success',
  experimental: 'info',
  deprecated: 'warn',
};

/**
 * The inspector serves dual-purpose:
 *
 *   - `'standalone'` (default) — full page rendered when the user
 *     navigates to a deep-linked path directly. Shows the back link
 *     to the list view and the v0.8.0 placeholder cards.
 *   - `'embedded'` — rendered inside the graph view's slide-in panel.
 *     The chrome and placeholder cards are hidden and the card grid
 *     compacts to a single column.
 */
type TInspectorMode = 'standalone' | 'embedded';

@Component({
  selector: 'app-inspector-view',
  imports: [
    RouterLink,
    TagModule,
    CardModule,
    ButtonModule,
    TooltipModule,
    ConfirmDialogModule,
    EmptyState,
    LinkedNodesPanel,
    AnnotationsPanel,
    VendorFrontmatter,
    PluginContributions,
    ViewContributionsHost,
    InspectorDebugPanel,
    InspectorAuditPanel,
    KindIcon,
  ],
  providers: [ConfirmationService],
  templateUrl: './inspector-view.html',
  styleUrl: './inspector-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.inspector-view--embedded]': "mode() === 'embedded'",
  },
})
export class InspectorView implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly router = inject(Router);
  private readonly kindRegistry = inject(KindRegistryService);
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);
  private readonly markdown = inject(MarkdownRenderer);
  private readonly sidecarService = inject(SidecarService);
  private readonly confirmation = inject(ConfirmationService);

  protected readonly texts = INSPECTOR_VIEW_TEXTS;
  /** Reused to format the sub-stat tooltips identically to the card. */
  protected readonly cardTexts = NODE_CARD_TEXTS;

  /**
   * Hardcoded "Generate summary / Run audit / Validate" mock buttons
   * — see template `@if (showActionMocks)`. Defaults to false so
   * users don't see non-functional buttons until plugin-contributed
   * verbs land. Flip the corresponding `DEFAULT_SETTINGS.inspector.actionMocks`
   * key (or layer it in via a project settings file) to iterate on
   * the visual layout locally.
   */
  protected readonly showActionMocks = DEFAULT_SETTINGS.inspector.actionMocks;

  readonly path = input<string | undefined>(undefined);
  readonly mode = input<TInspectorMode>('standalone');

  /**
   * Currently-active tag selection (the one whose matching nodes the
   * graph view has highlighted via Foblex `flow.select`). Forwarded
   * to `<sm-annotations-panel>` so the matching chip(s) render in
   * their "active" visual state. `null` when no tag selection is
   * active. Standalone-mode hosts pass `null` here — there's no
   * graph-side selection to mirror.
   */
  readonly activeTag = input<string | null>(null);

  /**
   * Generic "user wants this inspector closed" intent. Emitted by the
   * X button in the header (rendered only in embedded mode). The host
   * decides what closing means — graph-view clears its `selectedNodeId`
   * to slide the panel out; a future host with a different shell could
   * route, focus elsewhere, etc.
   */
  readonly close = output<void>();

  /**
   * Emitted when the user clicks a tag chip in the annotations panel.
   * The host (graph view in embedded mode) uses Foblex Flow's native
   * `flow.select(matchingPaths, [])` to multi-select every node whose
   * frontmatter.tags / sidecar.annotations.tags carries the tag.
   * Toggle: clicking the chip whose tag is already the active
   * selection clears it. Standalone-mode hosts can ignore this output
   * (no graph to mutate), or wire it into list-view filtering once
   * that surface gets a multi-select equivalent.
   */
  readonly tagSelect = output<string>();

  /**
   * Close button host element. Used to focus the X when the panel
   * opens (embedded mode + path transitions from null to set), so
   * keyboard users don't have to tab from wherever they were on the
   * graph canvas. Mirrors the focus dance the graph-view used to own
   * before the close button moved into the inspector.
   */
  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');

  readonly node = computed<INodeView | null>(() => {
    const path = this.path();
    if (!path) return null;
    return this.loader.nodes().find((n) => n.path === path) ?? null;
  });

  /** O(1) path lookup, rebuilt only when the loaded nodes change. */
  protected readonly pathSet = computed<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    for (const n of this.loader.nodes()) set.add(n.path);
    return set;
  });

  /**
   * Effective sidecar overlay version label for the inspector header.
   * Source contract — see `effectiveVersion` (sidecar wins, legacy
   * frontmatter fallback).
   */
  protected readonly headerVersion = computed<string | null>(() => effectiveVersion(this.node()));

  /** Effective stability — see `effectiveStability` for source contract. */
  protected readonly headerStability = computed<TStability | null>(() =>
    effectiveStability(this.node()),
  );

  /**
   * Catalog curation refinement (2026-05-07): the inspector title
   * surfaces the vendor `frontmatter.color` as a subtle shading.
   * Agents typically carry a Claude vendor color (`red`, `cyan`, …);
   * non-agent kinds (or agents without a color) fall back to the
   * kind-default palette token. The result feeds a CSS variable on the
   * title element so the host stays theme-friendly.
   */
  protected readonly headerTitleColor = computed<string | null>(() => {
    const n = this.node();
    if (!n) return null;
    const fm = n.frontmatter as Record<string, unknown>;
    const c = fm['color'];
    if (typeof c === 'string' && c.length > 0) return c;
    return `var(--sm-kind-${n.kind})`;
  });

  /**
   * Header tools — vendor frontmatter `tools` (agents) /
   * `allowed-tools` (skills / commands) rendered as individual chips
   * in the header. Source contract — see `effectiveToolsList`. Empty
   * array when the node carries no tools (notes, agentless skills);
   * the row hides itself in that case.
   *
   * Numeric stats (tokens / bytes / activity date / links / ext refs)
   * intentionally do NOT live in the header anymore: each one is
   * already surfaced in the cards below (`stats`, `linked-nodes`),
   * and duplicating them in the header turned it into noise. Tools
   * stay because they're identity-level (what the agent CAN do) and
   * the count alone wasn't enough — the names are the useful part.
   */
  protected readonly headerTools = computed<readonly string[]>(() =>
    effectiveToolsList(this.node()),
  );

  /**
   * Author tags projected from `node.frontmatter.tags`. Passed into
   * `<sm-annotations-panel>` so the Taxonomy section can render them
   * alongside user tags (from sidecar annotations) with explicit
   * attribution. Sorted ascending; defensive against stringy /
   * malformed inputs (non-strings filtered out at projection time).
   */
  protected readonly authorTags = computed<readonly string[]>(() => {
    const fm = (this.node()?.frontmatter ?? {}) as Record<string, unknown>;
    const raw = fm['tags'];
    if (!Array.isArray(raw)) return [];
    const tags = raw.filter((t): t is string => typeof t === 'string' && t.length > 0);
    return [...new Set(tags)].sort();
  });

  /**
   * Stale flag for the header — drives the clock icon next to the
   * stability/version cluster. Same source as the card via
   * `effectiveIsStale`.
   */
  protected readonly headerIsStale = computed<boolean>(() => effectiveIsStale(this.node()));

  /**
   * Tooltip text matched to the sidecar's drift status. Reuses the
   * card's i18n table so card and panel speak the same language for
   * the same condition.
   */
  protected readonly headerStaleTooltip = computed<string>(() =>
    effectiveStaleTooltip(this.node(), NODE_CARD_TEXTS.sidecar),
  );

  /** Banner: yellow strip when annotations.supersededBy is set. */
  protected readonly headerSupersededBy = computed<string | null>(() => {
    const n = this.node();
    if (!n) return null;
    const ann = n.sidecar?.annotations;
    const fromAnn = ann?.['supersededBy'];
    if (typeof fromAnn === 'string' && fromAnn.length > 0) return fromAnn;
    const legacy = legacyFrontmatterMetadata(n.frontmatter)?.['supersededBy'];
    return typeof legacy === 'string' && legacy.length > 0 ? legacy : null;
  });

  /**
   * Body card state machine — owned by `setupBodyState` helper.
   * The handle is created in the constructor (effect-requires-injection-context)
   * and surfaced through the protected getters below. Template binds
   * `bodyState()` / `bodyHtml()` / `refreshBody()` unchanged.
   */
  private bodyHandle!: IBodyStateHandle;
  protected get bodyState(): IBodyStateHandle['bodyState'] { return this.bodyHandle.bodyState; }
  protected get bodyHtml(): IBodyStateHandle['bodyHtml'] { return this.bodyHandle.bodyHtml; }

  // --- Step 14.5.b dead-link verification (preserved) ---
  protected readonly verifiedAlive = signal<ReadonlySet<string>>(new Set());
  protected readonly verifiedDead = signal<ReadonlySet<string>>(new Set());
  protected readonly verifyInFlight = signal<ReadonlySet<string>>(new Set());

  // --- Catalog curation: collapsed-by-default sections ---
  // (Vendor-frontmatter section state now lives inside the component itself
  // since the consolidated 2026-05-07 refinement folded the tiering into
  // a single Provider-specific section it owns.)
  protected readonly auditExpanded = signal<boolean>(false);
  protected readonly pluginsExpanded = signal<boolean>(false);
  protected readonly debugVisible = signal<boolean>(false);

  constructor() {
    // Body fetch lifecycle lives in `setupBodyState` helper. The
    // handle is constructed here so the inner `effect()` lands in this
    // component's injection context.
    this.bodyHandle = setupBodyState({
      path: this.path,
      dataSource: this.dataSource,
      markdown: this.markdown,
    });

    // Bump verb (Step 9.6.5 — sidecar version bump + consent retry)
    // owned by the controller helper.
    this.bumpHandle = setupBumpController({
      node: this.node,
      sidecarService: this.sidecarService,
      confirmation: this.confirmation,
    });

    // Step 14.5.b — dead-link verification cache reset. Kept independent
    // from the body fetch so changing the verify policy never reorders
    // the body fetch lifecycle.
    effect(() => {
      this.path();
      this.verifiedAlive.set(new Set());
      this.verifiedDead.set(new Set());
      this.verifyInFlight.set(new Set());
    });

    // Catalog curation 2026-05-07 — collapsed-by-default sections snap
    // back to closed on every navigation so the next node opens with
    // the locked default surface (audit + plugins collapsed, debug
    // hidden). Kept independent from the body fetch so future tweaks
    // to the policy (e.g. "audit stays expanded across nav") only
    // touch this effect.
    effect(() => {
      this.path();
      this.auditExpanded.set(false);
      this.pluginsExpanded.set(false);
      this.debugVisible.set(false);
    });

    // Embedded-mode focus dance — when the inspector receives a path
    // transition from null/undefined to a string AND we're rendering
    // inside the graph-view's slide-in panel, focus the close button
    // so keyboard users land on a meaningful target. `queueMicrotask`
    // defers the focus call until the X button is in the DOM (the
    // template branches on `path()` and `mode()` before rendering it).
    //
    // `preventScroll: true` is mandatory: the panel uses a 220ms
    // `translateX` animation, so when this effect fires the X is
    // partially off-screen. A bare `.focus()` would call
    // `scrollIntoView` on a transforming element, which forces the
    // browser to add horizontal scroll on the document — and because
    // `.shell__main` has `overflow-y: auto`, the cascading reflow
    // shifts the canvas-wrap laterally. Visible symptom: the whole
    // graph "moves and then relocates" every time the panel opens.
    effect(() => {
      const path = this.path();
      const mode = this.mode();
      if (mode !== 'embedded') return;
      if (!path) return;
      queueMicrotask(() => this.closeBtn()?.nativeElement.focus({ preventScroll: true }));
    });
  }

  ngOnInit(): void {
    if (this.loader.nodes().length === 0 && !this.loader.loading()) {
      void this.loader.load();
    }
  }

  kindLabel(kind: TNodeKind): string {
    return this.kindRegistry.labelOf(kind);
  }

  kindStyle(kind: TNodeKind): Record<string, string> {
    return {
      background: `var(--sm-kind-${kind}-bg)`,
      color: `var(--sm-kind-${kind}-fg)`,
    };
  }

  stabilitySeverity(s: TStability): 'success' | 'info' | 'warn' {
    return STABILITY_SEVERITY[s];
  }

  openPath(path: string): void {
    void this.router.navigate(['/graph'], { queryParams: { path } });
  }

  /**
   * Skill-chip click adapter for the vendor frontmatter renderer.
   * The renderer takes a function input; we pass a bound method so
   * `this` resolves correctly.
   */
  readonly onSkillChip = (path: string): void => {
    void this.openPath(path);
  };

  pathExists(path: string): boolean {
    return this.pathSet().has(path);
  }

  /**
   * Sidecar root shape exposed to the new collapsible panels (audit,
   * plugin contributions, debug). Today the BFF only ships
   * `node.sidecar.annotations`; the full `.sm` root is NOT yet on the
   * wire (catalog curation flagged this as a follow-up). We expose
   * whatever is in `node.sidecar.root` when the data-source bundles
   * the parsed payload (demo / future BFF), and fall back to a
   * synthetic root assembled from the overlay so the audit / plugin
   * panels at least know what's NOT there.
   */
  protected readonly sidecarRoot = computed<Record<string, unknown> | null>(() => {
    const overlay = this.node()?.sidecar;
    if (!overlay || !overlay.present) return null;
    if (overlay.root) return overlay.root;
    // Synthesize the minimum root so the audit / plugin panels render
    // their empty states instead of throwing on a missing input.
    const synthetic: Record<string, unknown> = {};
    if (overlay.annotations) synthetic['annotations'] = overlay.annotations;
    return synthetic;
  });

  /**
   * Audit summary for the inspector header strip. Catalog curation:
   * the collapsed audit section header surfaces the most recent
   * activity inline (`▶ Audit · last bumped 2 days ago by cli`) so the
   * user doesn't need to expand to see it.
   */
  protected readonly auditSummary = computed<string>(() => {
    const root = this.sidecarRoot();
    if (!root) return this.texts.audit.headerEmpty;
    const audit = root['audit'];
    if (typeof audit !== 'object' || audit === null) return this.texts.audit.headerEmpty;
    const a = audit as Record<string, unknown>;
    const lastBumpedAt = typeof a['lastBumpedAt'] === 'string' ? (a['lastBumpedAt'] as string) : null;
    const lastBumpedBy = typeof a['lastBumpedBy'] === 'string' ? (a['lastBumpedBy'] as string) : null;
    if (lastBumpedAt === null) return this.texts.audit.headerEmpty;
    return this.texts.audit.headerSummary(relativeTime(lastBumpedAt), lastBumpedBy ?? '?');
  });

  protected linkStatus(path: string): 'live' | 'dead-confirmed' | 'dead-heuristic' {
    if (this.pathSet().has(path)) return 'live';
    if (this.verifiedAlive().has(path)) return 'live';
    if (this.verifiedDead().has(path)) return 'dead-confirmed';
    return 'dead-heuristic';
  }

  protected isVerifying(path: string): boolean {
    return this.verifyInFlight().has(path);
  }

  protected async verifyDeadLink(path: string): Promise<void> {
    if (this.verifiedAlive().has(path) || this.verifiedDead().has(path)) return;
    if (this.verifyInFlight().has(path)) return;
    this.verifyInFlight.update((s) => new Set(s).add(path));
    try {
      const detail = await this.dataSource.getNode(path);
      if (detail === null) {
        this.verifiedDead.update((s) => new Set(s).add(path));
      } else {
        this.verifiedAlive.update((s) => new Set(s).add(path));
      }
    } catch {
      // Network-level failure — leave the chip unverified.
    } finally {
      this.verifyInFlight.update((s) => {
        const next = new Set(s);
        next.delete(path);
        return next;
      });
    }
  }

  protected refreshBody(): void {
    this.bodyHandle.refresh();
  }

  // ---------------------------------------------------------------------------
  // Catalog curation collapsible toggles
  // ---------------------------------------------------------------------------

  /**
   * Heart toggle in the inspector hero band — mirrors the card's
   * `<sm-node-card>.toggleFavorite`. Fires the optimistic flip + BFF
   * call directly on the loader (the inspector is reachable from the
   * deep-link route too, where there's no parent graph view to
   * delegate the emit to).
   */
  protected toggleFavorite(event: MouseEvent): void {
    event.stopPropagation();
    const n = this.node();
    if (!n) return;
    void this.loader.toggleFavorite(n.path, !n.isFavorite);
  }

  protected onCloseClick(event: MouseEvent): void {
    event.stopPropagation();
    this.close.emit();
  }

  protected toggleAudit(): void {
    this.auditExpanded.update((v) => !v);
  }
  protected togglePlugins(): void {
    this.pluginsExpanded.update((v) => !v);
  }
  protected toggleDebug(): void {
    this.debugVisible.update((v) => !v);
  }

  // ---------------------------------------------------------------------------
  // Step 9.6.5 — bump button (state + handler + consent retry live in
  // `inspector-bump-controller.ts`). The handle is constructed in the
  // constructor below; the template binds the protected getters here.
  // ---------------------------------------------------------------------------

  private bumpHandle!: IBumpHandle;
  protected get canBump(): IBumpHandle['canBump'] { return this.bumpHandle.canBump; }
  protected get bumpInFlight(): IBumpHandle['bumpInFlight'] { return this.bumpHandle.bumpInFlight; }
  protected get bumpError(): IBumpHandle['bumpError'] { return this.bumpHandle.bumpError; }
  protected get bumpTooltip(): IBumpHandle['bumpTooltip'] { return this.bumpHandle.bumpTooltip; }
  protected onBumpClick(): Promise<void> { return this.bumpHandle.onBumpClick(); }
  protected dismissBumpError(): void { this.bumpHandle.dismissBumpError(); }
}
