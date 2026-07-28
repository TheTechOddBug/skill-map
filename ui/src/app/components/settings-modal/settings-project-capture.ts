/**
 * `<sm-settings-project-capture>`, conversation-capture toggle row of
 * the Settings > Project section (spec/provider-activity.md
 * §Conversation capture).
 *
 * Consent is settled client-side: both directions run through the
 * ConfirmationService dialog (consent-worded on enable, "clears
 * immediately" on disable) and the POST that follows ALWAYS carries
 * `confirm: true`, so the server's 412 `confirm-required` path never
 * fires from this surface. The switch binds a `linkedSignal` view of
 * the envelope: on dismiss (or a failed write) it is reset to the
 * committed value, which rolls the control back (re-emitting an
 * unchanged envelope would not, computeds do not notify on equal
 * values).
 *
 * Subordinate to ONE gate: the active lens's activity hook (installed by
 * the `<sm-settings-project-hook>` row above). Without it no activity
 * event reaches skill-map, so capturing conversations records nothing;
 * known-missing therefore disables ENABLING the gate (turning it OFF
 * stays available, so a capture left on can always be stopped), and
 * `null` = unknown FAILS OPEN, matching the sibling real-time row.
 *
 * Lifecycle mirrors the sibling children: fetch on `(visible) === true`
 * (which also re-probes the shared hook-install state).
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageModule } from 'primeng/message';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import type { IActivityCaptureStatusApi } from '../../../models/api';
import { DATA_SOURCE } from '../../../services/data-source/data-source.port';
import { ActivityReadinessService } from '../../services/activity-readiness';
import { ToggleRowDirective } from './toggle-row.directive';
import { formatErr } from './settings-project.utils';

@Component({
  selector: 'sm-settings-project-capture',
  imports: [FormsModule, ConfirmDialogModule, MessageModule, ToggleRowDirective, ToggleSwitchModule],
  providers: [ConfirmationService],
  templateUrl: './settings-project-capture.html',
  styleUrl: './settings-project-rows.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProjectCapture {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly confirmation = inject(ConfirmationService);
  private readonly activityReadiness = inject(ActivityReadinessService);

  readonly visible = input.required<boolean>();

  protected readonly texts = SETTINGS_TEXTS;

  /**
   * Capture gate envelope (`GET /api/activity/capture`), re-fetched on
   * every section open. `null` while unknown (probe pending or failed);
   * the toggle disables then, a write against an unknown baseline
   * would race the server state.
   */
  protected readonly captureStatus = signal<IActivityCaptureStatusApi | null>(null);
  protected readonly captureError = signal<string | null>(null);
  /** Pending keys ('activity.capture' only in this child). */
  protected readonly pending = signal<Set<string>>(new Set());

  protected readonly captureEnabled = computed<boolean>(() => {
    return this.captureStatus()?.enabled ?? false;
  });

  /**
   * View state the switch binds to: tracks the committed value, set
   * optimistically on toggle, explicitly reset on dismiss / failed
   * write so the control rolls back (see class doc).
   */
  protected readonly captureEnabledView = linkedSignal(() => this.captureEnabled());

  /**
   * Whether the ACTIVE lens's live-activity hook is installed. Owned by
   * the shared `ActivityReadinessService` (same signal as the sibling
   * real-time row), re-probed on every section open so a hook installed
   * from the row above (or the CLI) reflects here without a reload.
   */
  protected readonly activityHookInstalled = this.activityReadiness.hookInstalled;

  /** Known-missing hook: capturing would record nothing. `null` fails open. */
  protected readonly captureBlocked = computed<boolean>(
    () => this.activityHookInstalled() === false,
  );

  /**
   * The switch locks while the gate state is unknown or a write is in
   * flight, and while the hook is missing it locks only in the ENABLE
   * direction, an already-capturing project can always be turned off.
   */
  protected readonly captureToggleDisabled = computed<boolean>(
    () =>
      this.captureStatus() === null ||
      this.isPending('activity.capture') ||
      (!this.captureEnabled() && this.captureBlocked()),
  );

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      void this.refreshCapture();
      void this.activityReadiness.refresh();
    });
  }

  protected isPending(key: string): boolean {
    return this.pending().has(key);
  }

  protected onCaptureToggle(next: boolean): void {
    if (next === this.captureEnabled()) return;
    this.captureEnabledView.set(next);
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
        this.captureEnabledView.set(this.captureEnabled());
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
      this.captureEnabledView.set(this.captureEnabled());
    } finally {
      const after = new Set(this.pending());
      after.delete(key);
      this.pending.set(after);
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
}
