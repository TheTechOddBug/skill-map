import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  computed,
} from '@angular/core';
import type { OnInit } from '@angular/core';
import type { SafeHtml } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { TagModule } from 'primeng/tag';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { INSPECTOR_VIEW_TEXTS } from '../../../i18n/inspector-view.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import {
  DATA_SOURCE,
  DataSourceError,
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
import { InspectorDebugPanel } from '../../components/inspector-debug-panel/inspector-debug-panel';
import { InspectorAuditPanel } from '../../components/inspector-audit-panel/inspector-audit-panel';
import type {
  TNodeKind,
  INodeView,
  TStability,
} from '../../../models/node';
import { isStaleSidecar } from '../../../models/node';

const STABILITY_SEVERITY: Record<TStability, 'success' | 'info' | 'warn'> = {
  stable: 'success',
  experimental: 'info',
  deprecated: 'warn',
};

/**
 * Body fetch lifecycle. The body card switches its rendered branch off
 * this signal:
 *   - `idle` — no path selected yet.
 *   - `loading` — `getNode(path, {includeBody: true})` is in flight.
 *   - `empty` — fetch returned but the file is body-less.
 *   - `unavailable` — fetch returned `body: null`.
 *   - `error` — markdown render or fetch threw.
 *   - `ready` — `bodyHtml()` is populated.
 */
type TBodyState = 'idle' | 'loading' | 'empty' | 'unavailable' | 'error' | 'ready';

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
    EmptyState,
    LinkedNodesPanel,
    AnnotationsPanel,
    VendorFrontmatter,
    PluginContributions,
    InspectorDebugPanel,
    InspectorAuditPanel,
  ],
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

  protected readonly texts = INSPECTOR_VIEW_TEXTS;

  readonly path = input<string | undefined>(undefined);
  readonly mode = input<TInspectorMode>('standalone');

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
   * Catalog curation 2026-05-07 made the sidecar `annotations.version`
   * the canonical source; legacy `frontmatter.metadata.version` is the
   * fallback.
   */
  protected readonly headerVersion = computed<string | null>(() => {
    const n = this.node();
    if (!n) return null;
    const ann = n.sidecar?.annotations;
    if (ann && typeof ann['version'] === 'number') return `v${ann['version']}`;
    const v = n.frontmatter.metadata.version;
    return v ? `v${v}` : null;
  });

  /** Effective stability (sidecar wins, frontmatter fallback). */
  protected readonly headerStability = computed<TStability | null>(() => {
    const n = this.node();
    if (!n) return null;
    const ann = n.sidecar?.annotations;
    const fromAnn = ann?.['stability'];
    if (fromAnn === 'stable' || fromAnn === 'experimental' || fromAnn === 'deprecated') {
      return fromAnn;
    }
    return n.frontmatter.metadata.stability ?? null;
  });

  /** Banner: yellow strip when annotations.supersededBy is set. */
  protected readonly headerSupersededBy = computed<string | null>(() => {
    const n = this.node();
    if (!n) return null;
    const ann = n.sidecar?.annotations;
    const fromAnn = ann?.['supersededBy'];
    if (typeof fromAnn === 'string' && fromAnn.length > 0) return fromAnn;
    const legacy = n.frontmatter.metadata.supersededBy;
    return typeof legacy === 'string' && legacy.length > 0 ? legacy : null;
  });

  /**
   * Body card state.
   */
  protected readonly bodyState = signal<TBodyState>('idle');
  protected readonly bodyHtml = signal<SafeHtml | null>(null);
  private fetchToken = 0;

  // --- Step 14.5.b dead-link verification (preserved) ---
  protected readonly verifiedAlive = signal<ReadonlySet<string>>(new Set());
  protected readonly verifiedDead = signal<ReadonlySet<string>>(new Set());
  protected readonly verifyInFlight = signal<ReadonlySet<string>>(new Set());

  // --- Catalog curation: collapsed-by-default sections ---
  protected readonly auditExpanded = signal<boolean>(false);
  protected readonly pluginsExpanded = signal<boolean>(false);
  protected readonly behaviorExpanded = signal<boolean>(false);
  protected readonly integrationsExpanded = signal<boolean>(false);
  protected readonly debugVisible = signal<boolean>(false);

  constructor() {
    effect(() => {
      const path = this.path();
      const myToken = ++this.fetchToken;
      this.bodyHtml.set(null);
      this.verifiedAlive.set(new Set());
      this.verifiedDead.set(new Set());
      this.verifyInFlight.set(new Set());
      // Reset collapsed state on navigation so the next node opens
      // with the locked default surface (catalog curation 2026-05-07).
      this.auditExpanded.set(false);
      this.pluginsExpanded.set(false);
      this.debugVisible.set(false);
      if (!path) {
        this.bodyState.set('idle');
        return;
      }
      this.bodyState.set('loading');
      void this.fetchAndRenderBody(path, myToken);
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
    const path = this.path();
    if (!path) return;
    if (this.bodyState() === 'loading') return;
    const myToken = ++this.fetchToken;
    this.bodyHtml.set(null);
    this.bodyState.set('loading');
    void this.fetchAndRenderBody(path, myToken);
  }

  // ---------------------------------------------------------------------------
  // Catalog curation collapsible toggles
  // ---------------------------------------------------------------------------

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
  // Step 9.6.5 — bump button state + handler
  // ---------------------------------------------------------------------------

  protected readonly canBump = computed<boolean>(() => {
    const n = this.node();
    if (!n) return false;
    const overlay = n.sidecar;
    if (!overlay || overlay.present === false) return true;
    if (overlay.status === 'fresh') return false;
    return isStaleSidecar(overlay);
  });

  protected readonly bumpInFlight = signal<boolean>(false);
  protected readonly bumpError = signal<string | null>(null);

  protected readonly bumpTooltip = computed<string>(() => {
    if (!this.canBump()) return this.texts.bump.tooltipDisabledFresh;
    return this.texts.bump.tooltipEnabled;
  });

  protected async onBumpClick(): Promise<void> {
    const n = this.node();
    if (!n) return;
    if (!this.canBump()) return;
    if (this.bumpInFlight()) return;
    this.bumpInFlight.set(true);
    this.bumpError.set(null);
    try {
      await this.sidecarService.bump(n.path);
    } catch (err) {
      this.bumpError.set(this.formatBumpError(err));
    } finally {
      this.bumpInFlight.set(false);
    }
  }

  protected dismissBumpError(): void {
    this.bumpError.set(null);
  }

  private formatBumpError(err: unknown): string {
    if (err instanceof DataSourceError) {
      switch (err.code) {
        case 'sidecar-fresh':
          return `${this.texts.bump.errorPrefix} ${this.texts.bump.errorFresh}`;
        case 'not-found':
          return `${this.texts.bump.errorPrefix} ${this.texts.bump.errorNotFound}`;
        default:
          return `${this.texts.bump.errorPrefix} ${err.message || this.texts.bump.errorGeneric}`;
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    return `${this.texts.bump.errorPrefix} ${message || this.texts.bump.errorGeneric}`;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async fetchAndRenderBody(path: string, token: number): Promise<void> {
    try {
      const detail = await this.dataSource.getNode(path, { includeBody: true });
      if (token !== this.fetchToken) return;
      if (detail === null) {
        this.bodyState.set('unavailable');
        return;
      }
      const body = detail.item.body;
      if (body === null) {
        this.bodyState.set('unavailable');
        return;
      }
      if (body === undefined || body.trim().length === 0) {
        this.bodyState.set('empty');
        return;
      }
      const html = await this.markdown.render(body);
      if (token !== this.fetchToken) return;
      this.bodyHtml.set(html);
      this.bodyState.set('ready');
    } catch {
      if (token !== this.fetchToken) return;
      this.bodyState.set('error');
    }
  }
}

/**
 * Format an ISO 8601 datetime as a coarse relative phrase
 * (`2 days ago`, `just now`). Defensive parsing — unparseable
 * strings fall back to the raw value so the header still surfaces
 * something useful. Duplicated from the audit panel; both call
 * sites stay independent so the inspector doesn't import a private
 * helper from a leaf component.
 */
function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const ms = Date.now() - d.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} month${month === 1 ? '' : 's'} ago`;
  const year = Math.floor(day / 365);
  return `${year} year${year === 1 ? '' : 's'} ago`;
}
