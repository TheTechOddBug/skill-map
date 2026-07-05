/**
 * `<sm-settings-project-lens>`, active-provider lens row + live-activity
 * hook row of the Settings > Project section.
 *
 * The two rows live in ONE child on purpose: the hook status is keyed
 * to the ACTIVE lens (`GET /api/activity/install?provider=<lens>`), so
 * every lens envelope refresh and every confirmed lens switch must
 * re-probe the hook, and splitting them would force that dependency
 * through the chassis.
 *
 * Lifecycle mirrors the sibling children: fetch on `(visible) === true`,
 * render, dispatch via the data-source port. Owns its own
 * `ConfirmationService` + `<p-confirmdialog>` (lens-switch warning and
 * hook install / uninstall consent).
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
import { MessageModule } from 'primeng/message';
import { Select, SelectModule } from 'primeng/select';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import type {
  IActiveProviderApi,
  IActivityInstallStatusApi,
} from '../../../models/api';
import { DATA_SOURCE, DataSourceError } from '../../../services/data-source/data-source.port';
import { ProviderRegistryService } from '../../../services/provider-registry';
import { formatErr } from './settings-project.utils';

@Component({
  selector: 'sm-settings-project-lens',
  imports: [FormsModule, ButtonModule, ConfirmDialogModule, MessageModule, SelectModule],
  providers: [ConfirmationService],
  templateUrl: './settings-project-lens.html',
  styleUrl: './settings-project-rows.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProjectLens {
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

  // ---- active-provider state -------------------------------------------
  protected readonly activeProviderEnvelope = signal<IActiveProviderApi | null>(null);
  protected readonly activeProviderLoadError = signal<string | null>(null);
  protected readonly activeProviderSaveError = signal<string | null>(null);
  protected readonly activeProviderSwitchAnnouncement = signal<string | null>(null);

  /**
   * Options consumed by `<p-select>`. Only LENS Providers (`isLens:
   * true`) are listed: the non-gated `markdown` base is the universal
   * substrate, not a pickable lens, so it is filtered out entirely
   * (never even a greyed row). Among the lenses, each one absent from
   * the envelope's `selectable` set (the ids enabled right now) is
   * rendered disabled: greyed and not selectable (`optionDisabled` in
   * the template) plus a "(disabled)" suffix, so it stays visible but
   * can never be chosen. This covers both operator-disabled lenses and
   * the experimental ones that ship disabled by default. Before the
   * envelope loads (`selectable === null`) nothing is greyed, to avoid
   * a flash of all-disabled rows.
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
  /** Pending keys ('activity.hook' only in this child). */
  protected readonly pending = signal<Set<string>>(new Set());

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

  constructor() {
    effect(() => {
      if (this.visible()) void this.refreshActiveProvider();
    });

    // Close the provider dropdown when the section / dialog closes. The
    // panel is `appendTo="body"` so it outlives a still-mounted trigger;
    // without this an open dropdown orphans on `<body>` after the modal
    // hides. `hide()` is a no-op when the overlay is already closed.
    effect(() => {
      if (!this.visible()) this.providerSelect()?.hide();
    });
  }

  // -----------------------------------------------------------------
  // Active-provider handlers
  // -----------------------------------------------------------------

  /**
   * Triggered by the `<p-select>`'s change. Opens the confirm dialog
   * because switching the lens is destructive of the scan_* DB zone
   * (see spec/architecture.md §Active Provider Lens). On accept, calls
   * the data-source; on reject, reverts the dropdown to the previous
   * value by re-emitting the envelope.
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
}
