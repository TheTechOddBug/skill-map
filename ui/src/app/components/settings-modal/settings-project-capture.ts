/**
 * `<sm-settings-project-capture>`, conversation-capture toggle row of
 * the Settings > Project section (spec/provider-activity.md
 * §Conversation capture).
 *
 * Consent is settled client-side: both directions run through the
 * ConfirmationService dialog (consent-worded on enable, "clears
 * immediately" on disable) and the POST that follows ALWAYS carries
 * `confirm: true`, so the server's 412 `confirm-required` path never
 * fires from this surface. On dismiss the toggle snaps back because
 * the envelope is re-emitted unchanged.
 *
 * Lifecycle mirrors the sibling children: fetch on `(visible) === true`.
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
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageModule } from 'primeng/message';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import type { IActivityCaptureStatusApi } from '../../../models/api';
import { DATA_SOURCE } from '../../../services/data-source/data-source.port';
import { formatErr } from './settings-project.utils';

@Component({
  selector: 'sm-settings-project-capture',
  imports: [FormsModule, ConfirmDialogModule, MessageModule, ToggleSwitchModule],
  providers: [ConfirmationService],
  templateUrl: './settings-project-capture.html',
  styleUrl: './settings-project-rows.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProjectCapture {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly confirmation = inject(ConfirmationService);

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

  constructor() {
    effect(() => {
      if (this.visible()) void this.refreshCapture();
    });
  }

  protected isPending(key: string): boolean {
    return this.pending().has(key);
  }

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
