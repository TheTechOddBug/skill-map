/**
 * `<sm-quick-start-modal>`, the Quick Start panel (the rocket button in
 * the topbar actions cluster). A lightweight, single-scroll dialog that
 * answers "what do I need to use X?" across three capability groups:
 *
 *   - Live update:  live updates, follow external symlinks.
 *   - Real Time:    real-time hook, real-time node activity, capture.
 *   - AI Actions:   MCP server live, MCP registered, agent skill, agent
 *                   attending jobs.
 *
 * NOT the Settings modal and NOT a tutorial: no left rail, no section
 * router, no buffered Apply / Discard footer, no dirty gate. Each row is
 * a uniform readiness brick (`<sm-quick-start-row>`): label + one-line
 * description on the left, a live status indicator + a single action
 * control on the right. This container owns every probe and mutation; the
 * row shell is purely presentational.
 *
 * The row state machines reuse the Settings Project-section vocabulary,
 * assembled from the factories in `quick-start-rows.controller.ts`
 * (machinery) while this file keeps the per-row declarations (text
 * mappings, gates) and template wiring:
 *   - `setupProbe` envelopes are `null` while unknown, re-probed by an
 *     `effect()` when the modal opens (and when the active lens changes,
 *     for the lens-keyed `setupInstallRow` rows);
 *   - the install-type rows (real-time hook, agent skill) and the
 *     follow-symlinks patch POST WITHOUT `confirm`, catch the BFF's 412
 *     `confirm-required` through the shared `runConfirmGated` runner,
 *     surface a `ConfirmationService` dialog naming the target, and
 *     retry with `{ confirm: true }`;
 *   - the toggle-type rows (live updates, real-time activity) flip
 *     through their runtime OWNERS (`WsEventStreamService` /
 *     `NodeActivityService`) so the preference and the running behaviour
 *     never diverge.
 *
 * `@defer`-wrapped at the App level so its chunk only loads on first open.
 */

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { TooltipModule } from 'primeng/tooltip';

import {
  QUICK_START_TEXTS,
  type IMcpRegisterSnippet,
  type TQuickStartStatus,
  mcpRegisterSnippet,
} from '../../../i18n/quick-start.texts';
import type {
  IActivityCaptureStatusApi,
  IActivityInstallStatusApi,
  IAgentSkillInstallStatusApi,
  IProjectPreferencesApi,
  IProjectPreferencesPatchApi,
} from '../../../models/api';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { AgentPingService } from '../../services/agent-ping';
import { DATA_SOURCE } from '../../../services/data-source/data-source.port';
import { NodeActivityService } from '../../../services/node-activity';
import { WsEventStreamService } from '../../../services/ws-event-stream';
import { ActivityReadinessService } from '../../services/activity-readiness';
import { ProjectInfoService } from '../../services/project-info';
import { ProviderRegistryService } from '../../../services/provider-registry';
import { runConfirmGated, type TConfirmFlow } from '../confirm-gated';
import { formatErr } from '../settings-modal/settings-project.utils';
import {
  runRowMutation,
  setupInstallRow,
  setupProbe,
  setupToggleRow,
  type IRowMachineDeps,
} from './quick-start-rows.controller';
import { QuickStartRow } from './quick-start-row';

/** Milliseconds the "Copied" affordance stays up after a clipboard write. */
const COPIED_FEEDBACK_MS = 2000;
/** Qualified id of the hidden system liveness-probe extension. */
// Ping identity + window live in the shared `AgentPingService`.
/** How long to wait for an agent to claim the ping before calling it idle. */

/** Shared On / Off + Enable / Disable vocabulary of the toggle rows. */
const TOGGLE_ROW_TEXTS = {
  on: QUICK_START_TEXTS.status.on,
  off: QUICK_START_TEXTS.status.off,
  enable: QUICK_START_TEXTS.action.enable,
  disable: QUICK_START_TEXTS.action.disable,
} as const;

/** Liveness-probe state machine for the "Agent attending jobs" row. */
type TPingState = 'idle' | 'checking' | 'alive' | 'no-agent' | 'no-node' | 'error';

/** Left-rail groups (parents) of the two-pane layout. */
type TQuickStartGroup = 'live' | 'realtime' | 'ai';

@Component({
  selector: 'sm-quick-start-modal',
  imports: [
    ButtonModule,
    ConfirmDialogModule,
    DialogModule,
    MessageModule,
    TooltipModule,
    QuickStartRow,
  ],
  providers: [ConfirmationService],
  templateUrl: './quick-start-modal.html',
  styleUrl: './quick-start-modal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuickStartModal {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly confirmation = inject(ConfirmationService);
  private readonly projectInfo = inject(ProjectInfoService);
  private readonly providerRegistry = inject(ProviderRegistryService);
  private readonly document = inject(DOCUMENT);
  private readonly activityReadiness = inject(ActivityReadinessService);
  private readonly nodeActivity = inject(NodeActivityService);
  private readonly wsEvents = inject(WsEventStreamService);
  private readonly loader = inject(CollectionLoaderService);
  private readonly destroyRef = inject(DestroyRef);

  readonly visible = input.required<boolean>();
  readonly visibleChange = output<boolean>();

  protected readonly texts = QUICK_START_TEXTS;

  /**
   * Left-rail groups (parents), mirroring the Settings section rail: the
   * rail lists them, the right panel swaps to the active one's rows.
   */
  protected readonly groups: ReadonlyArray<{
    id: TQuickStartGroup;
    heading: string;
    icon: string;
    description: string;
  }> = [
    {
      id: 'live',
      heading: QUICK_START_TEXTS.groups.live.heading,
      icon: 'pi pi-sync',
      description: QUICK_START_TEXTS.groups.live.description,
    },
    {
      id: 'realtime',
      heading: QUICK_START_TEXTS.groups.realtime.heading,
      icon: 'pi pi-wave-pulse',
      description: QUICK_START_TEXTS.groups.realtime.description,
    },
    {
      id: 'ai',
      heading: QUICK_START_TEXTS.groups.ai.heading,
      icon: 'pi pi-sparkles',
      description: QUICK_START_TEXTS.groups.ai.description,
    },
  ];
  /** Active rail item; the right panel renders this group's rows. */
  protected readonly activeGroup = signal<TQuickStartGroup>('live');

  /** Active group's OWN description, shown as the panel lead (per tab). */
  protected readonly activeGroupDescription = computed<string>(
    () => this.groups.find((g) => g.id === this.activeGroup())?.description ?? '',
  );

  protected selectGroup(id: TQuickStartGroup): void {
    this.activeGroup.set(id);
  }

  /**
   * Per-group tutorial pointer, shown under the active group's rows:
   * names the matching part of the `sm-tutorial` book, with the launch
   * invocation rendered as a command chip between the two segments.
   */
  protected readonly tutorialNotePrefix = computed<string>(() =>
    this.texts.tutorial.notePrefix(this.texts.tutorial.parts[this.activeGroup()]),
  );
  /** The book's launch handle on the active lens (same sigil join as `agentJobsDescription`). */
  protected readonly tutorialInvocation = computed<string>(() => {
    const active = this.activeProvider();
    const sigil = (active ? this.providerRegistry.lookup(active)?.invocationSigil : undefined) ?? '/';
    return `${sigil}sm-tutorial`;
  });

  /** One shared error banner at the top of the body (formatErr output). */
  protected readonly error = signal<string | null>(null);
  /** Pending keys, one per in-flight mutation, so its button disables. */
  private readonly pending = signal<Set<string>>(new Set());

  /**
   * Machinery bundle threaded into every row factory: the one pending
   * set, the one error banner, and the promise-wrapped consent dialog.
   * Arrow-bound so handles built in field initializers can call it after
   * construction completes.
   */
  private readonly rowDeps: IRowMachineDeps = {
    isPending: (key) => this.isPending(key),
    addPending: (key) => this.addPending(key),
    removePending: (key) => this.removePending(key),
    setError: (message) => this.error.set(message),
    reportError: (err) => this.error.set(formatErr(err)),
    confirmConsent: (header, message, acceptLabel, rejectLabel) =>
      this.confirmConsent(header, message, acceptLabel, rejectLabel),
  };

  // Probed envelopes shared across rows. `null` = unknown (probe pending
  // or failed). Preferences feed rows (b) and (f); capture feeds row (e).
  private readonly preferencesProbe = setupProbe<IProjectPreferencesApi>({
    fetch: () => this.dataSource.getProjectPreferences(),
    onError: (err) => this.rowDeps.reportError(err),
  });
  private readonly captureProbe = setupProbe<IActivityCaptureStatusApi>({
    fetch: () => this.dataSource.getActivityCapture(),
    onError: (err) => this.rowDeps.reportError(err),
  });

  /**
   * Client count from the last `/api/mcp/status` read, for the "MCP
   * installed on your agent" row's detail line. `null` = not probed yet
   * (or the probe failed). Deliberately NOT the row's verdict (user
   * decision 2026-07-28): an agent draining over the CLI holds no MCP
   * session, so the count says nothing about readiness; the verdict is
   * whether the MCP server is ON, and the count is information.
   */
  private readonly mcpClients = signal<number | null>(null);
  /**
   * Authoritative MCP endpoint, as reported by `GET /api/mcp/status` (`url`),
   * which the server builds from its OWN bind. `null` until the probe
   * resolves (or when it fails), which is the only case the page-origin
   * fallback covers, see `resolvedMcpUrl`.
   */
  private readonly mcpUrl = signal<string | null>(null);

  /** Sticky "restart sm to apply" hint once the MCP pref is flipped on. */
  private readonly mcpRestartPending = signal(false);
  /** Transient "Copied" feedback for the MCP register-command button. */
  protected readonly mcpCopied = signal(false);

  // Live runtime signals (no probe): the row indicators read them directly.
  private readonly hookInstalledSignal = this.activityReadiness.hookInstalled;
  protected readonly mcpLive = this.projectInfo.mcp;
  private readonly activeProvider = this.projectInfo.activeProvider;

  constructor() {
    // Lens-independent probes: re-run whenever the modal opens.
    effect(() => {
      if (!this.visible()) return;
      void this.preferencesProbe.refresh();
      void this.captureProbe.refresh();
      void this.refreshMcpStatus();
      void this.activityReadiness.refresh();
    });
    // Lens-keyed probes: re-run on open AND on every active-lens change.
    effect(() => {
      const provider = this.activeProvider();
      if (!this.visible() || provider === null) return;
      void this.hookRow.refresh(provider);
      void this.skillRow.refresh(provider);
    });
    // Drop any in-flight liveness watch when the panel is torn down.
    this.destroyRef.onDestroy(() => this.agentPing.abandon());
  }

  /**
   * No dirty gate here (unlike Settings): closing just propagates. A close
   * mid-liveness-check cancels the still-queued ping and drops the watch,
   * so a probe the user walked away from never lingers in the queue.
   */
  protected onVisibleChange(next: boolean): void {
    if (!next) {
      if (this.isPending('ping')) this.agentPing.abandon();
      this.removePending('ping');
    }
    this.visibleChange.emit(next);
  }

  protected isPending(key: string): boolean {
    return this.pending().has(key);
  }

  // ===================================================================
  // Row (a), Live updates, runtime owner: WsEventStreamService.
  // ===================================================================

  protected readonly liveRow = setupToggleRow({
    enabled: this.wsEvents.enabled,
    setEnabled: (next) => this.wsEvents.setEnabled(next),
    texts: TOGGLE_ROW_TEXTS,
  });

  // ===================================================================
  // Row (b), Follow external symlinks, project-preferences PATCH (412 on enable).
  // ===================================================================

  protected readonly followSymlinks = computed<boolean>(
    () => this.preferencesProbe.value()?.scan.followExternalSymlinks ?? false,
  );
  protected readonly followStatus = computed<TQuickStartStatus>(() => {
    if (this.preferencesProbe.value() === null) return 'unknown';
    return this.followSymlinks() ? 'ready' : 'not-ready';
  });
  protected readonly followStatusText = computed<string>(() => {
    if (this.preferencesProbe.value() === null) return this.texts.status.checking;
    return this.followSymlinks() ? this.texts.status.on : this.texts.status.off;
  });
  protected readonly followActionLabel = computed<string>(() =>
    this.followSymlinks() ? this.texts.action.disable : this.texts.action.enable,
  );
  protected readonly followActionDisabled = computed<boolean>(
    () => this.preferencesProbe.value() === null || this.isPending('follow'),
  );

  protected onFollowSymlinksToggle(): void {
    const next = !this.followSymlinks();
    // Enabling EXPANDS the scan surface, so the BFF answers 412 and we
    // surface the consent dialog; disabling narrows it and persists directly.
    void this.runPreferencePatch(
      'follow',
      { scan: { followExternalSymlinks: next } },
      next ? () => this.confirmFollowSymlinks() : undefined,
    );
  }

  private confirmFollowSymlinks(): Promise<boolean> {
    const t = this.texts.rows.followSymlinks;
    return this.confirmConsent(
      t.confirmHeader,
      t.confirmIntro,
      t.confirmAccept,
      t.confirmReject,
    );
  }

  // ===================================================================
  // Row (c), Real-time hook, activity install (412 consent), mirrors
  // SettingsProjectHook. Reuses ActivityReadinessService so the topbar
  // Real Time toggle reacts to installs from here.
  // ===================================================================

  protected readonly hookRow = setupInstallRow<
    IActivityInstallStatusApi,
    'install' | 'uninstall'
  >({
    deps: this.rowDeps,
    key: 'hook',
    provider: () => this.activeProvider() ?? '',
    probe: (provider) => this.dataSource.getActivityInstallStatus(provider),
    chooseOp: (s) => (s.installed ? 'uninstall' : 'install'),
    dispatch: (op, provider, confirm) => {
      const opts = confirm ? { confirm: true } : undefined;
      return op === 'install'
        ? this.dataSource.installActivityHook(provider, opts)
        : this.dataSource.uninstallActivityHook(provider, opts);
    },
    // Keep the shared readiness signal (topbar toggle + real-time row) in sync.
    afterDispatch: () => void this.activityReadiness.refresh(),
    confirmCopy: (op, s) => {
      const t = QUICK_START_TEXTS.rows.hook;
      // Basename only, like SettingsProjectHook: the operator recognises
      // "settings.json" as their CLI's file; the full path reads as noise.
      const file = (s?.configPath ?? '').split('/').pop() ?? '';
      return {
        header: op === 'install' ? t.installConfirmHeader : t.uninstallConfirmHeader,
        message:
          op === 'install'
            ? `${t.installConfirmIntroPrefix} ${file} ${t.installConfirmIntroSuffix}`
            : `${t.uninstallConfirmIntroPrefix} ${file} ${t.uninstallConfirmIntroSuffix}`,
        acceptLabel: t.confirmAccept,
        rejectLabel: t.confirmReject,
      };
    },
  });

  protected readonly hookRowStatus = computed<TQuickStartStatus>(() => {
    const s = this.hookRow.status();
    if (s === null) return 'unknown';
    if (!s.supported) return 'not-ready';
    return s.installed ? 'ready' : 'not-ready';
  });
  protected readonly hookStatusText = computed<string>(() => {
    const s = this.hookRow.status();
    if (s === null) return this.texts.status.checking;
    if (!s.supported) return this.texts.status.unavailable;
    return s.installed ? this.texts.status.installed : this.texts.status.notInstalled;
  });
  protected readonly hookActionLabel = computed<string>(() =>
    this.hookRow.status()?.installed === true
      ? this.texts.action.uninstall
      : this.texts.action.install,
  );
  protected readonly hookActionDisabled = computed<boolean>(() => {
    const s = this.hookRow.status();
    return s === null || !s.supported || this.hookRow.busy();
  });
  protected readonly hookMeta = computed<string | null>(() => {
    const s = this.hookRow.status();
    return s !== null && !s.supported ? this.texts.rows.hook.unsupportedHint : null;
  });

  // ===================================================================
  // Row (d), Real-time node activity, runtime owner: NodeActivityService.
  // Subordinate to Live updates + the hook (rows a and c above).
  // ===================================================================

  private readonly realtimeBlocked = computed<boolean>(
    () => !this.wsEvents.enabled() || this.hookInstalledSignal() === false,
  );
  protected readonly realtimeRow = setupToggleRow({
    enabled: this.nodeActivity.enabled,
    setEnabled: (next) => this.nodeActivity.setEnabled(next),
    texts: TOGGLE_ROW_TEXTS,
    blocked: this.realtimeBlocked,
    blockedHint: QUICK_START_TEXTS.rows.realtime.blockedHint,
  });

  // ===================================================================
  // Row (e), Capture conversations, capture gate. Consent is client-
  // settled (always POST confirm:true), mirrors SettingsProjectCapture.
  // ===================================================================

  protected readonly captureEnabled = computed<boolean>(
    () => this.captureProbe.value()?.enabled ?? false,
  );
  /**
   * Capture ON while the hook is missing is NOT ready: the preference is
   * stored but no activity event ever reaches the server, so there is
   * nothing to capture. Folds the gate into the indicator, the same way the
   * realtime row does (its `setupToggleRow` gate).
   */
  protected readonly captureRowStatus = computed<TQuickStartStatus>(() => {
    if (this.captureProbe.value() === null) return 'unknown';
    return this.captureEnabled() && !this.captureBlocked() ? 'ready' : 'not-ready';
  });
  protected readonly captureStatusText = computed<string>(() => {
    if (this.captureProbe.value() === null) return this.texts.status.checking;
    return this.captureEnabled() ? this.texts.status.on : this.texts.status.off;
  });
  protected readonly captureActionLabel = computed<string>(() =>
    this.captureEnabled() ? this.texts.action.disable : this.texts.action.enable,
  );
  /**
   * Capture is subordinate to the real-time hook (row c) ONLY: without it
   * no activity event reaches skill-map, so the gate would record nothing.
   * Deliberately NOT gated on Live updates (row a), which only governs
   * whether this browser sees the frames, not whether they are captured.
   * `null` (unknown / probe failed) FAILS OPEN.
   */
  private readonly captureBlocked = computed<boolean>(
    () => this.hookInstalledSignal() === false,
  );
  /** Cannot ENABLE while the hook is missing; disabling is always allowed. */
  protected readonly captureActionDisabled = computed<boolean>(
    () =>
      this.captureProbe.value() === null ||
      this.isPending('capture') ||
      (!this.captureEnabled() && this.captureBlocked()),
  );
  protected readonly captureMeta = computed<string | null>(() =>
    this.captureBlocked() ? this.texts.rows.capture.blockedHint : null,
  );

  protected onCaptureToggle(): void {
    const next = !this.captureEnabled();
    const t = this.texts.rows.capture;
    this.confirmation.confirm({
      header: next ? t.enableConfirmHeader : t.disableConfirmHeader,
      message: next ? t.enableConfirmIntro : t.disableConfirmIntro,
      acceptLabel: next ? t.enableConfirmAccept : t.disableConfirmAccept,
      rejectLabel: t.confirmReject,
      acceptButtonProps: { severity: 'primary' },
      rejectButtonProps: { severity: 'secondary' },
      accept: () => {
        void this.runCaptureWrite(next);
      },
    });
  }

  /**
   * Consent was already settled by the dialog above, so the write always
   * carries `confirm: true` (no 412 path); a failure lands on the shared
   * banner via the deps sink.
   */
  private async runCaptureWrite(enabled: boolean): Promise<void> {
    await runRowMutation(this.rowDeps, 'capture', async () => {
      try {
        this.captureProbe.set(
          await this.dataSource.setActivityCapture({ enabled, confirm: true }),
        );
      } catch (err) {
        this.rowDeps.reportError(err);
      }
    });
  }

  // ===================================================================
  // Row (f), MCP server live, /api/health.mcp (live) + the mcpServerEnabled
  // preference (opt-in intent). Flipping the pref on is boot-time, so a
  // restart hint sticks until sm serve is restarted.
  // ===================================================================

  private readonly mcpPrefOn = computed<boolean>(
    () => this.preferencesProbe.value()?.mcpServerEnabled ?? false,
  );
  protected readonly mcpLiveStatus = computed<TQuickStartStatus>(() =>
    this.mcpLive() ? 'ready' : 'not-ready',
  );
  protected readonly mcpLiveStatusText = computed<string>(() => {
    if (this.mcpLive()) return this.texts.status.live;
    if (this.mcpPrefOn() || this.mcpRestartPending()) return this.texts.status.optedIn;
    return this.texts.status.off;
  });
  /** The Enable action shows only when the pref is off and unpended. */
  protected readonly mcpLiveShowAction = computed<boolean>(
    () => !this.mcpLive() && !this.mcpPrefOn() && !this.mcpRestartPending(),
  );
  protected readonly mcpLiveActionDisabled = computed<boolean>(
    () => this.preferencesProbe.value() === null || this.isPending('mcp-pref'),
  );
  protected readonly mcpLiveMeta = computed<string | null>(() =>
    !this.mcpLive() && (this.mcpPrefOn() || this.mcpRestartPending())
      ? this.texts.rows.mcpLive.restartHint
      : null,
  );

  protected onMcpServerEnable(): void {
    void this.runPreferencePatch('mcp-pref', { mcpServerEnabled: true }).then((ok) => {
      if (ok) this.mcpRestartPending.set(true);
    });
  }

  // ===================================================================
  // Row (g), MCP installed on your agent. The verdict is the MCP server
  // being ON (same live health signal as row f), so the step passes as
  // soon as there is an endpoint to register against: the user applies
  // the register snippet (a command on claude / codex, a config edit on
  // antigravity / opencode) and approves the runtime trust prompt in
  // their agent. Registration itself is NOT verifiable (the snippets
  // write personal-scope config, invisible without a `$HOME` read), and
  // a live session is NOT required (a CLI-draining agent never holds
  // one), so Check re-probes `GET /api/mcp/status` and reports any
  // attached client as a detail, never as the bar.
  // ===================================================================

  protected readonly mcpChecking = signal(false);

  /**
   * The endpoint the snippet points at. The server's own `url` wins; the
   * page origin is a LAST resort (probe not resolved yet, or failed) and is
   * only correct when the SPA is served by `sm serve` itself, which is false
   * under the dev setup where a proxy on another port serves the SPA.
   */
  private readonly resolvedMcpUrl = computed<string>(
    () => this.mcpUrl() ?? `${this.document.location.origin}/mcp`,
  );

  /** What Copy hands over for the active lens, joined with the live endpoint. */
  protected readonly mcpSnippet = computed<IMcpRegisterSnippet>(() =>
    mcpRegisterSnippet(this.activeProvider(), this.resolvedMcpUrl()),
  );

  protected readonly mcpInstalledStatus = computed<TQuickStartStatus>(() => {
    if (this.mcpChecking()) return 'unknown';
    return this.mcpLive() ? 'ready' : 'not-ready';
  });
  protected readonly mcpInstalledStatusText = computed<string>(() => {
    if (this.mcpChecking()) return this.texts.status.checking;
    if (!this.mcpLive()) return this.texts.status.off;
    const clients = this.mcpClients();
    if (clients === null) return this.texts.status.live;
    return clients > 0
      ? this.texts.rows.mcpInstalled.liveAttached(clients)
      : this.texts.rows.mcpInstalled.liveUnattached;
  });
  protected readonly mcpCopyLabel = computed<string>(() => {
    if (this.mcpCopied()) return this.texts.action.copied;
    return this.mcpSnippet().kind === 'config'
      ? this.texts.action.copyConfig
      : this.texts.action.copyCommand;
  });
  protected readonly mcpInstalledMeta = computed<string | null>(() => {
    if (this.mcpCopied()) return this.texts.rows.mcpInstalled.copiedHint;
    // A config snippet is useless without knowing which file it goes into,
    // so the target rides the hint line whenever nothing else claims it.
    const snippet = this.mcpSnippet();
    if (snippet.kind === 'config' && snippet.target !== undefined) {
      return this.texts.rows.mcpInstalled.pasteHint(snippet.target);
    }
    return null;
  });
  /**
   * The paste hint names work the operator still has to do by hand
   * (open that file, paste the snippet), so it wears the warning hue
   * like the restart-pending line above it. The copy confirmation is a
   * plain acknowledgement and stays muted.
   */
  protected readonly mcpInstalledMetaTone = computed<'muted' | 'warn'>(() =>
    !this.mcpCopied() && this.mcpInstalledMeta() !== null ? 'warn' : 'muted',
  );

  /** Re-probe `/api/mcp/status` and refresh the row's detail line. */
  protected async onCheckMcpConnection(): Promise<void> {
    this.mcpChecking.set(true);
    try {
      const res = await this.dataSource.mcpStatus();
      this.mcpClients.set(res.clients);
      // Same payload carries the authoritative endpoint, so a Check also
      // refreshes what Copy would hand over.
      this.mcpUrl.set(res.url);
    } catch {
      // Detail unknown; the verdict rides the live health signal anyway.
      this.mcpClients.set(null);
    } finally {
      this.mcpChecking.set(false);
    }
  }

  protected async onCopyMcpSnippet(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.mcpSnippet().payload);
      this.mcpCopied.set(true);
      setTimeout(() => this.mcpCopied.set(false), COPIED_FEEDBACK_MS);
    } catch {
      // Clipboard blocked (insecure context / denied). Non-actionable, no-op.
    }
  }

  // ===================================================================
  // Row (h), Agent skill, agent install (412 consent), mirrors
  // SettingsProjectSkill (install / update / uninstall collapse to one
  // constructive action here; up-to-date shows the ready indicator).
  // ===================================================================

  protected readonly skillRow = setupInstallRow<IAgentSkillInstallStatusApi, 'install'>({
    deps: this.rowDeps,
    key: 'skill',
    provider: () => this.activeProvider() ?? '',
    probe: (provider) => this.dataSource.getAgentSkillInstallStatus(provider),
    // Install and update collapse to the ONE constructive op here: the
    // CLI's install endpoint also refreshes a stale copy.
    chooseOp: () => 'install',
    dispatch: (_op, provider, confirm) =>
      this.dataSource.installAgentSkill(provider, confirm ? { confirm: true } : undefined),
    confirmCopy: (_op, s) => {
      const t = QUICK_START_TEXTS.rows.agentSkill;
      const dir = s?.skillDir ?? '';
      const stale = s?.stale === true;
      return {
        header: stale ? t.updateConfirmHeader : t.installConfirmHeader,
        message: stale
          ? `${t.updateConfirmIntroPrefix} ${dir} ${t.updateConfirmIntroSuffix}`
          : `${t.installConfirmIntroPrefix} ${dir} ${t.installConfirmIntroSuffix}`,
        acceptLabel: t.confirmAccept,
        rejectLabel: t.confirmReject,
      };
    },
  });

  private readonly skillUpToDate = computed<boolean>(() => {
    const s = this.skillRow.status();
    return s !== null && s.installed && !s.stale;
  });
  protected readonly skillRowStatus = computed<TQuickStartStatus>(() => {
    const s = this.skillRow.status();
    if (s === null) return 'unknown';
    if (!s.supported) return 'not-ready';
    return s.installed && !s.stale ? 'ready' : 'not-ready';
  });
  protected readonly skillStatusText = computed<string>(() => {
    const s = this.skillRow.status();
    if (s === null) return this.texts.status.checking;
    if (!s.supported) return this.texts.status.unavailable;
    if (s.installed && s.stale) return this.texts.status.updateAvailable;
    if (s.installed) return this.texts.status.installed;
    return this.texts.status.notInstalled;
  });
  protected readonly skillActionLabel = computed<string>(() =>
    this.skillRow.status()?.stale === true
      ? this.texts.action.update
      : this.texts.action.install,
  );
  /** Show the constructive action unless the skill is installed and current. */
  protected readonly skillShowAction = computed<boolean>(() => {
    const s = this.skillRow.status();
    return s !== null && s.supported && !this.skillUpToDate();
  });
  /**
   * Busy alias: unlike the hook row, the button never disables on an
   * unknown / unsupported envelope, it is HIDDEN then (`skillShowAction`).
   */
  protected readonly skillActionDisabled = this.skillRow.busy;

  // ===================================================================
  // Row (i), Agent attending jobs. Liveness probe: submit the hidden
  // `core/ai-ping-action` job against a real node and watch `/ws` for a
  // claim within PING_TIMEOUT_MS. A claim proves an external agent is
  // draining the queue; a timeout cancels the still-queued ping (jobs
  // never auto-expire, Decision #139) so it does not linger. Gated on the
  // agent skill (row h): without it the submit is refused
  // `no-processing-agent`. Deliberately NOT a factory row: the ping is a
  // one-shot state machine, not a probe + mutation pair.
  // ===================================================================

  private readonly pingState = signal<TPingState>('idle');
  private readonly agentPing = inject(AgentPingService);

  private readonly skillInstalled = computed<boolean>(
    () => this.skillRow.status()?.installed === true,
  );

  protected readonly agentJobsStatus = computed<TQuickStartStatus>(() => {
    if (this.isPending('ping')) return 'unknown';
    if (!this.skillInstalled()) return 'not-ready';
    switch (this.pingState()) {
      case 'alive':
        return 'ready';
      case 'no-agent':
      case 'no-node':
      case 'error':
        return 'not-ready';
      default:
        return 'unknown';
    }
  });

  protected readonly agentJobsStatusText = computed<string>(() => {
    if (this.isPending('ping')) return this.texts.status.checking;
    if (!this.skillInstalled()) return this.texts.status.needsSkill;
    switch (this.pingState()) {
      case 'alive':
        return this.texts.status.attending;
      case 'no-agent':
        return this.texts.status.noAgent;
      case 'no-node':
        return this.texts.status.noNodeToProbe;
      default:
        return this.texts.status.unknown;
    }
  });

  protected readonly agentJobsActionLabel = computed<string>(() =>
    this.pingState() === 'idle' ? this.texts.action.check : this.texts.action.recheck,
  );
  protected readonly agentJobsActionDisabled = computed<boolean>(
    () => this.isPending('ping') || !this.skillInstalled(),
  );
  protected readonly agentJobsMeta = computed<string | null>(() =>
    this.skillInstalled() ? null : this.texts.rows.agentJobs.needsSkillHint,
  );
  /**
   * The skill invocation for the active lens: the `sm-process-jobs` handle
   * joined against the Provider's `invocationSigil` (`/sm-process-jobs` on
   * claude / antigravity / opencode, `$sm-process-jobs` on codex; `/` when
   * the lens declares none or the registry has not loaded).
   */
  protected readonly agentJobsDescription = computed<string>(() => {
    const active = this.activeProvider();
    const sigil = (active ? this.providerRegistry.lookup(active)?.invocationSigil : undefined) ?? '/';
    return this.texts.rows.agentJobs.description(`${sigil}sm-process-jobs`);
  });

  protected onAgentJobsCheck(): void {
    void this.runPingCheck();
  }

  /**
   * Run the shared full-circuit probe (`AgentPingService`: submit the
   * hidden ping, adopt a wedged duplicate, watch for a claim, cancel on
   * timeout) and map its verdict onto this row's states. Kept longhand
   * (not `runRowMutation`): the pending key deliberately releases BEFORE
   * the verdict mapping, and `check()` settles instead of throwing.
   */
  private async runPingCheck(): Promise<void> {
    const key = 'ping';
    if (this.isPending(key)) return;
    this.addPending(key);
    this.error.set(null);
    this.pingState.set('checking');
    const result = await this.agentPing.check();
    this.removePending(key);
    if (result.verdict === 'abandoned') {
      // The surface closed mid-check: back to idle, no verdict to show.
      this.pingState.set('idle');
      return;
    }
    if (result.verdict === 'error') {
      this.pingState.set('error');
      this.error.set(result.message ?? '');
      return;
    }
    this.pingState.set(
      result.verdict === 'alive' ? 'alive' : result.verdict === 'no-node' ? 'no-node' : 'no-agent',
    );
  }

  // ===================================================================
  // Shared consent + pending + patch machinery.
  // ===================================================================

  /**
   * Present a consent dialog and resolve `true` on accept, `false` on
   * dismiss. Wraps `ConfirmationService.confirm` in a promise so the
   * install / patch flows can `await` the user's decision inline.
   */
  private confirmConsent(
    header: string,
    message: string,
    acceptLabel: string,
    rejectLabel: string,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.confirmation.confirm({
        header,
        message,
        acceptLabel,
        rejectLabel,
        acceptButtonProps: { severity: 'primary' },
        rejectButtonProps: { severity: 'secondary' },
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    });
  }

  /**
   * Try a project-preferences PATCH through the shared `runConfirmGated`
   * runner: on a 412 `confirm-required` with a supplied `confirm` flow,
   * present it and retry with `confirm: true` on accept. Resolves `true`
   * only when the write actually persisted. The pending key is held for
   * the whole flow, dialog included, so the row's control stays disabled
   * until the user decides.
   */
  private async runPreferencePatch(
    key: string,
    patch: IProjectPreferencesPatchApi,
    confirm?: TConfirmFlow,
  ): Promise<boolean> {
    const persisted = await runRowMutation(this.rowDeps, key, () =>
      runConfirmGated({
        attempt: async (withConsent) => {
          this.preferencesProbe.set(
            await this.dataSource.setProjectPreferences(
              withConsent ? { ...patch, confirm: true } : patch,
            ),
          );
        },
        confirm,
        onError: (err) => this.rowDeps.reportError(err),
      }),
    );
    return persisted === true;
  }

  private addPending(key: string): void {
    const next = new Set(this.pending());
    next.add(key);
    this.pending.set(next);
  }

  private removePending(key: string): void {
    const next = new Set(this.pending());
    next.delete(key);
    this.pending.set(next);
  }

  // ===================================================================
  // Probes (the bespoke one; the row probes live on their handles).
  // ===================================================================

  /**
   * Cheap O(1) read of `/api/mcp/status` on open, so the Copy affordance
   * is already accurate and the row's detail line (any attached client)
   * is fresh before the operator touches Check. Failure is silent (no
   * error banner): the fallback URL keeps Copy useful, the verdict rides
   * the live health signal, and Check is the user-visible re-probe. Not a
   * `setupProbe`: it lands TWO signals with different reset semantics
   * (`mcpUrl` survives a failed Check, see `onCheckMcpConnection`).
   */
  private async refreshMcpStatus(): Promise<void> {
    try {
      const res = await this.dataSource.mcpStatus();
      this.mcpUrl.set(res.url);
      this.mcpClients.set(res.clients);
    } catch {
      this.mcpUrl.set(null);
      this.mcpClients.set(null);
    }
  }
}
