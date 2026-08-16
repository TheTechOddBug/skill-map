import { NgTemplateOutlet } from '@angular/common';
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
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { INSPECTOR_VIEW_TEXTS } from '../../../../i18n/inspector-view.texts';
import type {
  IFindingApi,
  IIssueApi,
  IIssueFixerEntryApi,
  IProbExtensionEntryApi,
  TIssueSeverityApi,
} from '../../../../models/api';
import type { INodeView } from '../../../../models/node';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { ProcessingAgentReadinessService } from '../../../services/processing-agent-readiness';
import { UsageTrackerService } from '../../../services/usage-tracker';
import {
  qualifyAnalyzerForUsage,
  qualifyFindingTypeForUsage,
} from '../../../core/telemetry/usage-collector';
import { CollapsibleSection } from '../../../components/collapsible-section/collapsible-section';
import {
  issueDismissValue,
  type IAiActionsHandle,
  type TFindingsBucket,
} from '../inspector-ai-actions-section/inspector-ai-actions.controller';

/** Severity display order: error on top, then warn, then info (Notes). */
const SEVERITY_ORDER: readonly TIssueSeverityApi[] = ['error', 'warn', 'info'];

/**
 * Analyzers whose rows group under the "Observed in sessions" sub-header
 * (spec/provider-activity.md, Session journal): the two directions of
 * the design-vs-reality diff (emergent use + dead design), rendered
 * apart from the design-defect issues so they read as reality
 * commenting on the authored design. Issues carry the SHORT analyzer
 * id (the persisted `scan_issues` form).
 */
const OBSERVED_SESSIONS_ANALYZER_IDS: ReadonlySet<string> = new Set([
  'observed-link-missing',
  'declared-link-unobserved',
]);

/** Chip glyph per severity tier (matches the map's severity palette). */
const SEVERITY_CHIP_ICONS: Record<TIssueSeverityApi, string> = {
  error: 'pi pi-times-circle',
  warn: 'pi pi-exclamation-triangle',
  info: 'pi pi-info-circle',
};

/** One severity filter chip: tier + live count + enabled state. */
interface ISeverityChip {
  severity: TIssueSeverityApi;
  count: number;
  active: boolean;
  icon: string;
  label: string;
}

/**
 * Findings section of the inspector (the mixed card, user call
 * 2026-07-22): the deterministic `scan_issues` rows on top, the
 * probabilistic (AI) finding rows below them, and the hidden-buckets
 * honesty line. Extracted from the inspector god component following the
 * `linked-nodes-panel` precedent: the section owns its own data flow
 * (the per-node issues fetch) and busy predicates, while the SHARED AI
 * actions controller handle (`setupAiActions`, one instance spanning
 * the header affordances, this card's finding rows, and the AI actions
 * launcher card) is created by the host and threaded in as an input.
 * Since 2026-08-08 it also owns the severity filter chips (queue-chip
 * pattern) and the Clear-all bulk dismiss.
 */
@Component({
  selector: 'sm-inspector-findings-section',
  imports: [ButtonModule, NgTemplateOutlet, TooltipModule, CollapsibleSection],
  templateUrl: './inspector-findings-section.html',
  styleUrl: './inspector-findings-section.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorFindingsSection {
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);
  private readonly processingAgent = inject(ProcessingAgentReadinessService);
  private readonly usageTracker = inject(UsageTrackerService);

  protected readonly texts = INSPECTOR_VIEW_TEXTS;

  /** The inspected node (tracked so a scan reload re-fetches the issues). */
  readonly node = input.required<INodeView>();

  /**
   * The host-created AI actions controller handle. Shared state, not
   * section state: the same instance also drives the header's summary /
   * auto-tag affordances and the AI actions launcher card, so submits
   * from this card's rows surface their errors in that card's strip and
   * flip the matching launcher to `queued`.
   */
  readonly aiActions = input.required<IAiActionsHandle>();

  /** Expanded state; owned + persisted by the host's collapse map. */
  readonly expanded = input.required<boolean>();

  /** Emitted when the user clicks the section's toggle row. */
  readonly toggle = output<void>();

  /**
   * The shared submit gate (see the AI actions section for the full
   * story): re-exposed from `ProcessingAgentReadinessService` so the
   * submitting affordances on this card's rows (issue fix, finding fix)
   * sit DISABLED while nothing can drain the queue. Non-submitting
   * controls (dismiss / resolve / restore / delete, the bucket chips)
   * are deliberately NOT gated: they are local state, they work offline.
   */
  protected readonly submitGateClosed = this.processingAgent.submitGateClosed;

  /**
   * Per-node issues for the findings card. Lazily fetched via
   * `listIssues({ node })` so the inspector can show the actual
   * messages + fix hints emitted by analyzers like `broken-ref`.
   * Populated from the BFF response. No spinner / error UI yet, the
   * user asked for basic.
   */
  protected readonly issues = signal<IIssueApi[]>([]);

  /**
   * Findings card visibility: deterministic issues, probabilistic (AI)
   * finding rows (mixed into this card, user call 2026-07-22), or
   * held-back buckets (dismissed / fixed) whose honesty chips must stay
   * reachable so an all-dismissed node can restore.
   */
  protected readonly findingsSectionAvailable = computed<boolean>(() => {
    if (this.issues().length > 0) return true;
    if (this.aiActions().findings().length > 0) return true;
    const c = this.aiActions().counts();
    return c !== null && c.dismissedExcluded + c.fixedExcluded > 0;
  });

  /**
   * Last path the issues effect fetched for. Lets the effect tell a
   * navigation (path changed) apart from a same-path reload (the loader
   * re-runs `load()` on every `scan.completed` / reconnect re-seed,
   * handing `node()` a fresh object with the same path).
   */
  private issuesPath: string | undefined = undefined;
  private readonly issuesLoaderEffect = effect((onCleanup) => {
    // Track `node()` (not just its path) so this re-runs both on
    // navigation AND whenever the persisted scan reloads. That keeps the
    // Findings card live after the user edits + re-scans the file.
    const path = this.node().path;
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
   * Prune the deterministic rows matching a server-confirmed per-issue
   * dismiss. The AI actions controller (host-created) reports the
   * dismissed (analyzer, value) pair through its `onIssueDismissed` dep;
   * the host relays it here because the issues list lives with this
   * section now. The server already deleted the persisted rows, so the
   * next refetch agrees with the pruned list.
   */
  pruneDismissedIssue(analyzer: string, value: string): void {
    this.issues.update((items) =>
      items.filter((i) => !(i.analyzerId === analyzer && issueDismissValue(i) === value)),
    );
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

  // --- severity filter chips (queue-chip pattern, user request 2026-08-08) --

  /**
   * Enabled severity tiers. All on by default (the whole card is
   * visible); toggling a chip narrows BOTH lists (deterministic issues
   * + AI findings). Session-only, like the queue's status filter.
   */
  protected readonly severityFilter = signal<ReadonlySet<TIssueSeverityApi>>(
    new Set(SEVERITY_ORDER),
  );

  protected toggleSeverity(severity: TIssueSeverityApi): void {
    // Deliberately untracked: the usage taxonomy's `severity` filter
    // group belongs to the map toolbox, and this card gesture has no
    // group of its own (adding one is a spec/telemetry.md decision).
    this.severityFilter.update((current) => {
      const next = new Set(current);
      if (next.has(severity)) next.delete(severity);
      else next.add(severity);
      return next;
    });
  }

  /**
   * One chip per severity PRESENT in the card (zero-count tiers never
   * render, same rule as the hidden-bucket chips), in the display order
   * (error, warn, info), each with its combined live count over both
   * lists and its enabled state.
   */
  protected readonly severityChips = computed<ISeverityChip[]>(() => {
    const filter = this.severityFilter();
    const counts: Record<TIssueSeverityApi, number> = { error: 0, warn: 0, info: 0 };
    for (const issue of this.issues()) counts[issue.severity] += 1;
    for (const finding of this.aiActions().findings()) counts[finding.severity] += 1;
    return SEVERITY_ORDER.filter((severity) => counts[severity] > 0).map((severity) => ({
      severity,
      count: counts[severity],
      active: filter.has(severity),
      icon: SEVERITY_CHIP_ICONS[severity],
      label: this.texts.findingsFilter.labels[severity],
    }));
  });

  /** The deterministic list the template renders: sorted, then narrowed. */
  protected readonly visibleIssues = computed<IIssueApi[]>(() =>
    this.sortedIssues().filter((issue) => this.severityFilter().has(issue.severity)),
  );

  /** Deterministic rows MINUS the observed-in-sessions group below. */
  protected readonly visibleDesignIssues = computed<IIssueApi[]>(() =>
    this.visibleIssues().filter((issue) => !OBSERVED_SESSIONS_ANALYZER_IDS.has(issue.analyzerId)),
  );

  /**
   * Design-vs-reality rows (both directions), rendered under their own
   * "Observed in sessions" sub-header after the design issues. Same row
   * anatomy and affordances (severity chip narrowing, per-row dismiss
   * via the standard issue-suppression path); only the grouping differs.
   */
  protected readonly visibleObservedIssues = computed<IIssueApi[]>(() =>
    this.visibleIssues().filter((issue) => OBSERVED_SESSIONS_ANALYZER_IDS.has(issue.analyzerId)),
  );

  /**
   * AI finding rows sorted like the deterministic list (error, warn,
   * info) and, WITHIN a tier, by confidence descending (user request
   * 2026-08-09). The tier order alone left same-severity rows in the
   * tray's arrival order, which carries no meaning to the reader, while
   * the row's own confidence says how sure the finder is: surest first
   * puts the rows most worth acting on at the top of their tier.
   * Deterministic issues are NOT re-ordered, they carry no confidence.
   * Equal confidence keeps the incoming order (stable sort). Narrowed
   * by the chips last.
   */
  protected readonly visibleAiFindings = computed<IFindingApi[]>(() => {
    const order: Record<TIssueSeverityApi, number> = { error: 0, warn: 1, info: 2 };
    return [...this.aiActions().findings()]
      .sort((a, b) => {
        const tier = order[a.severity] - order[b.severity];
        return tier !== 0 ? tier : b.confidence - a.confidence;
      })
      .filter((finding) => this.severityFilter().has(finding.severity));
  });

  /** The chips hid every row (the card has rows, the filter shows none). */
  protected readonly severityFilterEmpty = computed<boolean>(
    () =>
      this.issues().length + this.aiActions().findings().length > 0 &&
      this.visibleIssues().length === 0 &&
      this.visibleAiFindings().length === 0,
  );

  // --- bulk sweeps (user request 2026-08-08) -------------------------------

  /** In-flight guard for the Dismiss-all sweep (disables the button). */
  protected readonly clearingAll = signal(false);
  /** In-flight guard for the revealed bucket's Delete-all sweep. */
  protected readonly deletingAll = signal(false);

  /**
   * Row-dismiss every VISIBLE AI finding (the filtered list, so the
   * chips scope the sweep to what the operator is looking at). Same
   * reversible state as the per-row X; the rows land in the dismissed
   * bucket. Deterministic issues are deliberately excluded: their
   * dismissal writes per-value suppressions into the committed `.sm`
   * sidecar, a different (consent-gated) hammer.
   */
  protected async onDismissAll(): Promise<void> {
    const targets = this.visibleAiFindings();
    if (targets.length === 0 || this.clearingAll()) return;
    // Deliberately untracked (user call 2026-08-08): the bulk sweep
    // emits no usage event, unlike the per-row dismiss.
    this.clearingAll.set(true);
    try {
      await this.aiActions().dismissAllFindings(targets);
    } finally {
      this.clearingAll.set(false);
    }
  }

  /**
   * Hard-delete every row of the REVEALED bucket: the per-row X for the
   * whole list at once, permanent (nothing restores these). Scoped to
   * the revealed rows on purpose, so the gesture can only ever reach
   * what the operator opened and is looking at.
   */
  protected async onDeleteAllRevealed(): Promise<void> {
    const targets = this.aiActionRevealedRows();
    if (targets.length === 0 || this.deletingAll()) return;
    this.deletingAll.set(true);
    try {
      await this.aiActions().deleteAllFindings(targets);
    } finally {
      this.deletingAll.set(false);
    }
  }

  /**
   * True when the active node has a `frontmatter-parse-error` finding,
   * i.e. its YAML frontmatter failed to parse. Public: the host reads it
   * through a `viewChild` and forwards it to `<sm-inspector-header>` so
   * the header shows the filename fallback title + the "invalid
   * frontmatter" badge instead of rendering a blank `<h2>`.
   */
  readonly frontmatterInvalid = computed<boolean>(() =>
    this.issues().some((i) => i.analyzerId === 'frontmatter-parse-error'),
  );

  // --- shared-handle adapters (the template reads through these) ----------

  protected readonly aiActionFindings = computed<IFindingApi[]>(() =>
    this.aiActions().findings(),
  );
  protected readonly aiActionCounts = computed(() => this.aiActions().counts());
  protected readonly aiActionRevealedBucket = computed(() => this.aiActions().revealedBucket());
  protected readonly aiActionRevealedRows = computed(() => this.aiActions().revealedRows());

  /**
   * The `issueFixers` entry matching a deterministic issue row, or
   * `null` when no enabled probabilistic fixer covers its analyzer. The
   * catalog only lists an issue fixer while the node has a matching open
   * Issue, so the fix sparkles renders exactly on the rows it resolves
   * (user decision 2026-07-22 replacing the standalone-launcher
   * placement). Matching is by the entry's SHORT `analyzerIds` against
   * the row's `analyzerId`, both in the persisted `scan_issues` form.
   */
  protected issueFixerForRow(issue: IIssueApi): IIssueFixerEntryApi | null {
    const fixers = this.aiActions().probExtensions()?.issueFixers ?? [];
    return fixers.find((f) => f.analyzerIds.includes(issue.analyzerId)) ?? null;
  }

  /**
   * Busy state of an issue row's fix button. One submit fixes EVERY
   * matching issue of the node in a single job, so all rows matching the
   * same fixer share it.
   */
  protected issueFixBusy(fixer: IIssueFixerEntryApi): boolean {
    return (
      this.aiActions().entryState(fixer) !== 'idle' || this.aiActions().isSubmitting(fixer.id)
    );
  }

  /** Busy phase of an issue row's fix button (same clock-then-spin
   *  convention as the launchers and the finding fix button). */
  protected issueFixPhase(fixer: IIssueFixerEntryApi): 'idle' | 'queued' | 'running' {
    if (!this.issueFixBusy(fixer)) return 'idle';
    return this.aiActions().entryState(fixer) === 'running' ? 'running' : 'queued';
  }

  /**
   * Disabled state of an issue row's fix button: busy, or the submit
   * gate is closed. Split from `issueFixBusy` because that one also
   * drives `[loading]`, and a gated button must read as disabled, not
   * as spinning.
   */
  protected issueFixDisabled(fixer: IIssueFixerEntryApi): boolean {
    return this.issueFixBusy(fixer) || this.submitGateClosed();
  }

  protected fixIssue(fixer: IIssueFixerEntryApi, analyzerId: string): void {
    // Usage analytics (opt-in, default OFF): the fix gesture carries WHAT
    // it fixes; never the node or the issue content. Issues carry the
    // SHORT analyzer id (no plugin prefix), which the feature builder's
    // slash heuristic cannot classify, so the closed-set analyzer
    // collapse runs here.
    this.usageTracker.trackFeature('finding-fix', qualifyAnalyzerForUsage(analyzerId));
    void this.aiActions().submit(fixer.id);
  }

  /**
   * The dismiss key value of a deterministic issue row (its verbatim
   * `data.target`), or `null`. Gates the per-row dismiss button: an
   * issue without a value has no (analyzer, value) dismiss key.
   */
  protected readonly issueDismissValue = issueDismissValue;

  /** Dismiss a deterministic issue for its exact (analyzer, value) key.
   *  The SHORT analyzer id collapses through the closed analyzer set
   *  (see `fixIssue`), not the builder's slash heuristic. */
  protected dismissIssue(issue: IIssueApi): void {
    this.usageTracker.trackFeature('finding-dismiss', qualifyAnalyzerForUsage(issue.analyzerId));
    void this.aiActions().dismissIssue(issue);
  }

  /** Busy state of an issue row's dismiss button (round-trip in flight). */
  protected issueDismissBusy(issue: IIssueApi): boolean {
    return this.aiActions().isIssueDismissBusy(issue);
  }

  /** Direct dismiss (no prompt): one click hides the class, reversible. */
  protected dismissAiActionFinding(finding: IFindingApi): void {
    this.usageTracker.trackFeature('finding-dismiss', this.findingTypeForUsage(finding));
    void this.aiActions().dismissFinding(finding);
  }

  protected resolveAiActionFinding(finding: IFindingApi): void {
    this.usageTracker.trackFeature('finding-resolve', this.findingTypeForUsage(finding));
    void this.aiActions().resolveFinding(finding);
  }

  /** The finding TYPE a lifecycle gesture may report (collapse rules in
   *  the collector); never the node, id, or content. */
  private findingTypeForUsage(finding: IFindingApi): string {
    return qualifyFindingTypeForUsage(finding.type, finding.extensionId, finding.origin);
  }

  protected restoreAiActionFinding(finding: IFindingApi): void {
    this.usageTracker.trackFeature('finding-restore');
    void this.aiActions().restoreFinding(finding);
  }

  /** Hard-delete a revealed dismissed / fixed row from the DB. */
  protected deleteAiActionFinding(finding: IFindingApi): void {
    this.usageTracker.trackFeature('finding-delete');
    void this.aiActions().deleteFinding(finding);
  }

  /**
   * The finder entry backing a finding row, when it has fixer(s) to
   * queue: extension-origin findings only (kernel safety rows have no
   * fixer), matched by the row's qualified `extensionId` against the
   * launcher catalog. `null` = the row renders no automatic-fix button.
   */
  private findingFinderEntry(finding: IFindingApi): IProbExtensionEntryApi | null {
    if (finding.origin !== 'extension') return null;
    const probs = this.aiActions().probExtensions();
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
    // The finding TYPE it fixes rides as value (e.g. `incoherence`); a
    // third-party finder's vocabulary collapses with its plugin.
    this.usageTracker.trackFeature('finding-fix', this.findingTypeForUsage(finding));
    void this.aiActions().submitFixers(entry.id, entry.fixerIds, [finding.id]);
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
    if (this.aiActions().isFixerSubmitting(entry.id, finding.id)) return true;
    if (this.aiActions().isSubmitting(entry.id)) return true;
    const busy = entry.fixerBusy;
    // No fixer job active: any non-idle entry state means the FINDER
    // itself is re-judging, which will replace this row, so the whole
    // tray locks (the historical behaviour).
    if (busy === null) return this.aiActions().entryState(entry) !== 'idle';
    return busy.all || busy.findingIds.includes(finding.id);
  }

  /**
   * Busy PHASE of a finding row's fix button, mirroring the launcher
   * convention (queued pins the clock, only running spins). The submit
   * round-trip counts as `queued`: the click lands the job in the
   * queue, so the clock is the honest first state, not the spinner.
   */
  protected aiActionFindingFixPhase(finding: IFindingApi): 'idle' | 'queued' | 'running' {
    if (!this.aiActionFindingFixBusy(finding)) return 'idle';
    const entry = this.findingFinderEntry(finding);
    return entry !== null && this.aiActions().entryState(entry) === 'running'
      ? 'running'
      : 'queued';
  }

  /**
   * Disabled state of a finding row's fix (bolt) button: its own busy
   * state, a per-row action in flight, or the submit gate closed. Kept
   * apart from `aiActionFindingFixBusy` (which drives the busy phase, and
   * also disables the row's NON-submitting resolve / dismiss buttons,
   * which the gate must never touch).
   */
  protected aiActionFindingFixDisabled(finding: IFindingApi): boolean {
    return (
      this.aiActionFindingFixBusy(finding) ||
      this.aiActionFindingBusy(finding.id) ||
      this.submitGateClosed()
    );
  }

  protected aiActionFindingBusy(findingId: number): boolean {
    return this.aiActions().isFindingBusy(findingId);
  }

  protected toggleAiActionBucket(bucket: TFindingsBucket): void {
    // Usage analytics (opt-in, default OFF): only the REVEAL counts (the
    // operator looking at what already happened); re-clicking to hide,
    // or the implicit close when another bucket opens, never emits.
    if (this.aiActions().revealedBucket() !== bucket) {
      this.usageTracker.trackFeature('findings-reveal', bucket);
    }
    void this.aiActions().toggleBucket(bucket);
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

  /** Per-row provenance: `(confidence% · model)`, model omitted when undeclared. */
  protected aiActionConfidenceModel(finding: IFindingApi): string {
    return this.texts.aiActions.confidence(Math.round(finding.confidence * 100));
  }
}
