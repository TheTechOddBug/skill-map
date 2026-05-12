import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  computed,
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
import { InspectorSlotsPanel } from '../../components/inspector-slots-panel/inspector-slots-panel';
import { InspectorDebugPanel } from '../../components/inspector-debug-panel/inspector-debug-panel';
import { InspectorAuditPanel } from '../../components/inspector-audit-panel/inspector-audit-panel';
import { InspectorHeader } from '../../components/inspector-header/inspector-header';
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
import { relativeTime } from '../../../models/node-derived';

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
    InspectorSlotsPanel,
    InspectorDebugPanel,
    InspectorAuditPanel,
    InspectorHeader,
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
   * Body card state machine — owned by `setupBodyState` helper. Field
   * initializers run in the component's injection context so the inner
   * `effect()` resolves cleanly without going through the constructor
   * body. The handle's signals are exposed directly so the template
   * binds them with zero indirection overhead.
   */
  private readonly bodyHandle: IBodyStateHandle = setupBodyState({
    path: this.path,
    dataSource: this.dataSource,
    markdown: this.markdown,
  });
  protected readonly bodyState = this.bodyHandle.bodyState;
  protected readonly bodyHtml = this.bodyHandle.bodyHtml;

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

    // Embedded-mode focus dance (close button) lives inside
    // `<sm-inspector-header>` — see inspector-header.ts.
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
    this.openPath(path);
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
   * Mirrors `<sm-vendor-frontmatter>`'s `hasVendorSurface` predicate —
   * agents, skills, and commands all carry vendor frontmatter; notes
   * do not. Used to gate the vendor card chrome so notes don't paint
   * an empty bordered box. We deliberately don't replicate the
   * inner-field-count predicate (rare edge case: an agent with zero
   * populated fields still surfaces the section's "(0 fields)"
   * header, which is useful debug feedback rather than chrome noise).
   */
  protected readonly hasVendorFrontmatter = computed<boolean>(() => {
    const k = this.node()?.kind;
    return k === 'agent' || k === 'skill' || k === 'command';
  });

  /**
   * Mirrors `<sm-plugin-contributions>`'s `count > 0` predicate. The
   * child classifies every non-reserved root key as either a
   * registered namespace, a registered root contribution, or an
   * unregistered namespace — count equals the number of non-reserved
   * top-level keys regardless of catalog state. Reserved blocks per
   * the sidecar schema: `identity`, `annotations`, `settings`, `audit`.
   */
  protected readonly hasPluginContributions = computed<boolean>(() => {
    const root = this.sidecarRoot();
    if (!root) return false;
    const RESERVED: ReadonlySet<string> = new Set([
      'identity',
      'annotations',
      'settings',
      'audit',
    ]);
    for (const key of Object.keys(root)) {
      if (!RESERVED.has(key)) return true;
    }
    return false;
  });

  /**
   * True when any of the six inspector-body slots has matching
   * contributions on this node. Filtering by qualified slot id keeps
   * us in sync with the host instances rendered in the template; if
   * one is removed or renamed, the predicate stays correct because
   * the slot list lives here too.
   */
  private static readonly INSPECTOR_BODY_SLOTS: ReadonlySet<string> = new Set([
    'inspector.body.panel.breakdown',
    'inspector.body.panel.records',
    'inspector.body.panel.tree',
    'inspector.body.panel.key-values',
    'inspector.body.panel.link-list',
    'inspector.body.panel.markdown',
  ]);

  protected readonly hasViewContributions = computed<boolean>(() => {
    const contributions = this.node()?.contributions ?? [];
    for (const c of contributions) {
      if (InspectorView.INSPECTOR_BODY_SLOTS.has(c.slot)) return true;
    }
    return false;
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
   * Forwarded from `<sm-inspector-header (favoriteToggle)>`. The header
   * emits the path so we don't have to re-resolve `node()` here. The
   * inspector is reachable from the deep-link route too, so the
   * loader call lives here rather than on the parent graph view.
   */
  protected onHeaderFavoriteToggle(path: string): void {
    const n = this.node();
    if (!n || n.path !== path) return;
    void this.loader.toggleFavorite(path, !n.isFavorite);
  }

  /** Forwarded from `<sm-inspector-header (close)>` — re-emits to the host. */
  protected onHeaderClose(): void {
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

  private readonly bumpHandle: IBumpHandle = setupBumpController({
    node: this.node,
    sidecarService: this.sidecarService,
    confirmation: this.confirmation,
  });
  protected readonly canBump = this.bumpHandle.canBump;
  protected readonly bumpInFlight = this.bumpHandle.bumpInFlight;
  protected readonly bumpError = this.bumpHandle.bumpError;
  protected readonly bumpTooltip = this.bumpHandle.bumpTooltip;
  protected onBumpClick(): Promise<void> { return this.bumpHandle.onBumpClick(); }
  protected dismissBumpError(): void { this.bumpHandle.dismissBumpError(); }
}
