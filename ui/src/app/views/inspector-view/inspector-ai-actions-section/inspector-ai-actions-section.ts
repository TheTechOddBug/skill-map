import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';

import { INSPECTOR_VIEW_TEXTS } from '../../../../i18n/inspector-view.texts';
import type { IProbExtensionEntryApi } from '../../../../models/api';
import type { INodeView } from '../../../../models/node';
import { shortExtensionLabel } from '../../../../models/extension-label';
import { ProviderRegistryService } from '../../../../services/provider-registry';
import { A11yAnnouncerService } from '../../../services/a11y-announcer';
import { AgentPingService } from '../../../services/agent-ping';
import { ProcessingAgentReadinessService } from '../../../services/processing-agent-readiness';
import { ProjectInfoService } from '../../../services/project-info';
import { CollapsibleSection } from '../../../components/collapsible-section/collapsible-section';
import type { IAiActionsHandle } from './inspector-ai-actions.controller';
import { setupAutoFix, type IAutoFixHandle } from './inspector-auto-fix.controller';

/**
 * AI actions section of the inspector: the LAUNCHERS only (finder /
 * standalone buttons + the Automatic toggle + the agent-check chip +
 * the submit error strip). The probabilistic finding rows live in the
 * Findings section, mixed with the deterministic issues (user call
 * 2026-07-22), so this card gates purely on having something to launch.
 *
 * Extracted from the inspector god component following the
 * `linked-nodes-panel` precedent: the section owns its per-launcher
 * adapters, the auto-fix preference, and the agent-check state machine,
 * while the SHARED controller handle (`setupAiActions`, one instance
 * spanning the header affordances, the findings rows, and this card) is
 * created by the host and threaded in as an input. The controller file
 * itself is re-homed next to this component.
 */
@Component({
  selector: 'sm-inspector-ai-actions-section',
  imports: [
    ButtonModule,
    MessageModule,
    ToggleSwitchModule,
    TooltipModule,
    FormsModule,
    CollapsibleSection,
  ],
  templateUrl: './inspector-ai-actions-section.html',
  styleUrl: './inspector-ai-actions-section.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorAiActionsSection {
  private readonly processingAgent = inject(ProcessingAgentReadinessService);
  private readonly providerRegistry = inject(ProviderRegistryService);
  private readonly projectInfo = inject(ProjectInfoService);
  private readonly agentPing = inject(AgentPingService);
  private readonly announcer = inject(A11yAnnouncerService);

  protected readonly texts = INSPECTOR_VIEW_TEXTS;

  /** The inspected node (its surface claims drive the launcher exclusion). */
  readonly node = input.required<INodeView>();

  /**
   * The host-created AI actions controller handle. Shared state, not
   * section state: the same instance also feeds the header's summary /
   * auto-tag affordances and the findings rows, so a submit from any of
   * those surfaces flips this card's launcher states and lands its
   * failures in this card's error strip.
   */
  readonly aiActions = input.required<IAiActionsHandle>();

  /** Expanded state; owned + persisted by the host's collapse map. */
  readonly expanded = input.required<boolean>();

  /** Emitted when the user clicks the section's toggle row. */
  readonly toggle = output<void>();

  // --- shared-handle adapters (the template reads through these) ----------

  protected readonly aiActionsAvailable = computed<boolean>(() => this.aiActions().available());
  protected readonly aiActionsSkillMissing = computed(() => this.aiActions().skillMissing());
  protected readonly aiActionsAgentAttending = computed(() =>
    this.aiActions().agentAttending(),
  );
  protected readonly aiActionsError = computed(() => this.aiActions().error());
  protected readonly probExtensions = computed(() => this.aiActions().probExtensions());

  /**
   * The processing-skill invocation for the ACTIVE lens (not the node's
   * provider): the `sm-process-jobs` handle joined against the lens's
   * `invocationSigil`, mirroring Quick Start's agent-jobs row, so the
   * no-agent warnings name the exact thing to type in that runtime.
   */
  protected readonly processInvocation = computed<string>(() => {
    const active = this.projectInfo.activeProvider();
    const sigil = (active ? this.providerRegistry.lookup(active)?.invocationSigil : undefined) ?? '/';
    return `${sigil}sm-process-jobs`;
  });

  /**
   * The shared submit gate: nothing can drain the queue right now (the
   * lens's processing skill is not installed, or no agent is attached to
   * the MCP server), so anything that would enqueue a job sits DISABLED
   * (never hidden) instead of accepting a click that dead-ends in the
   * `no-processing-agent` error strip. Only CONFIRMED readings close it:
   * `null` (unknown / probe failed) fails OPEN.
   *
   * Folded into the existing disabled predicates rather than bound
   * separately at each call site, so a new launcher / fix button
   * inherits the gate for free. Non-submitting controls (the Auto-fixer
   * toggle, dismiss / resolve / restore / delete, the bucket chips) are
   * deliberately NOT gated: they are local state, they work offline.
   */
  protected readonly submitGateClosed = this.processingAgent.submitGateClosed;

  /**
   * Manual full-circuit check (the "Check Agent" chip, right-aligned
   * like the body's Raw toggle): runs the shared `AgentPingService`
   * probe, ONE hidden ping job submitted and watched for a claim, so
   * the verdict proves the whole circuit (submit gate, queue, an agent
   * actually attending), not just a status read. State machine (user
   * spec 2026-07-26): the check waits out the ping window, then the
   * chip holds the VERDICT for 5 seconds, green on a claim, red on
   * silence (while red, the usual gate / attending warnings are back on
   * their own; a green ping also flips server-side presence, which
   * clears the attending warning), and is unclickable until idle.
   */
  protected readonly agentCheckState = signal<'idle' | 'checking' | 'ok' | 'fail'>('idle');

  /** Verdict hold: how long the green / red state lingers before re-arming. */
  private static readonly AGENT_CHECK_HOLD_MS = 5000;

  protected onCheckAgentConnection(): void {
    if (this.agentCheckState() !== 'idle') return;
    this.agentCheckState.set('checking');
    // The skill probe rides along so a stale read refreshes too, but
    // the VERDICT is the ping's: the full circuit, submit through an
    // observed claim, is the only proof an agent is really attending.
    void this.processingAgent.refresh();
    void this.agentPing.check().then((result) => {
      if (result.verdict === 'abandoned') {
        // The other surface abandoned the shared check: no verdict to
        // hold, the chip just re-arms.
        this.agentCheckState.set('idle');
        return;
      }
      const alive = result.verdict === 'alive';
      this.agentCheckState.set(alive ? 'ok' : 'fail');
      this.announcer.announce(
        alive
          ? this.texts.aiActions.checkAgent.announceConnected
          : this.texts.aiActions.checkAgent.announceDisconnected,
      );
      setTimeout(() => {
        this.agentCheckState.set('idle');
      }, InspectorAiActionsSection.AGENT_CHECK_HOLD_MS);
    });
  }

  /**
   * Every actionId claimed by a surface contribution on this node.
   * Drives the launcher exclusion generically: whoever claims a
   * surface is not a launcher (no id literals in the UI).
   */
  private readonly surfaceClaimedActionIds = computed<ReadonlySet<string>>(() => {
    const out = new Set<string>();
    for (const c of this.node().contributions ?? []) {
      if (!c.slot.startsWith('inspector.surface.')) continue;
      const payload = c.payload;
      if (typeof payload !== 'object' || payload === null) continue;
      const id = (payload as { actionId?: unknown }).actionId;
      if (typeof id === 'string') out.add(id);
    }
    return out;
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
    // An extension that CLAIMS a dedicated surface (the summarizer's
    // header affordance, the tagger's sparkles) never rides the
    // launcher row nor the run-all button: the generic rule is
    // "claims a surface on this node" (no extension ids in the UI,
    // kernel-agnosticism sweep 2026-07-23).
    const claimed = this.surfaceClaimedActionIds();
    const standalone = probs.standalone.filter((e) => !claimed.has(e.id));
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
   * Automatic toggle (Step 16), persisted at inspector level like the
   * activity filter. When on, one click on a finder-with-fixer button
   * submits the finder with `autoFix: true` (the kernel chains the
   * fixers on record); when off, the button morphs Detect ⇄ Fix.
   */
  private readonly autoFixState: IAutoFixHandle = setupAutoFix();
  autoFixEnabled(): boolean {
    return this.autoFixState.enabled();
  }
  onAutoFixToggle(value: boolean): void {
    // Gated like every submitting affordance (user call 2026-07-25):
    // the toggle only decides what the NEXT finder click submits, and
    // with nothing able to drain the queue there is no next click, so
    // flipping it would be setting up work that cannot run.
    if (this.submitGateClosed()) return;
    this.autoFixState.set(value);
  }

  /**
   * Tooltip of the Automatic toggle: the gate reason wins over the
   * mechanics blurb, so a disabled switch says WHY instead of
   * explaining a behaviour the operator cannot reach.
   */
  protected autoFixTooltip(): string {
    switch (this.processingAgent.submitGateReason()) {
      case 'skill-missing':
        return this.texts.aiActions.autoFix.tooltipNoAgent;
      case 'agent-silent':
        return this.texts.aiActions.autoFix.tooltipAgentSilent;
      default:
        return this.texts.aiActions.autoFix.tooltip;
    }
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
    return this.aiActions().entryState(entry);
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
   * `hasOpenFindings: false`, so the guard only bites finders. The
   * submit gate rides here too (`submitGateClosed`), which also
   * makes the group ALL loop below skip every entry for free.
   */
  protected aiActionLauncherDisabled(entry: IProbExtensionEntryApi): boolean {
    return (
      this.aiActionEntryState(entry) !== 'idle' ||
      this.aiActions().isSubmitting(entry.id) ||
      entry.hasOpenFindings ||
      this.submitGateClosed()
    );
  }

  /**
   * The group's "(run all)" link. It has no per-entry busy state of its
   * own (the loop skips entries that are individually disabled), so the
   * gate is its only disabled condition.
   */
  protected aiActionLauncherAllDisabled(): boolean {
    return this.submitGateClosed();
  }

  /** True while the launcher shows the busy spinner (running or submitting). */
  protected aiActionLauncherBusy(entry: IProbExtensionEntryApi): boolean {
    return (
      this.aiActionEntryState(entry) === 'running' || this.aiActions().isSubmitting(entry.id)
    );
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
    return this.aiActions().submit(entry.id, autoFix);
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
    return this.aiActions().isCancelling(entry.id);
  }

  protected stopAiAction(entry: IProbExtensionEntryApi): void {
    void this.aiActions().stop(entry);
  }

  protected dismissAiActionsError(): void {
    this.aiActions().dismissError();
  }

  /**
   * Error-strip text: `no-processing-agent` swaps the envelope message
   * (which names the CLI verb) for the UI's own friendly wording; every
   * other code surfaces the server message verbatim (user call
   * 2026-07-22).
   */
  protected aiActionsErrorText(err: { code: string; message: string }): string {
    return err.code === 'no-processing-agent' ? this.texts.aiActions.noAgentMessage : err.message;
  }
}
