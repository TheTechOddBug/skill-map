/**
 * `<sm-settings-project>`, Project section of the Settings modal.
 *
 * Two co-located list-rows:
 *
 *   1. `scan.referencePaths`, privacy-sensitive list of folders the
 *      scan walks ONLY to validate broken links. Writes that EXPAND
 *      the scan's disk-access surface (paths outside the project)
 *      go through a `<p-confirmdialog>` and re-issue the PATCH with
 *      `confirm: true`. Persists in
 *      `<cwd>/.skill-map/settings.local.json`.
 *
 *   2. `.skillmapignore` patterns, gitignore-style filter for the
 *      scan. No privacy gate (patterns only NARROW the surface);
 *      no existence check (entries are patterns, not paths). The
 *      BFF preserves any comments / blank lines in the file on
 *      write, so the operator can keep their hand-authored layout
 *      while still using the UI for add/remove. Persists in
 *      `<cwd>/.skillmapignore`.
 *
 * Lifecycle mirrors `settings-plugins.ts` / `settings-general.ts`:
 * fetch both envelopes on `(visible) === true`, render, dispatch
 * via the data-source port.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { Select, SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import type {
  IActiveProviderApi,
  IActivityCaptureStatusApi,
  IActivityInstallStatusApi,
  IProjectIgnoreApi,
  IProjectIgnorePatchApi,
  IProjectPreferencesApi,
  IProjectPreferencesPatchApi,
} from '../../../models/api';
import {
  DATA_SOURCE,
  DataSourceError,
} from '../../../services/data-source/data-source.port';
import { ProviderRegistryService } from '../../../services/provider-registry';

/**
 * Single line, no ASCII control / DEL characters. Mirrors the BFF's
 * AJV schema in `routes/project-ignore.ts`. Surfaces the validation
 * error in the same input the user typed in, before the network
 * round-trip.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RX = /[\n\r\x00-\x1F\x7F]/;

@Component({
  selector: 'sm-settings-project',
  imports: [
    FormsModule,
    ButtonModule,
    ConfirmDialogModule,
    InputTextModule,
    MessageModule,
    SelectModule,
    ToggleSwitchModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './settings-project.html',
  styleUrl: './settings-project.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProject {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly confirmation = inject(ConfirmationService);
  private readonly providerRegistry = inject(ProviderRegistryService);

  readonly visible = input.required<boolean>();

  /**
   * The active-provider `<p-select>`. Held so we can force its overlay
   * shut when the section / dialog closes: the panel renders with
   * `appendTo="body"`, so it lives OUTSIDE the dialog DOM and the modal
   * hiding (the chassis keeps its content mounted, it does not destroy it)
   * would otherwise leave the open dropdown orphaned on `<body>`.
   */
  private readonly providerSelect = viewChild(Select);

  protected readonly texts = SETTINGS_TEXTS;
  // ---- reference-paths state -------------------------------------------
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly preferences = signal<IProjectPreferencesApi | null>(null);
  /** Pending sub-key keys ('scan.referencePaths' or 'ignore.patterns'). */
  protected readonly pending = signal<Set<string>>(new Set());

  /** New-row input box for the reference-paths list. */
  protected readonly newReferencePath = signal('');

  protected readonly referencePaths = computed<readonly string[]>(() => {
    const env = this.preferences();
    return env?.scan.referencePaths ?? [];
  });

  /**
   * Committed sidecar-writer policy (team-shared). `true` (default)
   * keeps writer actions; `false` disables every sidecar-writing
   * extension and refuses `.sm` writes. Defaults to `true` before the
   * envelope loads so the switch does not flash "off".
   */
  protected readonly allowSidecarWriters = computed<boolean>(() => {
    return this.preferences()?.allowSidecarWriters ?? true;
  });

  /**
   * Machine-local plugin-trust opt-in (`pluginTrust.projectEnabled`).
   * `false` (default) requires per-plugin trust; `true` locally trusts
   * every plugin the project enables. Read defensively so an older
   * envelope that predates the field renders the switch off rather than
   * flashing. Flipping it ON expands the local code-execution surface, so
   * the write goes through the same confirm dialog as reference-paths.
   */
  protected readonly pluginTrustEnabled = computed<boolean>(() => {
    return this.preferences()?.pluginTrust?.projectEnabled ?? false;
  });

  // ---- ignore-patterns state -------------------------------------------
  protected readonly ignoreLoadError = signal<string | null>(null);
  protected readonly ignoreSaveError = signal<string | null>(null);
  protected readonly ignoreEnvelope = signal<IProjectIgnoreApi | null>(null);
  protected readonly newIgnorePattern = signal('');

  protected readonly ignorePatterns = computed<readonly string[]>(() => {
    return this.ignoreEnvelope()?.patterns ?? [];
  });

  // ---- active-provider state -------------------------------------------
  protected readonly activeProviderEnvelope = signal<IActiveProviderApi | null>(null);
  protected readonly activeProviderLoadError = signal<string | null>(null);
  protected readonly activeProviderSaveError = signal<string | null>(null);
  protected readonly activeProviderSwitchAnnouncement = signal<string | null>(null);
  /**
   * Options consumed by `<p-select>`. Prepends the "(none)" entry so the
   * user can explicitly clear the lens; the rest come from the runtime
   * `ProviderRegistryService` (fed by the `providerRegistry` envelope
   * field), so the dropdown lists exactly the Providers registered in
   * this scope, never a hardcoded list. Downstream `'' → null`
   * conversion stays in `onActiveProviderChange()`.
   *
   * Only LENS Providers (`isLens: true`) are listed: the non-gated
   * `markdown` base is the universal substrate, not a pickable lens, so it
   * is filtered out entirely (never even a greyed row). Among the lenses,
   * each one absent from the envelope's `selectable` set (the ids enabled
   * right now) is rendered disabled: greyed and not selectable
   * (`optionDisabled` in the template) plus a "(disabled)" suffix, so it
   * stays visible but can never be chosen. This covers both
   * operator-disabled lenses and the experimental ones that ship disabled
   * by default. Before the envelope loads (`selectable === null`) nothing
   * is greyed, to avoid a flash of all-disabled rows.
   */
  protected readonly providerOptions = computed<
    { id: string; label: string; disabled: boolean }[]
  >(() => {
    const env = this.activeProviderEnvelope();
    const selectable = env ? new Set(env.selectable) : null;
    const providers = this.providerRegistry
      .providers()
      // Only lenses are pickable. The non-gated `markdown` base (`isLens:
      // false`) is the substrate beneath every lens, never a dropdown row.
      .filter((p) => p.isLens)
      .map((p) => {
        const disabled = selectable !== null && !selectable.has(p.id);
        const label = disabled
          ? `${p.label} ${SETTINGS_TEXTS.project.activeProviderDisabledSuffix}`
          : p.label;
        return { id: p.id, label, disabled };
      })
      // Enabled providers first, disabled ones sink to the bottom.
      // Array.sort is stable, so relative registry order holds within each group.
      .sort((a, b) => Number(a.disabled) - Number(b.disabled));
    return providers;
  });

  /** Current resolved value (from config or autodetect); `''` for "none". */
  protected readonly activeProviderValue = computed<string>(() => {
    return this.activeProviderEnvelope()?.activeProvider ?? '';
  });

  /** Comma-separated list of detected provider ids. Empty when none. */
  protected readonly activeProviderDetectedLabel = computed<string>(() => {
    return (this.activeProviderEnvelope()?.detected ?? []).join(', ');
  });

  /** Which source the persisted value came from. */
  protected readonly activeProviderSource = computed<IActiveProviderApi['source']>(() => {
    return this.activeProviderEnvelope()?.source ?? 'default';
  });

  // ---- activity-hook state ----------------------------------------------
  /**
   * Install status of the ACTIVE lens's live-activity hook
   * (`GET /api/activity/install`). `null` until the probe resolves (or
   * when it failed); re-fetched whenever the lens envelope refreshes or
   * a confirmed lens switch lands, so the button always describes the
   * CURRENT lens.
   */
  protected readonly activityStatus = signal<IActivityInstallStatusApi | null>(null);
  protected readonly activityError = signal<string | null>(null);
  protected readonly activityAnnouncement = signal<string | null>(null);

  /** Registry label of the active lens (falls back to the raw id). */
  private readonly activeProviderLabel = computed<string>(() => {
    const id = this.activeProviderValue();
    const entry = this.providerRegistry.providers().find((p) => p.id === id);
    return entry?.label ?? id;
  });

  /**
   * Button label, tracking the selected lens AND the install state:
   * "Install <lens label> activity hook" / "Uninstall <lens label>
   * activity hook". While the status is unknown the Install form shows
   * (the button is disabled anyway).
   */
  protected readonly activityButtonLabel = computed<string>(() => {
    const t = this.texts.project.activityHook;
    const action =
      this.activityStatus()?.installed === true ? t.uninstallPrefix : t.installPrefix;
    return `${action} ${this.activeProviderLabel()} ${t.labelSuffix}`;
  });

  /** Disabled while unknown, unsupported, or a mutation is in flight. */
  protected readonly activityButtonDisabled = computed<boolean>(() => {
    const status = this.activityStatus();
    return status === null || !status.supported || this.pending().has('activity.hook');
  });

  /** Hint under the button; only the unsupported-lens case renders one. */
  protected readonly activityHint = computed<string | null>(() => {
    const status = this.activityStatus();
    if (status !== null && !status.supported) {
      return this.texts.project.activityHook.unsupportedHint;
    }
    return null;
  });

  // ---- conversation-capture state -----------------------------------------
  /**
   * Capture gate envelope (`GET /api/activity/capture`), re-fetched on
   * every section open. `null` while unknown (probe pending or failed);
   * the toggle disables then, a write against an unknown baseline
   * would race the server state.
   */
  protected readonly captureStatus = signal<IActivityCaptureStatusApi | null>(null);
  protected readonly captureError = signal<string | null>(null);

  protected readonly captureEnabled = computed<boolean>(() => {
    return this.captureStatus()?.enabled ?? false;
  });

  constructor() {
    effect(() => {
      if (this.visible()) {
        void this.refresh();
        void this.refreshIgnore();
        void this.refreshActiveProvider();
        void this.refreshCapture();
      }
    });

    // Close the provider dropdown when the section / dialog closes. The
    // panel is `appendTo="body"` so it outlives a still-mounted trigger;
    // without this an open dropdown orphans on `<body>` after the modal
    // hides. `hide()` is a no-op when the overlay is already closed.
    effect(() => {
      if (!this.visible()) this.providerSelect()?.hide();
    });
  }

  protected isPending(key: string): boolean {
    return this.pending().has(key);
  }

  // -----------------------------------------------------------------
  // Reference-paths handlers
  // -----------------------------------------------------------------

  protected onReferencePathAdd(): void {
    const raw = this.newReferencePath().trim();
    if (raw.length === 0) return;
    if (raw.includes(',')) {
      this.saveError.set(this.texts.project.commaForbidden);
      return;
    }
    const next = [...this.referencePaths(), raw];
    void this.runPatch(
      'scan.referencePaths',
      { scan: { referencePaths: next } },
      this.referencePathsConfirmFlow(),
    ).then(
      (ok) => {
        // Only clear the input on a successful persist; a 400 (path
        // does not exist, comma, malformed) or 412 (confirm required
        // and the user dismissed the dialog) leaves the value in
        // place so the operator can edit and retry without retyping.
        if (ok) this.newReferencePath.set('');
      },
    );
  }

  protected onReferencePathRemove(path: string): void {
    const next = this.referencePaths().filter((p) => p !== path);
    void this.runPatch('scan.referencePaths', { scan: { referencePaths: [...next] } });
  }

  // -----------------------------------------------------------------
  // Sidecar-writer policy handler
  // -----------------------------------------------------------------

  protected onSidecarWritersToggle(next: boolean): void {
    void this.runPatch('allowSidecarWriters', { allowSidecarWriters: next });
  }

  // -----------------------------------------------------------------
  // Plugin-trust opt-in handler
  // -----------------------------------------------------------------

  /**
   * Flip the machine-local `pluginTrust.projectEnabled` opt-in. Turning
   * it ON expands the local code-execution surface, so the BFF answers
   * 412 `confirm-required`; `runPatch` then surfaces the dedicated trust
   * confirm dialog and retries with `confirm: true` on accept. Turning it
   * OFF narrows the surface and persists directly. On a 412 the user
   * dismisses, the toggle snaps back because `preferences()` is unchanged.
   */
  protected onProjectTrustToggle(next: boolean): void {
    void this.runPatch(
      'pluginTrust.projectEnabled',
      { pluginTrust: { projectEnabled: next } },
      this.pluginTrustConfirmFlow(),
    );
  }

  // -----------------------------------------------------------------
  // Ignore-patterns handlers
  // -----------------------------------------------------------------

  protected onIgnorePatternAdd(): void {
    const raw = this.newIgnorePattern().trim();
    if (raw.length === 0) {
      this.ignoreSaveError.set(this.texts.project.ignorePatternEmpty);
      return;
    }
    if (CONTROL_CHAR_RX.test(raw)) {
      this.ignoreSaveError.set(this.texts.project.ignorePatternHasControlChar);
      return;
    }
    const current = this.ignorePatterns();
    if (current.includes(raw)) {
      this.ignoreSaveError.set(this.texts.project.ignorePatternDuplicate);
      return;
    }
    const next = [...current, raw];
    void this.runIgnorePatch({ patterns: next }).then((ok) => {
      if (ok) this.newIgnorePattern.set('');
    });
  }

  protected onIgnorePatternRemove(pattern: string): void {
    const next = this.ignorePatterns().filter((p) => p !== pattern);
    void this.runIgnorePatch({ patterns: [...next] });
  }

  // -----------------------------------------------------------------
  // Active-provider handlers
  // -----------------------------------------------------------------

  /**
   * Triggered by the `<select>`'s `(change)` event. Opens the
   * confirm dialog because switching the lens is destructive of the
   * scan_* DB zone (see spec/architecture.md §Active Provider Lens).
   * On accept, calls the data-source; on reject, reverts the
   * dropdown to the previous value by re-emitting the envelope.
   */
  protected onActiveProviderChange(newValue: string): void {
    if (newValue === this.activeProviderValue()) return;
    this.confirmActiveProviderSwitch(newValue, async () => {
      await this.runActiveProviderSwitch(newValue);
    });
  }

  // -----------------------------------------------------------------
  // Activity-hook handlers
  // -----------------------------------------------------------------

  /**
   * One button, two operations: install when the hook is absent,
   * uninstall when present. Both first POST WITHOUT `confirm`; the BFF
   * refuses 412 `confirm-required` (server-enforced consent, nothing
   * written), which surfaces the consent dialog naming the exact config
   * file; accepting retries with `confirm: true`. Success adopts the
   * refreshed status envelope from the response.
   */
  protected onActivityHookToggle(): void {
    const status = this.activityStatus();
    if (status === null || !status.supported) return;
    void this.runActivityMutation(status.installed ? 'uninstall' : 'install');
  }

  private async runActivityMutation(op: 'install' | 'uninstall'): Promise<void> {
    const key = 'activity.hook';
    if (this.pending().has(key)) return;
    const providerId = this.activeProviderValue();
    const next = new Set(this.pending());
    next.add(key);
    this.pending.set(next);
    this.activityError.set(null);
    this.activityAnnouncement.set(null);
    try {
      await this.dispatchActivity(op, providerId, false);
    } catch (err) {
      if (err instanceof DataSourceError && err.code === 'confirm-required') {
        this.confirmActivityDialog(op, async () => {
          try {
            await this.dispatchActivity(op, providerId, true);
          } catch (innerErr) {
            this.activityError.set(formatErr(innerErr));
          }
        });
      } else {
        this.activityError.set(formatErr(err));
      }
    } finally {
      const after = new Set(this.pending());
      after.delete(key);
      this.pending.set(after);
    }
  }

  /** Fire one install/uninstall POST and adopt its response envelope. */
  private async dispatchActivity(
    op: 'install' | 'uninstall',
    providerId: string,
    confirm: boolean,
  ): Promise<void> {
    const opts = confirm ? { confirm: true } : undefined;
    const t = this.texts.project.activityHook;
    if (op === 'install') {
      const status = await this.dataSource.installActivityHook(providerId, opts);
      this.activityStatus.set(status);
      this.activityAnnouncement.set(`${t.installedPrefix} ${status.configPath ?? ''}.`);
      return;
    }
    const envelope = await this.dataSource.uninstallActivityHook(providerId, opts);
    this.activityStatus.set(envelope);
    this.activityAnnouncement.set(
      envelope.removed
        ? `${t.uninstalledPrefix} ${envelope.configPath ?? ''}.`
        : t.nothingToUninstall,
    );
  }

  // -----------------------------------------------------------------
  // Conversation-capture handlers
  // -----------------------------------------------------------------

  /**
   * Both directions go through a confirm dialog (consent-worded on
   * enable, "clears immediately" on disable), and the POST that
   * follows ALWAYS carries `confirm: true`: consent is settled client-
   * side first, so the server's 412 `confirm-required` path never
   * fires from this surface. On dismiss the toggle snaps back because
   * the envelope is re-emitted unchanged (same revert pattern as the
   * lens dropdown).
   */
  protected onCaptureToggle(next: boolean): void {
    if (next === this.captureEnabled()) return;
    const t = this.texts.project.activityCapture;
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
      reject: () => {
        const status = this.captureStatus();
        if (status) this.captureStatus.set({ ...status });
      },
    });
  }

  private async runCaptureWrite(enabled: boolean): Promise<void> {
    const key = 'activity.capture';
    if (this.pending().has(key)) return;
    const next = new Set(this.pending());
    next.add(key);
    this.pending.set(next);
    this.captureError.set(null);
    try {
      this.captureStatus.set(
        await this.dataSource.setActivityCapture({ enabled, confirm: true }),
      );
    } catch (err) {
      this.captureError.set(formatErr(err));
    } finally {
      const after = new Set(this.pending());
      after.delete(key);
      this.pending.set(after);
    }
  }

  private confirmActivityDialog(op: 'install' | 'uninstall', onAccept: () => Promise<void>): void {
    const t = this.texts.project.activityHook;
    const configPath = this.activityStatus()?.configPath ?? '';
    const header = op === 'install' ? t.installConfirmHeader : t.uninstallConfirmHeader;
    const intro =
      op === 'install'
        ? `${t.installConfirmIntroPrefix} ${configPath} ${t.installConfirmIntroSuffix}`
        : `${t.uninstallConfirmIntroPrefix} ${configPath} ${t.uninstallConfirmIntroSuffix}`;
    this.confirmation.confirm({
      header,
      message: intro,
      acceptLabel: t.confirmAccept,
      rejectLabel: t.confirmReject,
      acceptButtonProps: { severity: 'primary' },
      rejectButtonProps: { severity: 'secondary' },
      accept: () => {
        void onAccept();
      },
    });
  }

  // -----------------------------------------------------------------
  // Refresh + dispatch helpers
  // -----------------------------------------------------------------

  /** Fetch the reference-paths envelope. */
  private async refresh(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    this.saveError.set(null);
    try {
      const envelope = await this.dataSource.getProjectPreferences();
      this.preferences.set(envelope);
    } catch (err) {
      this.loadError.set(formatErr(err));
      this.preferences.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  /** Fetch the ignore-patterns envelope. */
  private async refreshIgnore(): Promise<void> {
    this.ignoreLoadError.set(null);
    this.ignoreSaveError.set(null);
    try {
      const envelope = await this.dataSource.getProjectIgnore();
      this.ignoreEnvelope.set(envelope);
    } catch (err) {
      this.ignoreLoadError.set(formatErr(err));
      this.ignoreEnvelope.set(null);
    }
  }

  /** Fetch the conversation-capture gate state. */
  private async refreshCapture(): Promise<void> {
    this.captureError.set(null);
    try {
      this.captureStatus.set(await this.dataSource.getActivityCapture());
    } catch (err) {
      this.captureError.set(formatErr(err));
      this.captureStatus.set(null);
    }
  }

  /** Fetch the active-provider envelope, then the hook status for it. */
  private async refreshActiveProvider(): Promise<void> {
    this.activeProviderLoadError.set(null);
    this.activeProviderSaveError.set(null);
    try {
      const envelope = await this.dataSource.getActiveProvider();
      this.activeProviderEnvelope.set(envelope);
      await this.refreshActivityStatus(envelope.activeProvider);
    } catch (err) {
      this.activeProviderLoadError.set(formatErr(err));
      this.activeProviderEnvelope.set(null);
    }
  }

  /** Probe the live-activity hook status for the given lens. */
  private async refreshActivityStatus(providerId: string): Promise<void> {
    this.activityError.set(null);
    if (providerId.length === 0) {
      this.activityStatus.set(null);
      return;
    }
    try {
      this.activityStatus.set(await this.dataSource.getActivityInstallStatus(providerId));
    } catch (err) {
      this.activityError.set(formatErr(err));
      this.activityStatus.set(null);
    }
  }

  /**
   * Persist the lens switch, then update local state with the
   * server's announcement of what was cleared. Errors land in
   * `activeProviderSaveError` and the dropdown reverts to the prior
   * envelope value (the user sees their action did not take effect).
   */
  private async runActiveProviderSwitch(newValue: string): Promise<void> {
    this.activeProviderSaveError.set(null);
    this.activeProviderSwitchAnnouncement.set(null);
    try {
      const envelope = await this.dataSource.setActiveProvider(newValue);
      this.activeProviderEnvelope.set({
        activeProvider: envelope.activeProvider,
        detected: envelope.detected,
        source: envelope.source,
        selectable: envelope.selectable,
        markerDrift: envelope.markerDrift,
      });
      const dropped = envelope.switch.dropped;
      if (dropped === null) {
        this.activeProviderSwitchAnnouncement.set(
          this.texts.project.activeProviderSwitchedNoDb,
        );
      } else {
        const t = this.texts.project;
        this.activeProviderSwitchAnnouncement.set(
          `${t.activeProviderSwitchedPrefix} ${dropped.tableCount} ${t.activeProviderSwitchedSuffix}`,
        );
      }
      // The lens changed: re-probe the hook status so the button label
      // and state describe the NEW lens.
      await this.refreshActivityStatus(envelope.activeProvider);
    } catch (err) {
      this.activeProviderSaveError.set(formatErr(err));
    }
  }

  private confirmActiveProviderSwitch(_newValue: string, onAccept: () => Promise<void>): void {
    this.confirmation.confirm({
      header: this.texts.project.activeProviderConfirmHeader,
      message: this.texts.project.activeProviderConfirmIntro,
      acceptLabel: this.texts.project.activeProviderConfirmAccept,
      rejectLabel: this.texts.project.activeProviderConfirmReject,
      acceptButtonProps: { severity: 'primary' },
      rejectButtonProps: { severity: 'secondary' },
      accept: () => {
        void onAccept();
      },
      reject: () => {
        // Revert the dropdown to the previous envelope value by
        // re-emitting it; the (change) handler short-circuits on
        // unchanged values, so this puts the UI back in sync.
        const env = this.activeProviderEnvelope();
        if (env) this.activeProviderEnvelope.set({ ...env });
      },
    });
  }

  /**
   * Try the patch; if the BFF answers `confirm-required` AND the caller
   * supplied a `confirm` flow, surface that flow's confirm dialog and on
   * user accept retry with `confirm: true`. On any other error (or a 412
   * with no confirm flow, which only narrowing callers hit, never in
   * practice) surface in `saveError`. Returns `true` only when the PATCH
   * (or the confirmed retry) actually persisted; `false` on validation
   * errors or on a 412 the user did not yet accept (callers like
   * `onReferencePathAdd` use this to keep the input value editable
   * instead of clearing it).
   *
   * The confirm dialog is parameterised per surface-expanding key: the
   * mechanism (try -> catch 412 -> dialog -> retry with `confirm: true`)
   * is shared, the dialog copy and the post-confirm side effect are not
   * (reference-paths enumerates the exposed paths and clears its input;
   * plugin-trust shows its own machine-local warning).
   */
  private async runPatch(
    key: string,
    patch: IProjectPreferencesPatchApi,
    confirm?: IConfirmFlow,
  ): Promise<boolean> {
    if (this.pending().has(key)) return false;
    const next = new Set(this.pending());
    next.add(key);
    this.pending.set(next);
    this.saveError.set(null);
    let success = false;
    try {
      const envelope = await this.dataSource.setProjectPreferences(patch);
      this.preferences.set(envelope);
      success = true;
    } catch (err) {
      if (
        err instanceof DataSourceError &&
        err.code === 'confirm-required' &&
        confirm
      ) {
        const exposed = (err as DataSourceError & { paths?: string[] }).paths ?? [];
        confirm.present(exposed, async () => {
          try {
            const envelope = await this.dataSource.setProjectPreferences({
              ...patch,
              confirm: true,
            });
            this.preferences.set(envelope);
            confirm.onConfirmed?.();
          } catch (innerErr) {
            this.saveError.set(formatErr(innerErr));
          }
        });
      } else {
        this.saveError.set(formatErr(err));
      }
    } finally {
      const after = new Set(this.pending());
      after.delete(key);
      this.pending.set(after);
    }
    return success;
  }

  /**
   * Confirm flow for `scan.referencePaths`: enumerate the exposed paths
   * in the dialog and clear the new-path input after a confirmed retry.
   */
  private referencePathsConfirmFlow(): IConfirmFlow {
    return {
      present: (exposed, onAccept) => this.confirmDialog(exposed, onAccept),
      onConfirmed: () => this.newReferencePath.set(''),
    };
  }

  /**
   * Confirm flow for `pluginTrust.projectEnabled`: a dedicated
   * machine-local trust warning (the exposed-paths list does not apply to
   * a code-execution surface, so it is ignored).
   */
  private pluginTrustConfirmFlow(): IConfirmFlow {
    return {
      present: (_exposed, onAccept) => this.confirmProjectTrustDialog(onAccept),
    };
  }

  /**
   * Dispatch a `.skillmapignore` patch. Simpler than `runPatch` (no
   * 412 / confirm-required branch, no existence check) because the
   * route narrows the scan surface by design. Returns `true` on a
   * successful persist so the caller can clear the input box.
   */
  private async runIgnorePatch(patch: IProjectIgnorePatchApi): Promise<boolean> {
    const key = 'ignore.patterns';
    if (this.pending().has(key)) return false;
    const next = new Set(this.pending());
    next.add(key);
    this.pending.set(next);
    this.ignoreSaveError.set(null);
    let success = false;
    try {
      const envelope = await this.dataSource.setProjectIgnore(patch);
      this.ignoreEnvelope.set(envelope);
      success = true;
    } catch (err) {
      this.ignoreSaveError.set(formatErr(err));
    } finally {
      const after = new Set(this.pending());
      after.delete(key);
      this.pending.set(after);
    }
    return success;
  }

  private confirmDialog(paths: string[], onAccept: () => Promise<void>): void {
    this.confirmation.confirm({
      header: SETTINGS_TEXTS.project.confirmDialogHeader,
      message:
        SETTINGS_TEXTS.project.confirmDialogIntro +
        '\n' +
        paths.map((p) => `• ${p}`).join('\n'),
      acceptLabel: SETTINGS_TEXTS.project.confirmDialogAccept,
      rejectLabel: SETTINGS_TEXTS.project.confirmDialogReject,
      acceptButtonProps: { severity: 'primary' },
      rejectButtonProps: { severity: 'secondary' },
      accept: () => {
        void onAccept();
      },
    });
  }

  private confirmProjectTrustDialog(onAccept: () => Promise<void>): void {
    this.confirmation.confirm({
      header: SETTINGS_TEXTS.project.pluginTrustConfirmHeader,
      message: SETTINGS_TEXTS.project.pluginTrustConfirmIntro,
      acceptLabel: SETTINGS_TEXTS.project.pluginTrustConfirmAccept,
      rejectLabel: SETTINGS_TEXTS.project.pluginTrustConfirmReject,
      acceptButtonProps: { severity: 'primary' },
      rejectButtonProps: { severity: 'secondary' },
      accept: () => {
        void onAccept();
      },
    });
  }
}

/**
 * Per-key confirm flow injected into `runPatch`. The 412 handling
 * mechanism is shared; this carries the surface-specific dialog
 * presentation and an optional post-confirm side effect.
 */
interface IConfirmFlow {
  /** Open the confirm dialog. `exposed` is the path list the 412 carried
   *  (empty for non-path surfaces); call `onAccept` on confirm. */
  present(exposed: string[], onAccept: () => Promise<void>): void;
  /** Ran after a confirmed retry persists (e.g. clear the input box). */
  onConfirmed?: () => void;
}

function formatErr(err: unknown): string {
  if (err instanceof DataSourceError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
