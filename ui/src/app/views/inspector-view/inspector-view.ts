import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { OnInit } from '@angular/core';

import type { IIssueApi } from '../../../models/api';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';

import { INSPECTOR_VIEW_TEXTS } from '../../../i18n/inspector-view.texts';
import { NODE_OPEN_INTENT } from '../../slots/node-open-intent';
import { CollectionLoaderService } from '../../../services/collection-loader';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';
import { MarkdownRenderer } from '../../../services/markdown-renderer';
import { setupInlineMarkdown } from '../../../services/markdown-inline-signal';
import { SidecarService } from '../../../services/sidecar';
import { AnnotationsPanel } from '../../components/annotations-panel/annotations-panel';
import { LinkedNodesPanel } from '../../components/linked-nodes-panel/linked-nodes-panel';
import { VendorFrontmatter } from '../../components/vendor-frontmatter/vendor-frontmatter';
import { PluginContributions } from '../../components/plugin-contributions/plugin-contributions';
import { InspectorSlotsPanel } from '../../components/inspector-slots-panel/inspector-slots-panel';
import { InspectorDebugPanel } from '../../components/inspector-debug-panel/inspector-debug-panel';
import { InspectorAuditPanel } from '../../components/inspector-audit-panel/inspector-audit-panel';
import { InspectorHeader } from '../../components/inspector-header/inspector-header';
import { CollapsibleSection } from '../../components/collapsible-section/collapsible-section';
import { NODE_CARD_TEXTS } from '../../../i18n/node-card.texts';
import { DEFAULT_SETTINGS } from '../../../models/settings';
import { setupBodyState, type IBodyStateHandle } from './inspector-body-state';
import { setupBumpController, type IBumpHandle } from './inspector-bump-controller';
import {
  setupDeadLinkVerification,
  type IDeadLinkHandle,
} from './inspector-dead-link.controller';
import {
  setupSectionCollapse,
  type ISectionCollapseHandle,
  type TInspectorSectionId,
} from './inspector-section-collapse.controller';
import {
  setupInspectorDerivations,
  type IInspectorDerivationsHandle,
} from './inspector-derivations';
import type { INodeView } from '../../../models/node';
import { effectiveSupersededBy } from '../../../models/node-derived';

@Component({
  selector: 'sm-inspector-view',
  imports: [
    ButtonModule,
    TooltipModule,
    ConfirmDialogModule,
    LinkedNodesPanel,
    AnnotationsPanel,
    VendorFrontmatter,
    PluginContributions,
    InspectorSlotsPanel,
    InspectorDebugPanel,
    InspectorAuditPanel,
    InspectorHeader,
    CollapsibleSection,
  ],
  providers: [ConfirmationService],
  templateUrl: './inspector-view.html',
  styleUrl: './inspector-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorView implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly nodeOpenIntent = inject(NODE_OPEN_INTENT);
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);
  private readonly markdown = inject(MarkdownRenderer);
  private readonly sidecarService = inject(SidecarService);
  private readonly confirmation = inject(ConfirmationService);

  protected readonly texts = INSPECTOR_VIEW_TEXTS;
  /** Reused to format the sub-stat tooltips identically to the card. */
  protected readonly cardTexts = NODE_CARD_TEXTS;

  /**
   * Hardcoded "Generate summary / Run audit / Validate" mock buttons.
   * See template `@if (showActionMocks)`. Defaults to false so users
   * don't see non-functional buttons until plugin-contributed verbs
   * land. Flip the corresponding `DEFAULT_SETTINGS.inspector.actionMocks`
   * key (or layer it in via a project settings file) to iterate on
   * the visual layout locally.
   */
  protected readonly showActionMocks = DEFAULT_SETTINGS.inspector.actionMocks;

  readonly path = input<string | undefined>(undefined);

  /**
   * Currently-active tag selection (the one whose matching nodes the
   * graph view has highlighted via Foblex `flow.select`). Forwarded
   * to `<sm-annotations-panel>` so the matching chip(s) render in
   * their "active" visual state. `null` when no tag selection is
   * active.
   */
  readonly activeTag = input<string | null>(null);

  /**
   * Emitted when the user clicks a tag chip in the annotations panel.
   * The host (graph view) uses Foblex Flow's native
   * `flow.select(matchingPaths, [])` to multi-select every node whose
   * frontmatter.tags / sidecar.annotations.tags carries the tag.
   * Toggle: clicking the chip whose tag is already the active
   * selection clears it.
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
   * Skill identifier -> node path map for the current scan. An agent's
   * `skills: [...]` lists skills by identifier (the skill node's
   * `frontmatter.name`); the vendor frontmatter uses this to turn a
   * resolvable identifier into a link to the skill node. Built locally
   * from the loaded nodes, nothing is persisted.
   */
  protected readonly skillPathByName = computed<ReadonlyMap<string, string>>(() => {
    const map = new Map<string, string>();
    for (const n of this.loader.nodes()) {
      if (n.kind !== 'skill') continue;
      const name = n.frontmatter?.name;
      if (typeof name === 'string' && name.length > 0) map.set(name, n.path);
    }
    return map;
  });

  /** Banner: yellow strip when annotations.supersededBy is set. */
  protected readonly headerSupersededBy = computed<string | null>(() =>
    effectiveSupersededBy(this.node()),
  );

  /**
   * Co-located `.sm` sidecar file name for the active node (the `.md`
   * basename with the `.sm` extension, no directory). Surfaced in the
   * Annotations section so the user sees which file the annotations live
   * in.
   */
  protected readonly sidecarFileName = computed<string | null>(() => {
    const p = this.node()?.path;
    if (!p) return null;
    const file = p.split('/').pop() ?? p;
    return file.replace(/\.md$/, '.sm');
  });

  /**
   * Body card state machine, owned by `setupBodyState` helper. Field
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

  /** Active node's description rendered as inline markdown (emphasis / code / links). */
  protected readonly descriptionHtml = setupInlineMarkdown(
    () => this.node()?.frontmatter.description ?? '',
    this.markdown,
  );

  // Dead-link verification cache + verify round-trip. Owned by the
  // extracted controller; the inspector template binds through the
  // protected adapters below.
  private readonly deadLink: IDeadLinkHandle = setupDeadLinkVerification({
    path: this.path,
    pathSet: this.pathSet,
    dataSource: this.dataSource,
  });

  // Per-section collapse state, persisted to localStorage (global, not
  // per-node) so it survives navigation + reload. All sections default
  // to expanded. Template binds through `expanded()` / `toggleSection()`.
  private readonly sectionCollapse: ISectionCollapseHandle = setupSectionCollapse();
  protected expanded(id: TInspectorSectionId): boolean {
    return this.sectionCollapse.expanded(id);
  }
  protected toggleSection(id: TInspectorSectionId): void {
    this.sectionCollapse.toggle(id);
  }

  // Per-node section visibility / audit summary derivations.
  private readonly derivations: IInspectorDerivationsHandle = setupInspectorDerivations({
    node: this.node,
  });
  protected readonly sidecarRoot = this.derivations.sidecarRoot;
  protected readonly hasVendorFrontmatter = this.derivations.hasVendorFrontmatter;
  protected readonly hasPluginContributions = this.derivations.hasPluginContributions;
  protected readonly hasViewContributions = this.derivations.hasViewContributions;

  /**
   * Per-node issues for the findings card. Lazily fetched via
   * `listIssues({ node })` so the inspector can show the actual
   * messages + fix hints emitted by analyzers like `broken-ref`.
   * Populated from the BFF response. No spinner / error UI yet, the
   * user asked for basic.
   */
  protected readonly issues = signal<IIssueApi[]>([]);
  private readonly issuesLoaderEffect = effect((onCleanup) => {
    // Track `node()` (not just `path()`) so this re-runs both on
    // navigation AND whenever the persisted scan reloads (the loader
    // re-runs `load()` on every `scan.completed`). That keeps the
    // Findings card in sync after the user edits + re-scans the file.
    const node = this.node();
    this.issues.set([]);
    if (!node) return;
    const path = node.path;
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    void this.dataSource
      .listIssues({ node: path })
      .then((env) => {
        if (!cancelled) this.issues.set(env.items);
      })
      .catch(() => {
        if (!cancelled) this.issues.set([]);
      });
  });

  /**
   * True when the active node has a `frontmatter-parse-error` finding,
   * i.e. its YAML frontmatter failed to parse. Forwarded to the header
   * so it shows the filename fallback title + the "invalid frontmatter"
   * badge instead of rendering a blank `<h2>`.
   */
  protected readonly frontmatterInvalid = computed<boolean>(() =>
    this.issues().some((i) => i.analyzerId === 'frontmatter-parse-error'),
  );

  ngOnInit(): void {
    if (this.loader.nodes().length === 0 && !this.loader.loading()) {
      void this.loader.load();
    }
  }

  openPath(path: string): void {
    this.nodeOpenIntent.open(path);
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

  // Dead-link verification adapters: bound by the template / the
  // annotations panel. Delegate to the controller.
  protected linkStatus(path: string): 'live' | 'dead-confirmed' | 'dead-heuristic' {
    return this.deadLink.linkStatus(path);
  }
  protected isVerifying(path: string): boolean {
    return this.deadLink.isVerifying(path);
  }
  protected verifyDeadLink(path: string): Promise<void> {
    return this.deadLink.verifyDeadLink(path);
  }

  /**
   * Forwarded from `<sm-inspector-header (favoriteToggle)>`. The header
   * emits the path so we don't have to re-resolve `node()` here. The
   * inspector is reachable from the deep-link route too, so the loader
   * call lives here rather than on the parent graph view.
   */
  protected onHeaderFavoriteToggle(path: string): void {
    const n = this.node();
    if (!n || n.path !== path) return;
    void this.loader.toggleFavorite(path, !n.isFavorite);
  }

  // Step 9.6.5 bump button. State + handler + consent retry live in
  // `inspector-bump-controller.ts`. The handle is constructed below;
  // the template binds the protected getters here.
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
