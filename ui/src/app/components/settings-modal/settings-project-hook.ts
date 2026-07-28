/**
 * `<sm-settings-project-hook>`, the real-time hook install row of the
 * Settings > Project section ("live-activity hook" in spec terms, see
 * spec/provider-activity.md §Install management over HTTP; the UI
 * label says "Real-time hook" to match the Real-time node activity
 * row it unlocks).
 *
 * One button, two operations: Install when the hook is absent,
 * Uninstall when present, disabled + hint for lenses without an
 * activity adapter. Both mutations first POST WITHOUT `confirm`; the
 * BFF refuses 412 `confirm-required` (server-enforced consent, nothing
 * written), which surfaces the consent dialog naming the exact config
 * file; accepting retries with `confirm: true`. Success adopts the
 * refreshed status envelope from the response and re-probes the shared
 * `ActivityReadinessService`, so the topbar Real Time toggle and the
 * real-time row unlock without a section reopen.
 *
 * Extracted from `settings-project-lens` so the section's rows can be
 * ordered freely (the live-channel rows sit between the lens select
 * and this row). The coupling to the ACTIVE lens survives as the
 * `lensId` input: the chassis feeds it from the lens child's envelope,
 * so a section open or a confirmed lens switch re-probes the status
 * for the CURRENT lens declaratively (the probe effect tracks both
 * `visible` and `lensId`).
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageModule } from 'primeng/message';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import type { IActivityInstallStatusApi } from '../../../models/api';
import { DATA_SOURCE } from '../../../services/data-source/data-source.port';
import { ProviderRegistryService } from '../../../services/provider-registry';
import { ActivityReadinessService } from '../../services/activity-readiness';
import { runConfirmGated } from '../confirm-gated';
import { formatErr } from './settings-project.utils';

@Component({
  selector: 'sm-settings-project-hook',
  imports: [ButtonModule, ConfirmDialogModule, MessageModule],
  providers: [ConfirmationService],
  templateUrl: './settings-project-hook.html',
  styleUrl: './settings-project-rows.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProjectHook {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly confirmation = inject(ConfirmationService);
  private readonly providerRegistry = inject(ProviderRegistryService);
  private readonly activityReadiness = inject(ActivityReadinessService);

  readonly visible = input.required<boolean>();
  /**
   * Active lens id, fed by the chassis from the lens child's envelope
   * (`null` until it loads, `''` for "none"). Every change re-probes
   * the install status so the button always describes the CURRENT
   * lens.
   */
  readonly lensId = input.required<string | null>();

  protected readonly texts = SETTINGS_TEXTS;

  /**
   * Install status of the ACTIVE lens's live-activity hook
   * (`GET /api/activity/install`). `null` until the probe resolves (or
   * when it failed); re-probed whenever the section opens or the lens
   * changes.
   */
  protected readonly activityStatus = signal<IActivityInstallStatusApi | null>(null);
  protected readonly activityError = signal<string | null>(null);
  protected readonly activityAnnouncement = signal<string | null>(null);
  /** Pending keys ('activity.hook' only in this child). */
  protected readonly pending = signal<Set<string>>(new Set());

  /** Registry label of the active lens (falls back to the raw id). */
  private readonly activeLensLabel = computed<string>(() => {
    const id = this.lensId() ?? '';
    const entry = this.providerRegistry.providers().find((p) => p.id === id);
    return entry?.label ?? id;
  });

  /**
   * Install is the row's constructive action (primary, filled);
   * Uninstall is the reversal (secondary, outlined). Mirrors the
   * Trust / Untrust pair in Settings > Plugins.
   */
  protected readonly activityButtonInstalled = computed<boolean>(() => {
    return this.activityStatus()?.installed === true;
  });

  /**
   * Button label, tracking the selected lens AND the install state:
   * "Install <lens label> hook" / "Uninstall <lens label> hook". While
   * the status is unknown the Install form shows (the button is
   * disabled anyway).
   */
  protected readonly activityButtonLabel = computed<string>(() => {
    const t = this.texts.project.activityHook;
    const action =
      this.activityStatus()?.installed === true ? t.uninstallPrefix : t.installPrefix;
    return `${action} ${this.activeLensLabel()} ${t.labelSuffix}`;
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
    // Probe on section open and on every lens change while open. The
    // lens child re-fetches its envelope on open, so a confirmed lens
    // switch (or a plain reopen) lands here as a `lensId` emission.
    effect(() => {
      const id = this.lensId();
      if (!this.visible() || id === null) return;
      void this.refreshActivityStatus(id);
    });
  }

  protected onActivityHookToggle(): void {
    const status = this.activityStatus();
    if (status === null || !status.supported) return;
    void this.runActivityMutation(status.installed ? 'uninstall' : 'install');
  }

  /**
   * One mutation attempt through the shared `runConfirmGated` runner
   * (`components/confirm-gated.ts`): POST without `confirm`, surface the
   * consent dialog on the BFF's 412, retry with `confirm: true` on
   * accept, settle quietly on dismiss; any other failure (and a failed
   * retry) formats into `activityError`.
   */
  private async runActivityMutation(op: 'install' | 'uninstall'): Promise<void> {
    const key = 'activity.hook';
    if (this.pending().has(key)) return;
    const providerId = this.lensId() ?? '';
    const next = new Set(this.pending());
    next.add(key);
    this.pending.set(next);
    this.activityError.set(null);
    this.activityAnnouncement.set(null);
    try {
      await runConfirmGated({
        attempt: (confirm) => this.dispatchActivity(op, providerId, confirm),
        confirm: () =>
          new Promise<boolean>((resolve) => {
            this.confirmActivityDialog(op, () => resolve(true), () => resolve(false));
            // Busy contract of this row (pre-dating the shared runner):
            // the pending key releases once the consent dialog is up, so
            // the accepted retry runs unpended; the modal dialog overlay
            // guards re-entry while it shows. The `finally` release below
            // is then a no-op on this path.
            this.releasePending(key);
          }),
        onError: (err) => this.activityError.set(formatErr(err)),
      });
    } finally {
      this.releasePending(key);
    }
  }

  private releasePending(key: string): void {
    const after = new Set(this.pending());
    after.delete(key);
    this.pending.set(after);
  }

  /**
   * Fire one install/uninstall POST and adopt its response envelope.
   * Also re-probes the shared readiness signal so the topbar Real Time
   * toggle and the real-time row react without a section reopen.
   */
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
      // The touched path is not repeated here: the consent dialog the
      // user just accepted named it. The CLI name is: several lenses
      // may pass through this row in one session.
      this.activityAnnouncement.set(t.installed(this.activeLensLabel()));
    } else {
      const envelope = await this.dataSource.uninstallActivityHook(providerId, opts);
      this.activityStatus.set(envelope);
      this.activityAnnouncement.set(
        envelope.removed ? t.uninstalled(this.activeLensLabel()) : t.nothingToUninstall,
      );
    }
    void this.activityReadiness.refresh();
  }

  private confirmActivityDialog(
    op: 'install' | 'uninstall',
    onAccept: () => void,
    onReject: () => void,
  ): void {
    const t = this.texts.project.activityHook;
    // Display the harness file's NAME, not its full path: the operator
    // recognises "settings.json" / "hooks.json" as their CLI's file,
    // and opencode's deep plugin path read as noise in the dialog.
    const configFile = (this.activityStatus()?.configPath ?? '').split('/').pop() ?? '';
    const header = op === 'install' ? t.installConfirmHeader : t.uninstallConfirmHeader;
    const intro =
      op === 'install'
        ? `${t.installConfirmIntroPrefix} ${configFile} ${t.installConfirmIntroSuffix}`
        : `${t.uninstallConfirmIntroPrefix} ${configFile} ${t.uninstallConfirmIntroSuffix}`;
    this.confirmation.confirm({
      header,
      message: intro,
      acceptLabel: t.confirmAccept,
      rejectLabel: t.confirmReject,
      acceptButtonProps: { severity: 'primary' },
      rejectButtonProps: { severity: 'secondary' },
      accept: () => {
        onAccept();
      },
      // Only settles the shared runner quietly; a dismissed dialog
      // performs no retry (same visible outcome as before the runner,
      // when no reject callback was wired at all).
      reject: () => {
        onReject();
      },
    });
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
}
