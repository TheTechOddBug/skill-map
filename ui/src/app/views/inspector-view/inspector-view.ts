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
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { debounceTime, merge } from 'rxjs';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import type {
  IActivityNodeDetailApi,
  IActivitySpawnRecordApi,
  IIssueApi,
  TIssueSeverityApi,
} from '../../../models/api';

import { INSPECTOR_VIEW_TEXTS } from '../../../i18n/inspector-view.texts';
import { activityPairKeyTouches } from '../../../models/api';
import { shortenOwner } from '../../../models/activity-owner';
import { compactNumber } from '../../../models/node-derived';
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
  setupInspectorDerivations,
  type IInspectorDerivationsHandle,
} from './inspector-derivations';
import type { INodeView } from '../../../models/node';

/**
 * Debounce for the Activity section's live re-fetch. Live `node.activity`
 * and `agent.spawn` frames can arrive in rapid bursts (an agent lighting
 * a chain, an MCP tool called in a loop); coalescing them into one GET
 * shortly after the burst settles keeps the panel fresh without a request
 * per frame. The server is the source of truth, so a single trailing
 * re-fetch always reflects the final state.
 */
const ACTIVITY_LIVE_REFRESH_DEBOUNCE_MS = 400;

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
    (this.node()?.contributions ?? []).some((c) => c.slot === 'inspector.action.button'),
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

  /**
   * Whether the "Activity" section renders at all, matching how the
   * other inspector sections (`hasConnections`, `hasAnnotations`, ...)
   * hide when empty: a quiet node shows no Activity section instead of
   * the "no recorded runs" placeholder. Visibility derives from the
   * same per-node mirror the node-card pill and the edge labels read
   * (`NodeActivityStatsService`, summary snapshot + WS overwrites): a
   * stats entry for the node, or a spawn pair touching it as parent or
   * child. With real-time activity OFF the mirror may be un-hydrated
   * (the boot fetch is skipped), so emptiness is unknowable and the
   * section stays available like it always was.
   */
  protected readonly hasActivity = computed<boolean>(() => {
    const path = this.node()?.path;
    if (path === undefined) return false;
    if (!this.livePrefs.activityEnabled()) return true;
    if (this.activityStats.stats().has(path)) return true;
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
   * the next watcher re-scan. Merges the two live streams the Activity
   * section reflects: `node.activity` (a unit executing, an MCP tool
   * invoked) and `agent.spawn` (a new spawn thread). Any frame can touch
   * this node's detail, directly (it lit up) or as the correlated caller
   * of an invocation elsewhere, so rather than duplicate the server's
   * owner-to-caller correlation client-side, we re-fetch the authoritative
   * detail (debounced) whenever activity flows while the section sits
   * open. Gated by the same fetched-for guard as the scan refresh, so a
   * closed or never-loaded section spends nothing.
   */
  private readonly activityLiveRefresh = merge(
    this.wsEvents.nodeActivity$,
    this.wsEvents.agentSpawn$,
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

  /** True when the fetched detail has nothing to show (quiet node). */
  protected readonly activityEmpty = computed<boolean>(() => {
    const detail = this.activityDetail();
    return detail !== null && detail.stats.count === 0 && detail.spawns.length === 0;
  });

  /**
   * Optional execution aggregates line for the stats row
   * (spec/provider-activity.md §Execution stats): tool + token sums
   * contextualized by the contributing run count, e.g.
   * `14 tools · 8.3k tokens (2 summarized runs)`. `null` (row hidden)
   * for nodes that never received a spawn summary (skills, markdowns,
   * async-only agents), whose stats simply omit the fields.
   */
  protected readonly activityAggregates = computed<string | null>(() => {
    const stats = this.activityDetail()?.stats;
    if (!stats || stats.summarizedRuns === undefined) return null;
    const t = this.texts.activity;
    const parts: string[] = [];
    if (stats.toolUses !== undefined) parts.push(t.toolsCount(stats.toolUses));
    if (stats.tokens !== undefined) parts.push(t.tokensCount(compactNumber(stats.tokens)));
    if (parts.length === 0) return null;
    return `${parts.join(' · ')} ${t.summarizedRuns(stats.summarizedRuns)}`;
  });

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
   * thread (most recent thread first).
   */
  protected readonly spawnThreads = computed<ISpawnThread[]>(() =>
    groupSpawnThreads(this.activityDetail()?.spawns ?? []),
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
