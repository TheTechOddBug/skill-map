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
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import { debounceTime, merge } from 'rxjs';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import type {
  IActivityNodeDetailApi,
  IActivityRunApi,
  IActivitySpawnRecordApi,
  IIssueApi,
  TIssueSeverityApi,
} from '../../../models/api';

import { INSPECTOR_VIEW_TEXTS } from '../../../i18n/inspector-view.texts';
import { activityPairKeyTouches } from '../../../models/api';
import { shortenOwner } from '../../../models/activity-owner';
import { shortExtensionLabel } from '../../../models/extension-label';
import { NODE_OPEN_INTENT } from '../../slots/node-open-intent';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { LivePreferencesService } from '../../../services/live-preferences';
import { NodeActivityStatsService } from '../../../services/node-activity-stats';
import { WsEventStreamService } from '../../../services/ws-event-stream';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';
import { MarkdownRenderer } from '../../../services/markdown-renderer';
import {
  setupInlineMarkdown,
  setupHighlightedSource,
} from '../../../services/markdown-inline-signal';
import { ActionDispatchService } from '../../../services/action-dispatch';
import { cssKindNameOrFallback } from '../../../services/css-guard';
import { activityNodeLabel, pathBasenameForLink } from '../../../services/path-basename';
import { ProviderRegistryService } from '../../../services/provider-registry';
import {
  AnnotationsPanel,
  overlayHasAnnotationsContent,
} from '../../components/annotations-panel/annotations-panel';
import { LinkedNodesPanel } from '../../components/linked-nodes-panel/linked-nodes-panel';
import { VendorFrontmatter } from '../../components/vendor-frontmatter/vendor-frontmatter';
import { PluginContributions } from '../../components/plugin-contributions/plugin-contributions';
import { InspectorPluginSections } from '../../components/inspector-plugin-sections/inspector-plugin-sections';
import { InspectorDebugPanel } from '../../components/inspector-debug-panel/inspector-debug-panel';
import { InspectorAuditPanel } from '../../components/inspector-audit-panel/inspector-audit-panel';
import { InspectorHeader } from '../../components/inspector-header/inspector-header';
import { CollapsibleSection } from '../../components/collapsible-section/collapsible-section';
import { ConversationDialog } from '../../components/conversation-dialog/conversation-dialog';
import { setupConversationDialog } from '../../components/conversation-dialog/conversation-dialog.controller';
import {
  groupSpawnThreads,
  type ISpawnThread,
} from '../../components/conversation-dialog/spawn-thread';
import { ViewContributionsHost } from '../../components/view-contributions-host/view-contributions-host';
import {
  SidecarConsentDialog,
  type ISidecarConsentDecision,
} from '../../components/sidecar-consent-dialog/sidecar-consent-dialog';
import { NODE_CARD_TEXTS } from '../../../i18n/node-card.texts';
import { setupBodyState, type IBodyStateHandle } from './inspector-body-state';
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
  setupActivityFilter,
  type IActivityFilterHandle,
  type TActivityProvenanceFilter,
} from './inspector-activity-filter.controller';
import {
  mergeActivityTimeline,
  type TActivityTimelineEntry,
} from './inspector-activity-timeline';
import {
  setupInspectorDerivations,
  type IInspectorDerivationsHandle,
} from './inspector-derivations';
import {
  setupAiActions,
  type IAiActionsHandle,
  type TFindingsBucket,
} from './inspector-ai-actions.controller';
import { setupAutoFix, type IAutoFixHandle } from './inspector-auto-fix.controller';
import { contributionSurface } from '../../../models/node-derived';
import type { INodeView } from '../../../models/node';
import type { IFindingApi, INodeSummaryRowApi, IProbExtensionEntryApi } from '../../../models/api';

/**
 * Debounce for the Activity section's live re-fetch. Live `node.activity`
 * and `agent.spawn` frames can arrive in rapid bursts (an agent lighting
 * a chain, an MCP tool called in a loop); coalescing them into one GET
 * shortly after the burst settles keeps the panel fresh without a request
 * per frame. The server is the source of truth, so a single trailing
 * re-fetch always reflects the final state.
 */
const ACTIVITY_LIVE_REFRESH_DEBOUNCE_MS = 400;

/**
 * The universal summarizer's qualified id. It owns the header's
 * semantic-analysis affordance and is EXCLUDED from the AI-actions
 * launcher row / ALL button (user shape 2026-07-21).
 */
const SUMMARIZER_EXTENSION_ID = 'core/ai-summarizer-action';

/**
 * The auto-tagger's qualified id. It owns the tag row's sparkles
 * affordance and, like the summarizer, is EXCLUDED from the AI-actions
 * launcher row / ALL button (user request 2026-07-21).
 */
const TAGGER_EXTENSION_ID = 'core/ai-tagger-action';

/** Per-node cap on the conversation threads the Activity section renders. */
const SPAWN_THREADS_LIMIT = 10;

@Component({
  selector: 'sm-inspector-view',
  imports: [
    LinkedNodesPanel,
    AnnotationsPanel,
    VendorFrontmatter,
    PluginContributions,
    InspectorPluginSections,
    InspectorDebugPanel,
    InspectorAuditPanel,
    InspectorHeader,
    CollapsibleSection,
    ConversationDialog,
    ViewContributionsHost,
    SidecarConsentDialog,
    ButtonModule,
    SelectButtonModule,
    ToggleSwitchModule,
    FormsModule,
    TooltipModule,
  ],
  templateUrl: './inspector-view.html',
  styleUrl: './inspector-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorView implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly nodeOpenIntent = inject(NODE_OPEN_INTENT);
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);
  private readonly markdown = inject(MarkdownRenderer);
  private readonly wsEvents = inject(WsEventStreamService);
  private readonly actionDispatch = inject(ActionDispatchService);
  private readonly providerRegistry = inject(ProviderRegistryService);
  private readonly activityStats = inject(NodeActivityStatsService);
  private readonly livePrefs = inject(LivePreferencesService);

  protected readonly texts = INSPECTOR_VIEW_TEXTS;
  /** Reused to format the sub-stat tooltips identically to the card. */
  protected readonly cardTexts = NODE_CARD_TEXTS;

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

  /**
   * Kind-driven accent bound onto `--accent` (the hero + every `.sm-block`
   * section rail inherit one hue per node). The kind flows into a
   * `var(--sm-kind-<kind>)` name, and since 14.5.d kinds are plugin-declared
   * open strings, so it runs through `cssKindNameOrFallback` (the shared
   * UI-side guard) before interpolation, matching `node-card`. Off-pattern
   * kinds (or no selection) degrade to the neutral `markdown` palette.
   */
  protected readonly accentVar = computed<string>(
    () => `var(--sm-kind-${cssKindNameOrFallback(this.node()?.kind)}, var(--sm-kind-markdown))`,
  );

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
   * The active node's Provider `bodyField`, if any (e.g. the codex
   * Provider's `developer_instructions`). Resolved from the provider
   * registry so no Provider id is hardcoded here: any Provider whose
   * `read.bodyField` is set drives both the inline body rendering and the
   * metadata exclusion below. `undefined` for ordinary frontmatter-fence
   * Providers.
   */
  protected readonly bodyFieldForNode = computed<string | undefined>(
    () => this.providerRegistry.lookup(this.node()?.provider ?? '')?.bodyField,
  );

  /**
   * The effective body for a `bodyField` Provider: the named frontmatter
   * field's string value (the parsed prompt already ships in
   * `node.frontmatter`). Mirrors the kernel's `resolveEffectiveBody`: the
   * `bodyField` only governs the body when the frontmatter actually carries
   * it as a string, otherwise the body comes from the file as usual.
   *
   * `undefined` (routing the body card to its on-demand fetch) when:
   *   - the node's Provider declares no `bodyField`, OR
   *   - it declares one but THIS node doesn't carry it as a string.
   * The second case matters because a Provider's `bodyField` is a per-read-
   * rule fact flattened to one value on the registry: the codex Provider
   * declares `developer_instructions` for its `.toml` agents, but its
   * open-standard `.agents/skills/<name>/SKILL.md` skills (same Provider, no
   * such field) keep a normal markdown body and must fall through to the
   * fetch, not render empty.
   */
  private readonly inlineBody = computed<string | undefined>(() => {
    const field = this.bodyFieldForNode();
    if (field === undefined) return undefined;
    const value = this.node()?.frontmatter?.[field];
    return typeof value === 'string' ? value : undefined;
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
    // Keep the open node's body live when the watcher re-scans an edit.
    scanCompleted$: this.wsEvents.scanCompleted$,
    // Structured-frontmatter Providers (codex `developer_instructions`)
    // render their already-parsed body field directly, no disk re-read.
    inlineBody: this.inlineBody,
  });
  protected readonly bodyState = this.bodyHandle.bodyState;
  protected readonly bodyHtml = this.bodyHandle.bodyHtml;
  protected readonly bodyRaw = this.bodyHandle.bodyRaw;

  /**
   * Body view mode: the rendered Markdown (default) or the raw source. A
   * toggle inside the (expanded) Body section flips it. Sticky across nodes
   * within the session (a view preference, not per-node state); ephemeral,
   * resets to `rendered` on reload.
   */
  protected readonly bodyView = signal<'rendered' | 'raw'>('rendered');
  protected toggleBodyView(): void {
    this.bodyView.update((v) => (v === 'rendered' ? 'raw' : 'rendered'));
  }

  /**
   * Raw source for the editor view, trailing blank lines trimmed so the
   * line-number gutter has no stray number on an empty final line. Leading
   * indentation is preserved (source fidelity).
   */
  protected readonly bodyRawDisplay = computed<string>(() =>
    (this.bodyRaw() ?? '').replace(/\n+$/, ''),
  );

  /** Newline-joined "1..N" gutter for the raw editor view. */
  protected readonly rawLineNumbers = computed<string>(() => {
    const text = this.bodyRawDisplay();
    if (text.length === 0) return '';
    const count = text.split('\n').length;
    let out = '';
    for (let i = 1; i <= count; i++) out += i === 1 ? '1' : `\n${i}`;
    return out;
  });

  /**
   * The raw source highlighted as Markdown code (highlight.js token spans,
   * coloured by the global `themes/highlight.css`), so the raw view reads
   * like a read-only Markdown editor instead of flat monospace text.
   */
  protected readonly rawHighlightedHtml = setupHighlightedSource(
    () => this.bodyRawDisplay(),
    this.markdown,
    'markdown',
  );

  /**
   * Whether the Body section renders at all. The body is fetched eagerly
   * on every node change (not gated by the collapse state), so the
   * lifecycle phase is known even while the section sits collapsed. We
   * show the section only while loading or once content is `ready`;
   * `empty` / `unavailable` / `error` resolve to a hidden section per the
   * operator decision, so a node with no body shows no Body section
   * instead of a "this file has no body" placeholder.
   */
  protected readonly showBody = computed<boolean>(() => {
    const s = this.bodyState();
    return s === 'loading' || s === 'ready';
  });

  /**
   * Whether the "Annotations" section has anything to render. Gates the
   * section so it is hidden entirely (instead of showing an empty panel)
   * when the sidecar carries no renderable annotations, matching how the
   * other inspector sections (`hasConnections`, `showBody`, ...) hide when
   * empty. A present sidecar with only `audit` / `identity` (no provenance
   * / repository / docs, tags live in the header) counts as empty.
   */
  protected readonly hasAnnotations = computed<boolean>(() =>
    overlayHasAnnotationsContent(this.node()?.sidecar),
  );

  /**
   * Whether the "Actions" section has anything to render: true when the
   * active node carries at least one `inspector.action.button`
   * contribution. Gates the section so it is hidden (instead of an empty
   * toolbar) for nodes with no actions (e.g. virtual nodes, or when the
   * dispatching actions are disabled). The section hosts the same slot the
   * former always-visible toolbar did.
   */
  protected readonly hasActions = computed<boolean>(() =>
    (this.node()?.contributions ?? []).some(
      (c) =>
        c.slot === 'inspector.action.button' &&
        // Re-homed surfaces (spec/view-slots.md): a payload declaring a
        // `surface` IS a dedicated affordance (version / stability /
        // tags chips + row), never a generic button; alone they must
        // not keep an empty Actions section up.
        contributionSurface(c.payload) === null,
    ),
  );

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
  // per-node) so it survives navigation + reload. Sections default to
  // collapsed except the body (see SECTION_DEFAULT_EXPANDED). Template
  // binds through `expanded()` / `toggleSection()`.
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
  protected readonly hasConnections = this.derivations.hasConnections;
  protected readonly hasPluginContributions = this.derivations.hasPluginContributions;
  protected readonly hasMetadata = this.derivations.hasMetadata;

  /**
   * Per-node issues for the findings card. Lazily fetched via
   * `listIssues({ node })` so the inspector can show the actual
   * messages + fix hints emitted by analyzers like `broken-ref`.
   * Populated from the BFF response. No spinner / error UI yet, the
   * user asked for basic.
   */
  protected readonly issues = signal<IIssueApi[]>([]);
  /**
   * Last path the issues effect fetched for. Lets the effect tell a
   * navigation (path changed) apart from a same-path reload (the loader
   * re-runs `load()` on every `scan.completed` / reconnect re-seed,
   * handing `node()` a fresh object with the same path).
   */
  private issuesPath: string | undefined = undefined;
  private readonly issuesLoaderEffect = effect((onCleanup) => {
    // Track `node()` (not just `path()`) so this re-runs both on
    // navigation AND whenever the persisted scan reloads. That keeps the
    // Findings card live after the user edits + re-scans the file.
    const node = this.node();
    const path = node?.path;
    // Reset to empty ONLY on navigation: a finding from the previous
    // node must not linger on the newly-selected one. On a same-path
    // reload we keep the current list mounted and swap it in once the
    // fresh fetch resolves, so the Findings section never
    // unmounts/remounts (that reset-then-refill was the flicker). Mirrors
    // the body card's silent-refresh contract in `inspector-body-state`.
    if (path !== this.issuesPath) {
      this.issues.set([]);
      this.issuesPath = path;
    }
    if (!node || !path) return;
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    void this.dataSource
      .listIssues({ node: path })
      .then((env) => {
        // Guard the path too: a stale resolve from the node we navigated
        // away from must not overwrite the current node's findings.
        if (!cancelled && this.issuesPath === path) this.issues.set(env.items);
      })
      .catch(() => {
        if (!cancelled && this.issuesPath === path) this.issues.set([]);
      });
  });

  // AI actions card (Step 16 piece 1, the findings workbench): the
  // probabilistic findings tray + finder / fixer / standalone launcher
  // buttons. Owned by the extracted controller; the template binds
  // through the protected adapters below. Distinct from the
  // deterministic Findings card above (`issues()`).
  private readonly aiActions: IAiActionsHandle = setupAiActions({
    node: this.node,
    dataSource: this.dataSource,
    jobEvents$: this.wsEvents.jobEvents$,
    scanCompleted$: this.wsEvents.scanCompleted$,
    // The dismiss / restore flows park their consent retries behind the
    // SAME dialog the action buttons use (one instance, one service).
    requestSmConsent: (retry) => this.actionDispatch.requestSmConsent(retry),
  });
  protected readonly aiActionFindings = this.aiActions.findings;
  protected readonly aiActionsAvailable = this.aiActions.available;
  protected readonly aiActionsError = this.aiActions.error;
  protected readonly probExtensions = this.aiActions.probExtensions;
  protected readonly aiActionCounts = this.aiActions.counts;
  protected readonly aiActionRevealedBucket = this.aiActions.revealedBucket;
  protected readonly aiActionRevealedRows = this.aiActions.revealedRows;

  /** Direct dismiss (no prompt): one click hides the class, reversible. */
  protected dismissAiActionFinding(finding: IFindingApi): void {
    void this.aiActions.dismissFinding(finding);
  }

  protected resolveAiActionFinding(finding: IFindingApi): void {
    void this.aiActions.resolveFinding(finding);
  }

  protected restoreAiActionFinding(finding: IFindingApi): void {
    void this.aiActions.restoreFinding(finding);
  }

  /** Hard-delete a revealed dismissed / fixed row from the DB. */
  protected deleteAiActionFinding(finding: IFindingApi): void {
    void this.aiActions.deleteFinding(finding);
  }

  /**
   * The finder entry backing a finding row, when it has fixer(s) to
   * queue: extension-origin findings only (kernel safety rows have no
   * fixer), matched by the row's qualified `extensionId` against the
   * launcher catalog. `null` = the row renders no automatic-fix button.
   */
  private findingFinderEntry(finding: IFindingApi): IProbExtensionEntryApi | null {
    if (finding.origin !== 'extension') return null;
    const probs = this.aiActions.probExtensions();
    const entry = probs?.finders.find((e) => e.id === finding.extensionId);
    return entry !== undefined && entry.fixerIds.length > 0 ? entry : null;
  }

  /**
   * Whether the row shows the AUTOMATIC fix button: a fixer exists AND
   * the row is genuinely open. A `human-decision` row is EXCLUDED (user
   * call 2026-07-20): the fixer already decided it belongs to the
   * author, the submit gate refuses to re-inject it, so offering the
   * button would only dead-end; the row carries the needs-decision mark
   * instead and keeps mark-fixed / dismiss as its two valid exits.
   */
  protected aiActionFindingFixable(finding: IFindingApi): boolean {
    return finding.resolution === null && this.findingFinderEntry(finding) !== null;
  }

  /**
   * Queue the finding's fixer(s) for THIS row only (user call
   * 2026-07-22: the bolt targets the single finding, `findingIds:
   * [f.id]` frozen on the job, so each finding fixes individually and
   * the other rows stay clickable; the Detect+fix launcher and the
   * auto-fix chain keep the whole-node batch).
   */
  protected fixAiActionFinding(finding: IFindingApi): void {
    const entry = this.findingFinderEntry(finding);
    if (entry === null) return;
    void this.aiActions.submitFixers(entry.id, entry.fixerIds, [finding.id]);
  }

  /**
   * Fix button busy/disabled, PER ROW: this row's own submit
   * round-trip, or an ACTIVE fixer job whose frozen finding target
   * covers it (`fixerBusy` on the entry: a whole-node job covers every
   * row, a subset job only its ids). A busy sibling row no longer
   * disables this one.
   */
  protected aiActionFindingFixBusy(finding: IFindingApi): boolean {
    const entry = this.findingFinderEntry(finding);
    if (entry === null) return false;
    if (this.aiActions.isFixerSubmitting(entry.id, finding.id)) return true;
    if (this.aiActions.isSubmitting(entry.id)) return true;
    const busy = entry.fixerBusy;
    // No fixer job active: any non-idle entry state means the FINDER
    // itself is re-judging, which will replace this row, so the whole
    // tray locks (the historical behaviour).
    if (busy === null) return this.aiActionEntryState(entry) !== 'idle';
    return busy.all || busy.findingIds.includes(finding.id);
  }

  protected aiActionFindingBusy(findingId: number): boolean {
    return this.aiActions.isFindingBusy(findingId);
  }


  protected toggleAiActionBucket(bucket: TFindingsBucket): void {
    void this.aiActions.toggleBucket(bucket);
  }

  /** Chip label for one hidden bucket ("2 dismissed", "1 fixed", ...). */
  protected aiActionHiddenChipLabel(chip: { bucket: TFindingsBucket; count: number }): string {
    return this.texts.aiActions.hidden[chip.bucket](chip.count);
  }

  /**
   * The hidden-bucket chips in render order: only non-zero buckets, each
   * with its live count and whether it is the revealed one.
   */
  protected readonly aiActionHiddenBuckets = computed<
    Array<{ bucket: TFindingsBucket; count: number; revealed: boolean }>
  >(() => {
    const counts = this.aiActionCounts();
    if (counts === null) return [];
    const revealed = this.aiActionRevealedBucket();
    return (
      [
        { bucket: 'dismissed' as const, count: counts.dismissedExcluded },
        { bucket: 'fixed' as const, count: counts.fixedExcluded },
      ]
        // Zero-count chips never render (user call 2026-07-20); when a
        // revealed bucket empties, the controller collapses the reveal
        // in the same refresh, so no orphan sublist survives the chip.
        // No stale chip: stale rows ride the tray inline, marked.
        .filter((b) => b.count > 0)
        .map((b) => ({ ...b, revealed: b.bucket === revealed }))
    );
  });

  /**
   * Launcher groups in render order, empty groups filtered out so the
   * template iterates once instead of double-gating. Two buckets:
   * `finders` (probabilistic Analyzers with a fixer, rendered as
   * two-state Detect ⇄ Fix buttons) and `standalone` (finders without a
   * fixer + Actions with no `analyzerIds`, single-action buttons).
   */
  protected readonly aiActionLauncherGroups = computed<
    { id: 'finders' | 'standalone'; entries: IProbExtensionEntryApi[] }[]
  >(() => {
    const probs = this.probExtensions();
    if (probs === null) return [];
    // The summarizer and the auto-tagger never ride the launcher row:
    // they own the header's semantic-analysis affordance and the tag
    // row's sparkles button respectively (user shape 2026-07-21), and
    // the ALL button skips them for the same reason.
    const standalone = probs.standalone.filter(
      (e) => e.id !== SUMMARIZER_EXTENSION_ID && e.id !== TAGGER_EXTENSION_ID,
    );
    return (
      [
        { id: 'finders', entries: probs.finders },
        { id: 'standalone', entries: standalone },
      ] as const
    )
      .filter((g) => g.entries.length > 0)
      .map((g) => ({ id: g.id, entries: [...g.entries] }));
  });

  /**
   * Flattened launcher entries (finders first, then standalone), each
   * tagged with whether it is a two-state finder, for the single-row
   * render and the ALL button.
   */
  protected readonly aiActionLauncherEntries = computed<
    { entry: IProbExtensionEntryApi; isFinder: boolean }[]
  >(() =>
    this.aiActionLauncherGroups().flatMap((g) =>
      g.entries.map((entry) => ({ entry, isFinder: g.id === 'finders' })),
    ),
  );

  /**
   * Automatic toggle (Step 16), persisted at inspector level like the
   * activity filter. When on, one click on a finder-with-fixer button
   * submits the finder with `autoFix: true` (the kernel chains the
   * fixers on record); when off, the button morphs Detect ⇄ Fix.
   */
  private readonly autoFixState: IAutoFixHandle = setupAutoFix();
  protected autoFixEnabled(): boolean {
    return this.autoFixState.enabled();
  }
  protected onAutoFixToggle(value: boolean): void {
    this.autoFixState.set(value);
  }

  /**
   * Whether the Automatic toggle renders: only when at least one
   * finder-with-fixer button exists (the toggle governs their Detect ⇄
   * Fix morph). A card with only standalone actions has nothing to
   * automate, so the toggle would be inert.
   */
  protected readonly showAutoFixToggle = computed<boolean>(
    () => (this.probExtensions()?.finders.length ?? 0) > 0,
  );

  /** Effective launcher state (optimistic `queued` flip included). */
  protected aiActionEntryState(entry: IProbExtensionEntryApi): 'idle' | 'queued' | 'running' {
    return this.aiActions.entryState(entry);
  }

  /**
   * The action a finder button performs on click, given the Automatic
   * toggle: on → `detectAndFix` (submit the finder with `autoFix`),
   * off → `detect` (submit the finder). The old third `fix` mode is
   * GONE (user call 2026-07-20): fixing moved into each finding row,
   * the launcher never morphs.
   */
  protected finderActionMode(entry: IProbExtensionEntryApi): 'detect' | 'detectAndFix' {
    return this.autoFixEnabled() ? 'detectAndFix' : 'detect';
  }

  /**
   * Launcher label: always the extension KIND (the segment after the
   * slash, minus the `node-` prefix, via `shortExtensionLabel`), for
   * finders and standalone alike (user call 2026-07-18). The action is
   * carried by the icon (`aiActionLauncherIcon`) and the tooltip, not
   * the label.
   */
  protected aiActionLauncherLabel(entry: IProbExtensionEntryApi): string {
    return shortExtensionLabel(entry.id);
  }

  /**
   * Mode icon (the label is the kind, so the icon shows the action): a
   * queued job pins the clock; otherwise a finder shows detect or
   * detect+fix per the Automatic toggle and a standalone shows the run
   * glyph. Auto-fix is the MAGIC glyph (user call 2026-07-20, shared
   * with the per-finding fix button).
   */
  protected aiActionLauncherIcon(entry: IProbExtensionEntryApi, isFinder: boolean): string {
    if (this.aiActionEntryState(entry) === 'queued') return 'pi pi-clock';
    // Standalone actions wear the magic icon (user call 2026-07-22).
    if (!isFinder) return 'pi pi-sparkles';
    return this.finderActionMode(entry) === 'detectAndFix' ? 'pi pi-sparkles' : 'pi pi-search';
  }

  /**
   * Tooltip: the manifest description, the current action (Detect /
   * Detect + fix) for finders so the icon reads unambiguously, plus the
   * live state when not idle, or the open-findings reason while the
   * button sits disabled by them.
   */
  protected aiActionLauncherTooltip(entry: IProbExtensionEntryApi, isFinder: boolean): string {
    const action = isFinder ? `${this.texts.aiActions.buttons[this.finderActionMode(entry)]} · ` : '';
    const state = this.aiActionEntryState(entry);
    const suffix =
      state === 'queued'
        ? ` (${this.texts.aiActions.stateQueued})`
        : state === 'running'
          ? ` (${this.texts.aiActions.stateRunning})`
          : entry.hasOpenFindings
            ? ` (${this.texts.aiActions.stateOpenFindings})`
            : '';
    return `${action}${entry.description}${suffix}`;
  }

  /**
   * True while the launcher button must sit disabled: non-idle, a submit
   * in flight, or OPEN FINDINGS from this finder (user call 2026-07-20:
   * re-running a finder whose findings are still open makes no sense;
   * handle them first, via fix / resolve / dismiss / delete, and the
   * button re-enables). Standalone entries always carry
   * `hasOpenFindings: false`, so the guard only bites finders.
   */
  protected aiActionLauncherDisabled(entry: IProbExtensionEntryApi): boolean {
    return (
      this.aiActionEntryState(entry) !== 'idle' ||
      this.aiActions.isSubmitting(entry.id) ||
      entry.hasOpenFindings
    );
  }

  /** True while the launcher shows the busy spinner (running or submitting). */
  protected aiActionLauncherBusy(entry: IProbExtensionEntryApi): boolean {
    return this.aiActionEntryState(entry) === 'running' || this.aiActions.isSubmitting(entry.id);
  }

  /**
   * Launcher click. Standalone entries submit their own extension. A
   * finder submits itself, with `autoFix: true` when the Automatic
   * toggle is on (the kernel chains its fixers on record). Fixing an
   * already-open finding lives on the finding row, not here.
   */
  protected onLauncherClick(entry: IProbExtensionEntryApi, isFinder: boolean): void {
    void this.launcherSubmit(entry, isFinder);
  }

  /** The submit a launcher click dispatches, exposed as a promise for ALL. */
  private launcherSubmit(entry: IProbExtensionEntryApi, isFinder: boolean): Promise<void> {
    const autoFix = isFinder && this.finderActionMode(entry) === 'detectAndFix';
    return this.aiActions.submit(entry.id, autoFix);
  }

  /**
   * ALL launcher button: queue every finder + standalone on THIS node in
   * one click, each in its current mode (the same submit a per-button
   * click does). Entries already busy are skipped (a re-submit would be a
   * queue duplicate anyway).
   *
   * SEQUENTIAL, finders first (user call 2026-07-20): the entries list
   * is already finders-then-standalone, and each submit is awaited so
   * the queue's created_at order matches. Fire-and-forget submits raced
   * and could land a file-EDITING standalone action between two finder
   * jobs, staling the judgments recorded before the edit; with finders
   * ahead, every finder judges the same body and the actions run last.
   */
  /**
   * Type-scoped ALL (user call 2026-07-22: finders and standalone each
   * get their own ALL button running ONLY their group), sequential like
   * the former combined ALL so a file-editing action can never land
   * between two finders of the same batch.
   */
  /**
   * ALL-button label: bare "ALL" when the card shows a single group,
   * type-qualified ("ALL finders" / "ALL standalone") when both rows are
   * present (user call 2026-07-22).
   */
  protected launcherAllLabel(groupId: 'finders' | 'standalone'): string {
    if (this.aiActionLauncherGroups().length < 2) return this.texts.aiActions.all;
    return groupId === 'finders'
      ? this.texts.aiActions.allFinders
      : this.texts.aiActions.allStandalone;
  }

  protected onLauncherAllGroup(groupId: 'finders' | 'standalone'): void {
    void (async (): Promise<void> => {
      const group = this.aiActionLauncherGroups().find((g) => g.id === groupId);
      if (group === undefined) return;
      for (const entry of group.entries) {
        if (this.aiActionLauncherDisabled(entry)) {
          continue;
        }
        await this.launcherSubmit(entry, groupId === 'finders');
      }
    })();
  }

  /**
   * Whether the stop / restart companions render beside the launcher
   * (user decision 2026-07-17): only with a server-confirmed job handle
   * (`jobId`) AND a still-active effective state. A just-submitted
   * optimistic entry (queued, no jobId yet) shows them once the refresh
   * lands; a just-stopped entry (optimistic idle) hides them instantly
   * instead of parking a stop button next to an enabled launcher.
   */
  protected aiActionCompanionsVisible(entry: IProbExtensionEntryApi): boolean {
    return entry.jobId !== null && this.aiActionEntryState(entry) !== 'idle';
  }

  /** Both companions sit disabled while the extension's stop / restart is in flight. */
  protected aiActionCompanionDisabled(entry: IProbExtensionEntryApi): boolean {
    return this.aiActions.isCancelling(entry.id);
  }

  protected stopAiAction(entry: IProbExtensionEntryApi): void {
    void this.aiActions.stop(entry);
  }


  protected dismissAiActionsError(): void {
    this.aiActions.dismissError();
  }

  /** Per-row provenance: `(confidence% · model)`, model omitted when undeclared. */
  protected aiActionConfidenceModel(finding: IFindingApi): string {
    return this.texts.aiActions.confidence(Math.round(finding.confidence * 100));
  }

  /**
   * Whether the "Activity" section renders at all, matching how the
   * other inspector sections (`hasConnections`, `hasAnnotations`, ...)
   * hide when empty: a quiet node shows no Activity section instead of
   * the "no recorded runs" placeholder. Visibility derives from the
   * same per-node mirror the node-card pill and the edge labels read
   * (`NodeActivityStatsService`, summary snapshot + WS overwrites): a
   * stats entry for the node, a spawn pair touching it as parent or
   * child, or PERSISTENT AI-run history (the summary's `runNodes`; the
   * boot-scoped counters reset on server restart, the DB history does
   * not, so recorded runs must keep the section visible after a
   * reboot). With real-time activity OFF the mirror may be un-hydrated
   * (the boot fetch is skipped), so emptiness is unknowable and the
   * section stays available like it always was.
   */
  protected readonly hasActivity = computed<boolean>(() => {
    const path = this.node()?.path;
    if (path === undefined) return false;
    if (!this.livePrefs.activityEnabled()) return true;
    if (this.activityStats.stats().has(path)) return true;
    if (this.activityStats.runNodes().has(path)) return true;
    for (const key of this.activityStats.pairCounts().keys()) {
      if (activityPairKeyTouches(key, path)) return true;
    }
    return false;
  });

  /**
   * Activity section state (spec/provider-activity.md §Execution stats
   * / §Conversation capture). Fetched LAZILY on first expand per node
   * (the collapse state is persisted, so a user who keeps the section
   * open gets a fetch per navigation), then silently re-fetched on
   * every `scan.completed` while loaded, mirroring the body state
   * machine's loud-load / silent-refresh split. `null` = not fetched
   * yet (renders the loading line while expanded).
   */
  protected readonly activityDetail = signal<IActivityNodeDetailApi | null>(null);
  /** Path the current `activityDetail` belongs to (navigation guard). */
  private activityPath: string | undefined = undefined;
  /** Dedupe guard: the expand effect fetches once per (path, expand). */
  private activityFetchedFor: string | null = null;
  private readonly activityLoaderEffect = effect(() => {
    const path = this.node()?.path;
    const open = this.expanded('activity');
    if (path !== this.activityPath) {
      // Navigation: a previous node's activity must not linger.
      this.activityDetail.set(null);
      this.activityFetchedFor = null;
      this.activityPath = path;
    }
    // The visibility gate also cuts the fetch: a hidden section (quiet
    // node) with a persisted-open collapse state must not spend a GET.
    // Reading the computed here makes the effect re-run when activity
    // first arrives for the node, so the section loads as it appears.
    if (!path || !open || !this.hasActivity()) return;
    // The collapse-state signal covers EVERY section, so this effect
    // re-runs when unrelated sections toggle; the fetched-for guard
    // keeps those re-runs free.
    if (this.activityFetchedFor === path) return;
    this.activityFetchedFor = path;
    void this.fetchActivity(path);
  });

  /**
   * Silent same-path refresh on watcher re-scans, so counters and
   * spawn lists stay live while the section sits open. Skipped until
   * the section has fetched at least once for the current node.
   */
  private readonly activityScanRefresh = this.wsEvents.scanCompleted$
    .pipe(takeUntilDestroyed())
    .subscribe(() => {
      const path = this.activityPath;
      if (!path || this.activityFetchedFor !== path) return;
      void this.fetchActivity(path);
    });

  /**
   * Live same-path refresh on execution frames, so the recent-history
   * rows and counters update the moment the assistant runs, not only on
   * the next watcher re-scan. Merges the live streams the Activity section
   * reflects: `node.activity` (a unit executing, an MCP tool invoked),
   * `agent.spawn` (a new spawn thread), and `job.*` events. The job stream
   * is what makes skill-map's OWN AI runs appear live: `sm record` writes
   * the `state_executions` row (the AI-run history the timeline shows) then
   * pushes `job.completed`, and that push carries NO `node.activity` frame,
   * so without subscribing here an AI run only surfaced when something ELSE
   * happened to refresh the section (a fixer's edit triggered a re-scan, a
   * runtime frame fired), which is why finder / summarizer runs, which touch
   * no file, sometimes never appeared until the next navigation. Any frame
   * can touch this node's detail, directly (it lit up) or as the correlated
   * caller of an invocation elsewhere, so rather than duplicate the server's
   * owner-to-caller correlation client-side, we re-fetch the authoritative
   * detail (debounced) whenever activity flows while the section sits open.
   * Gated by the same fetched-for guard as the scan refresh, so a closed or
   * never-loaded section spends nothing.
   */
  private readonly activityLiveRefresh = merge(
    this.wsEvents.nodeActivity$,
    this.wsEvents.agentSpawn$,
    this.wsEvents.jobEvents$,
  )
    .pipe(debounceTime(ACTIVITY_LIVE_REFRESH_DEBOUNCE_MS), takeUntilDestroyed())
    .subscribe(() => {
      const path = this.activityPath;
      if (!path || this.activityFetchedFor !== path) return;
      void this.fetchActivity(path);
    });

  private async fetchActivity(path: string): Promise<void> {
    try {
      const detail = await this.dataSource.getNodeActivity(path);
      if (this.activityPath === path) this.activityDetail.set(detail);
    } catch {
      // Transport failure: keep whatever is shown (or the loading
      // line); activity is a progressive enhancement, never an error
      // banner.
    }
  }

  // --- semantic summary (header affordance, user shape 2026-07-21) --------

  /**
   * The node's stored semantic summaries. `null` = not loaded for the
   * current node yet. Fetched eagerly per node (one cheap row read) and
   * silently re-fetched on job frames / scan completions so the header
   * flips to its "ready" state the moment the agent records the run.
   */
  protected readonly nodeSummaries = signal<INodeSummaryRowApi[] | null>(null);
  /** Whether the header's summary block is expanded. */
  protected readonly summaryExpanded = signal(false);
  /** Set on summarize click: the NEXT non-empty refetch auto-expands. */
  private summaryAwaiting = false;
  private summaryPath: string | undefined = undefined;

  private readonly summaryLoaderEffect = effect(() => {
    const path = this.node()?.path;
    if (path === this.summaryPath) return;
    this.summaryPath = path;
    this.nodeSummaries.set(null);
    this.summaryExpanded.set(false);
    this.summaryAwaiting = false;
    if (path) void this.fetchSummary(path);
  });

  private readonly summaryLiveRefresh = merge(
    this.wsEvents.jobEvents$,
    this.wsEvents.scanCompleted$,
  )
    .pipe(debounceTime(ACTIVITY_LIVE_REFRESH_DEBOUNCE_MS), takeUntilDestroyed())
    .subscribe(() => {
      const path = this.summaryPath;
      if (path) void this.fetchSummary(path);
    });

  private async fetchSummary(path: string): Promise<void> {
    try {
      const rows = await this.dataSource.getNodeSummary(path);
      if (this.summaryPath !== path) return;
      const firstLoad = this.nodeSummaries() === null;
      this.nodeSummaries.set(rows ?? []);
      // Auto-expand when there is something to show: on the node's FIRST
      // load (user call 2026-07-21, a summarized node opens with its
      // analysis visible) and when the run the user launched just landed.
      // Silent WS refetches never re-expand a block the user collapsed.
      if ((firstLoad || this.summaryAwaiting) && (rows ?? []).length > 0) {
        this.summaryAwaiting = false;
        this.summaryExpanded.set(true);
      }
    } catch {
      // Progressive enhancement: keep whatever is shown, no banner.
    }
  }

  /** The summarizer's launcher entry (queue state), when enabled. */
  private readonly summarizerEntry = computed<IProbExtensionEntryApi | null>(() => {
    const probs = this.probExtensions();
    return probs?.standalone.find((e) => e.id === SUMMARIZER_EXTENSION_ID) ?? null;
  });

  /**
   * Header affordance state machine: `hidden` (no summarizer available
   * AND nothing stored), `queued` / `running` (the job is in flight),
   * `ready` (a summary exists, the button toggles the block), `idle`
   * (summarizable, nothing stored yet).
   */
  protected readonly summaryHeaderState = computed<
    'hidden' | 'idle' | 'queued' | 'running' | 'ready'
  >(() => {
    const rows = this.nodeSummaries();
    const entry = this.summarizerEntry();
    const entryState = entry === null ? null : this.aiActions.entryState(entry);
    if (entryState === 'queued' || entryState === 'running') return entryState;
    if (rows !== null && rows.length > 0) return 'ready';
    if (entry === null) return 'hidden';
    return rows === null ? 'hidden' : 'idle';
  });

  /** Any stored summary went stale (body changed since the judgment). */
  protected readonly summaryStale = computed<boolean>(() =>
    (this.nodeSummaries() ?? []).some((row) => row.stale),
  );

  /** The header button: idle queues the run, ready toggles the block. */
  protected onSummarizeClick(): void {
    const state = this.summaryHeaderState();
    if (state === 'ready') {
      this.summaryExpanded.update((v) => !v);
      return;
    }
    if (state !== 'idle') return;
    this.summaryAwaiting = true;
    void this.aiActions.submit(SUMMARIZER_EXTENSION_ID, false);
  }

  /** Delete one stored summary; the refetch collapses the empty block. */
  protected onSummaryDelete(summarizerActionId: string): void {
    const path = this.node()?.path;
    if (!path) return;
    void this.dataSource
      .deleteNodeSummary(path, summarizerActionId)
      .catch(() => {
        // Progressive enhancement: a failed delete keeps the block.
      })
      .then(() => this.fetchSummary(path));
  }

  // --- auto-tag (tag-row affordance, user request 2026-07-21) -------------

  /** The auto-tagger's launcher entry (queue state), when enabled. */
  private readonly taggerEntry = computed<IProbExtensionEntryApi | null>(() => {
    const probs = this.probExtensions();
    return probs?.standalone.find((e) => e.id === TAGGER_EXTENSION_ID) ?? null;
  });

  /**
   * Tag-row affordance state: `hidden` (tagger unavailable), `queued` /
   * `running` (job in flight), `idle` (clickable). No `ready` state: the
   * inferred tags land in the sidecar via the record-side write-through
   * and surface as ordinary chips on the next scan broadcast.
   */
  protected readonly autoTagState = computed<'hidden' | 'idle' | 'queued' | 'running'>(() => {
    const entry = this.taggerEntry();
    if (entry === null) return 'hidden';
    const entryState = this.aiActions.entryState(entry);
    if (entryState === 'queued' || entryState === 'running') return entryState;
    return 'idle';
  });

  /** Queue an auto-tag run for the inspected node. */
  protected onAutoTagClick(): void {
    if (this.autoTagState() !== 'idle') return;
    void this.aiActions.submit(TAGGER_EXTENSION_ID, false);
  }

  /** Re-run from the expanded block (stale or not, a fresh judgment). */
  protected onSummaryRefresh(): void {
    const entry = this.summarizerEntry();
    if (entry === null || this.aiActions.entryState(entry) !== 'idle') return;
    this.summaryAwaiting = true;
    void this.aiActions.submit(SUMMARIZER_EXTENSION_ID, false);
  }

  /** True when the fetched detail has nothing to show (quiet node). */
  protected readonly activityEmpty = computed<boolean>(() => {
    const detail = this.activityDetail();
    return (
      detail !== null &&
      detail.stats.count === 0 &&
      detail.spawns.length === 0 &&
      (detail.runs ?? []).length === 0
    );
  });

  /**
   * The "capture on" chip shows only where capture is ON *and* this node
   * actually has retained spawn conversations, not merely because the gate
   * is enabled: a chip on a node with zero captured conversations is noise
   * (the gate's global state already lives in Settings).
   */
  protected readonly showCaptureChip = computed<boolean>(() => {
    const detail = this.activityDetail();
    return detail !== null && detail.captureEnabled && detail.spawns.length > 0;
  });

  /**
   * Provenance filter over the merged timeline (all / runtime / AI
   * runs), persisted at INSPECTOR level like the section-collapse map,
   * so it survives navigation between nodes and reloads.
   */
  private readonly activityFilterState: IActivityFilterHandle = setupActivityFilter();

  protected activityFilter(): TActivityProvenanceFilter {
    return this.activityFilterState.filter();
  }

  protected onActivityFilterChange(value: TActivityProvenanceFilter): void {
    this.activityFilterState.set(value);
  }

  /** Filter control options; labels from the catalog, values are the filter ids. */
  protected readonly activityFilterOptions: {
    label: string;
    value: TActivityProvenanceFilter;
  }[] = [
    { label: INSPECTOR_VIEW_TEXTS.activity.filter.all, value: 'all' },
    { label: INSPECTOR_VIEW_TEXTS.activity.filter.runtime, value: 'runtime' },
    { label: INSPECTOR_VIEW_TEXTS.activity.filter.ai, value: 'ai' },
  ];

  /**
   * Merged timeline (user decision 2026-07-17): the runtime recent ring
   * interleaved with the persistent AI-run history, newest first,
   * timestampless entries sunk to the end. `runs` is normalized through
   * `?? []` so a BFF that predates the field degrades to runtime-only.
   */
  protected readonly activityTimeline = computed<TActivityTimelineEntry[]>(() => {
    const detail = this.activityDetail();
    if (detail === null) return [];
    return mergeActivityTimeline(detail.recent, detail.runs ?? []);
  });

  /** The merged timeline narrowed by the active provenance filter. */
  protected readonly filteredActivityTimeline = computed<TActivityTimelineEntry[]>(() => {
    const filter = this.activityFilterState.filter();
    const entries = this.activityTimeline();
    if (filter === 'all') return entries;
    return entries.filter((e) => e.provenance === filter);
  });

  /**
   * AI-run row text: `<extension> · <status?> · <duration>`, nullable
   * segments omitted. The built-in `core/` plugin prefix is stripped (it
   * is the overwhelming default and reads as noise; external plugins keep
   * their qualifier), the recording model is not shown (user call
   * 2026-07-20, matching the findings rows; `sm findings` in the terminal
   * still has it), and the status is surfaced ONLY when it deviates from
   * the happy-path `completed`: a failed / cancelled run shows its state,
   * a completed one does not repeat the obvious.
   */
  protected runRowLabel(run: IActivityRunApi): string {
    const parts = [run.extensionId.replace(/^core\//, '')];
    if (run.status !== 'completed') parts.push(run.status);
    if (run.durationMs !== null) parts.push(this.texts.activity.runDuration(run.durationMs));
    return parts.join(' · ');
  }


  /** Human time for activity rows (session-scoped, date is noise). */
  protected formatActivityTime(ms: number): string {
    return new Date(ms).toLocaleTimeString();
  }

  /**
   * Compact owner label for activity rows: the full sessionized id
   * (`main:6cfe5636-...`) is too long and squishes the tool detail, so
   * the row shows the short form (`main:6cfe5636`) with the full value
   * in the title tooltip. See `shortenOwner`.
   */
  protected shortOwner(owner: string): string {
    return shortenOwner(owner);
  }

  /**
   * Compact node label for a directional invocation row's caller /
   * target path (`mcp://<server>` -> `<server>`, else the basename).
   */
  protected nodeLabel(path: string): string {
    return activityNodeLabel(path);
  }

  /**
   * Spawn records grouped into per-pair conversation threads: one row
   * per parent-child pair, N Task calls fused into N turns of the same
   * thread (most recent thread first), capped per node at
   * `SPAWN_THREADS_LIMIT` conversations.
   */
  protected readonly spawnThreads = computed<ISpawnThread[]>(() =>
    groupSpawnThreads(this.activityDetail()?.spawns ?? []).slice(0, SPAWN_THREADS_LIMIT),
  );

  /** Thread-row labels: `<parent> -> <child>`, session parents named plainly. */
  protected threadPairLabel(thread: ISpawnThread): string {
    const t = this.texts.activity;
    const parent =
      thread.parentNodePath !== undefined
        ? pathBasenameForLink(thread.parentNodePath)
        : t.spawnParentSession;
    return t.spawnPair(parent, this.threadChildLabel(thread));
  }

  protected threadChildLabel(thread: ISpawnThread): string {
    if (thread.childName !== undefined) return thread.childName;
    if (thread.childNodePath !== undefined) return pathBasenameForLink(thread.childNodePath);
    return this.threadLastRecord(thread).childKind ?? '';
  }

  /** Records are ASC by startedAt, so the latest turn is the last one. */
  protected threadLastRecord(thread: ISpawnThread): IActivitySpawnRecordApi {
    return thread.records[thread.records.length - 1]!;
  }

  /**
   * Conversation dialog, state machine shared with the graph view via
   * `conversation-dialog.controller.ts`. The inspector already holds
   * the full spawn records (content included while capture is on), so
   * it uses the no-fetch `openThread` path, the clicked thread is
   * handed to the dialog directly; the graph view's edge-click path is
   * the one that fetches by id. The capture-gate binding stays on this
   * component's own `activityDetail` (already fetched for the section).
   */
  private readonly conversation = setupConversationDialog({ dataSource: this.dataSource });
  protected readonly conversationOpen = this.conversation.open;
  protected readonly conversationThread = this.conversation.thread;

  protected openSpawnConversation(thread: ISpawnThread): void {
    this.conversation.openThread(thread);
  }

  protected onConversationClosed(): void {
    this.conversation.close();
  }

  /**
   * Findings sorted for display: error first, then warn, then info last
   * (matches `sm check`'s severity ordering). Stable within a tier, so
   * the analyzer emission order is preserved among same-severity issues.
   */
  protected readonly sortedIssues = computed<IIssueApi[]>(() => {
    const order: Record<TIssueSeverityApi, number> = { error: 0, warn: 1, info: 2 };
    return [...this.issues()].sort((a, b) => order[a.severity] - order[b.severity]);
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
    // Boot guard keyed on `scanMeta()` (the cheapest lazy fetch) so a
    // branch with zero rendered nodes does not re-trigger the boot load.
    if (this.loader.scanMeta() === null && !this.loader.loading()) {
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

  // Action dispatch. The toolbar's action buttons arrive as
  // contributions on `inspector.action.button`; each button dispatches
  // through the shared `ActionDispatchService`, which owns the `.sm`
  // write-consent handshake. The template binds the service's consent
  // dialog state; dispatch errors are rendered inline by each dispatcher
  // (the tag editor + each action button), not by a panel-level banner.
  protected readonly consentOpen = this.actionDispatch.consentOpen;

  /**
   * Forwarded from `<sm-sidecar-consent-dialog (decision)>`. Hands the
   * user's choice back to the dispatch service, which retries the parked
   * dispatch (with `{ confirm }` or `{ confirm, always }`) on accept, or
   * abandons it silently on decline.
   */
  protected onConsentDecision(decision: ISidecarConsentDecision): void {
    this.actionDispatch.resolveConsent(decision);
  }
}
