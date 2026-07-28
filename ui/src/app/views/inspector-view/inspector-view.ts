import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { OnInit } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';
import { debounceTime, filter, merge } from 'rxjs';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { INSPECTOR_VIEW_TEXTS } from '../../../i18n/inspector-view.texts';
import { isJobCompletedEvent } from '../../../models/ws-event';
import { NODE_OPEN_INTENT } from '../../slots/node-open-intent';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { A11yAnnouncerService } from '../../services/a11y-announcer';
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
import { ProviderRegistryService } from '../../../services/provider-registry';
import { ProcessingAgentReadinessService } from '../../services/processing-agent-readiness';
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
import { ViewContributionsHost } from '../../components/view-contributions-host/view-contributions-host';
import {
  SidecarConsentDialog,
  type ISidecarConsentDecision,
} from '../../components/sidecar-consent-dialog/sidecar-consent-dialog';
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
import {
  setupAiActions,
  type IAiActionsHandle,
} from './inspector-ai-actions-section/inspector-ai-actions.controller';
import { InspectorFindingsSection } from './inspector-findings-section/inspector-findings-section';
import { InspectorAiActionsSection } from './inspector-ai-actions-section/inspector-ai-actions-section';
import { InspectorActivitySection } from './inspector-activity-section/inspector-activity-section';
import { surfaceContribution, type TSurfaceSlot } from '../../../models/node-derived';
import type { INodeView } from '../../../models/node';
import type { INodeSummaryRowApi, IProbExtensionEntryApi } from '../../../models/api';

/**
 * Debounce for the header summary's live re-fetch. Job frames and scan
 * completions can arrive in rapid bursts (an agent draining the queue,
 * a fixer edit triggering a re-scan); coalescing them into one GET
 * shortly after the burst settles keeps the header fresh without a
 * request per frame. Same window as the Activity section's and the AI
 * actions card's live refreshes.
 */
const SUMMARY_LIVE_REFRESH_DEBOUNCE_MS = 400;

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
    ViewContributionsHost,
    SidecarConsentDialog,
    InspectorFindingsSection,
    InspectorAiActionsSection,
    InspectorActivitySection,
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
  private readonly processingAgent = inject(ProcessingAgentReadinessService);
  private readonly announcer = inject(A11yAnnouncerService);

  protected readonly texts = INSPECTOR_VIEW_TEXTS;

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
    // Dedicated surfaces live on their own `inspector.surface.*` slots
    // (2026-07-23), so a plain slot match is the whole gate again.
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
  // collapsed except the body (see SECTION_DEFAULT_EXPANDED). The host
  // owns the ONE persisted map for every section, including the ones
  // rendered by the extracted section children (they take `[expanded]`
  // + `(toggle)` like `<sm-vendor-frontmatter>` does). Template binds
  // through `expanded()` / `toggleSection()`.
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
   * The findings section child. Two host concerns route through it:
   * the header's invalid-frontmatter badge (`frontmatterInvalid` below)
   * and the per-issue dismiss prune relay (the `onIssueDismissed` dep of
   * `setupAiActions`), because the deterministic issues list moved into
   * the child with the section extraction. Declared BEFORE the
   * `aiActions` field so the deps closure below can close over it.
   */
  private readonly findingsSection = viewChild(InspectorFindingsSection);

  /**
   * True when the active node has a `frontmatter-parse-error` finding,
   * i.e. its YAML frontmatter failed to parse. Forwarded to the header
   * so it shows the filename fallback title + the "invalid frontmatter"
   * badge instead of rendering a blank `<h2>`. The fact is derived from
   * the issues list the findings section owns, so it reads through the
   * `viewChild` (`false` while the section is not mounted, i.e. no node).
   */
  protected readonly frontmatterInvalid = computed<boolean>(
    () => this.findingsSection()?.frontmatterInvalid() ?? false,
  );

  // AI actions controller (Step 16 piece 1, the findings workbench):
  // the probabilistic findings state + the finder / fixer / standalone
  // submit flows. The handle is CROSS-SECTION shared state, which is
  // why the host (the orchestrator) creates it and threads it down:
  // one instance feeds the header's summary / auto-tag affordances
  // (below), the finding rows in `<sm-inspector-findings-section>`,
  // and the launcher card in `<sm-inspector-ai-actions-section>`, so
  // optimistic queue flips, busy sets, and the error strip stay
  // coherent across the three surfaces. The controller file itself
  // lives with the AI actions section.
  protected readonly aiActions: IAiActionsHandle = setupAiActions({
    node: this.node,
    dataSource: this.dataSource,
    jobEvents$: this.wsEvents.jobEvents$,
    scanCompleted$: this.wsEvents.scanCompleted$,
    // The shared readiness service drives the first heads-up warning
    // and, through `submitGateClosed`, the disabled state of every
    // submitting control (see the AI actions section). The second
    // warning rides the controller's own agent-presence probe.
    skillMissing: this.processingAgent.skillMissing,
    // The dismiss / restore flows park their consent retries behind the
    // SAME dialog the action buttons use (one instance, one service).
    requestSmConsent: (retry) => this.actionDispatch.requestSmConsent(retry),
    // A successful per-issue dismiss deleted the matching rows
    // server-side; relay the (analyzer, value) pair to the findings
    // section (the issues owner) so it prunes its local list without a
    // refetch (the next one confirms). Deliberately a deferred
    // `viewChild` read: the callback only fires on a user dismiss, long
    // after the section mounted.
    onIssueDismissed: (analyzer, value) =>
      this.findingsSection()?.pruneDismissedIssue(analyzer, value),
    // Narrate submit / fix / resolve / dismiss / restore outcomes to AT.
    announce: (message) => this.announcer.announce(message),
  });

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
    .pipe(debounceTime(SUMMARY_LIVE_REFRESH_DEBOUNCE_MS), takeUntilDestroyed())
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

  /** `payload.actionId` of the contribution claiming `slot`, or `null`. */
  private surfaceActionId(slot: TSurfaceSlot): string | null {
    const payload = surfaceContribution(this.node(), slot)?.payload;
    if (typeof payload !== 'object' || payload === null) return null;
    const id = (payload as { actionId?: unknown }).actionId;
    return typeof id === 'string' ? id : null;
  }

  /**
   * The summarizer's launcher entry (queue state): the prob-extensions
   * standalone entry whose id matches the `inspector.surface.summary`
   * claim. Placement comes from the contribution, live state from the
   * catalog; both vanish when the claiming extension is disabled.
   */
  private readonly summarizerEntry = computed<IProbExtensionEntryApi | null>(() => {
    const claimed = this.surfaceActionId('inspector.surface.summary');
    if (claimed === null) return null;
    const probs = this.aiActions.probExtensions();
    return probs?.standalone.find((e) => e.id === claimed) ?? null;
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
    const id = this.surfaceActionId('inspector.surface.summary');
    if (id !== null) void this.aiActions.submit(id, false);
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

  /** Re-run from the expanded block (stale or not, a fresh judgment). */
  protected onSummaryRefresh(): void {
    const entry = this.summarizerEntry();
    if (entry === null || this.aiActions.entryState(entry) !== 'idle') return;
    this.summaryAwaiting = true;
    const id = this.surfaceActionId('inspector.surface.summary');
    if (id !== null) void this.aiActions.submit(id, false);
  }

  // --- auto-tag (tag-row affordance, user request 2026-07-21) -------------

  /** The auto-tagger's launcher entry (queue state), when enabled. */
  private readonly taggerEntry = computed<IProbExtensionEntryApi | null>(() => {
    const probs = this.aiActions.probExtensions();
    const claimed = this.surfaceActionId('inspector.surface.auto-tag');
    if (claimed === null) return null;
    return probs?.standalone.find((e) => e.id === claimed) ?? null;
  });

  /**
   * Tag-row affordance state: `hidden` (tagger unavailable), `queued` /
   * `running` (job in flight), `idle` (clickable). No `ready` state: the
   * run writes nothing, its output is the proposal that opens the tag
   * editor (`autoTagProposedTags`), and the chips change only once the
   * operator saves.
   */
  protected readonly autoTagState = computed<'hidden' | 'idle' | 'queued' | 'running'>(() => {
    const entry = this.taggerEntry();
    if (entry === null) return 'hidden';
    const entryState = this.aiActions.entryState(entry);
    if (entryState === 'queued' || entryState === 'running') return entryState;
    return 'idle';
  });

  /**
   * Queue an auto-tag run for the inspected node. The previous run's
   * proposal is stale the moment a new one is submitted, so it retires
   * here; that also re-arms the tag row's once-per-proposal guard, which
   * is what lets the new run reopen the editor even if it lands on the
   * very same tags the operator dismissed a moment ago.
   */
  protected onAutoTagClick(): void {
    if (this.autoTagState() !== 'idle') return;
    const id = this.surfaceActionId('inspector.surface.auto-tag');
    if (id === null) return;
    this.clearAutoTagProposal();
    void this.aiActions.submit(id, false);
  }

  /**
   * The last auto-tag run's proposal, keyed by the node it judged
   * (`spec/job-lifecycle.md` §Tags proposal; the completion's
   * `tagsProposed` + `nodeId`). The tagger writes NOTHING, so this is
   * the run's entire output: a proposal the operator reviews through
   * the ordinary, consent-gated tags editor.
   *
   * Path-keyed (2026-07-26): a tagger run takes as long as the agent
   * takes, and the operator navigates meanwhile. Keying the offer on
   * the completion's `nodeId` means it neither vanishes on a node
   * change nor opens the editor over the WRONG node's tags; coming
   * back to the judged node (re)offers it until it is settled. Single
   * slot: one auto-tag runs at a time from this surface, and a newer
   * proposal supersedes an older unconsumed one.
   */
  private readonly autoTagProposal = signal<{
    path: string;
    tags: readonly string[];
  } | null>(null);

  /**
   * The proposal FOR THE INSPECTED NODE, empty otherwise. Handed to
   * `<sm-node-tags>` it OPENS the editor, pre-filled with the node's
   * tags plus the suggestion and left unsaved; saving raises the usual
   * `.sm` handshake and the human stays the author (tags are human
   * curation per `spec/architecture.md` §Storage rule). A non-empty
   * proposal is also the ONLY feedback the operator gets when the run
   * was launched from the inspector and recorded over MCP: without it
   * the sparkles button goes queued -> running -> idle with no new
   * chips and no explanation.
   */
  protected readonly autoTagProposedTags = computed<readonly string[]>(() => {
    const proposal = this.autoTagProposal();
    const path = this.node()?.path;
    return proposal !== null && path !== undefined && proposal.path === path
      ? proposal.tags
      : [];
  });

  /**
   * Collect the tagger's proposal, keyed on the completion's `nodeId`
   * (older servers omit the field; the inspected node is the fallback,
   * the historical behaviour). An EMPTY proposal retires a pending
   * offer for the same node ("I looked and found nothing" must not
   * leave an older suggestion standing); it never disturbs another
   * node's pending offer. The field is absent on every non-tagger job,
   * so unrelated completions neither raise nor lower it.
   */
  private readonly tagsProposalWatcher = this.wsEvents.jobEvents$
    .pipe(filter(isJobCompletedEvent), takeUntilDestroyed())
    .subscribe((event) => {
      // The frame guard validates no payload field, so the shape is
      // checked here; an absent field means "not a tagger", not "no tags".
      const proposed = event.data.tagsProposed;
      if (!Array.isArray(proposed)) return;
      const nodeId = typeof event.data.nodeId === 'string' ? event.data.nodeId : undefined;
      const path = nodeId ?? this.node()?.path;
      if (path === undefined) return;
      const tags = proposed.filter((tag): tag is string => typeof tag === 'string');
      if (tags.length === 0) {
        if (this.autoTagProposal()?.path === path) this.clearAutoTagProposal();
        return;
      }
      this.autoTagProposal.set({ path, tags });
    });

  /**
   * The operator saved the tag row themselves. The proposal is settled by
   * hand now (through the same dispatch and `.sm` consent handshake), so
   * the offer retires instead of hanging over a row that just wrote.
   */
  protected onTagsSaved(): void {
    this.clearAutoTagProposal();
  }

  /** Retire the pending auto-tag proposal. */
  private clearAutoTagProposal(): void {
    this.autoTagProposal.set(null);
  }

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
