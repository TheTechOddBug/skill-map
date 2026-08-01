/**
 * `<sm-crash-report-dialog>`, the per-incident crash-report consent dialog
 * (`spec/telemetry.md` §Per-incident crash-report consent).
 *
 * Presentational, mirroring `<sm-sidecar-consent-dialog>`: driven by the
 * `open` input (flipped by `CrashReportConsentService`), reports the
 * user's choice through the `decision` output (`true` = send). Closing the
 * dialog (X / escape / mask) reports a decline; nothing is ever persisted.
 * Send renders as the primary action (spec rule 2: flat Yes default); the
 * explicit dismiss always wins.
 */

import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';

import { CRASH_REPORT_DIALOG_TEXTS } from '../../../i18n/crash-report-dialog.texts';
import { A11yAnnouncerService } from '../../services/a11y-announcer';

@Component({
  selector: 'sm-crash-report-dialog',
  imports: [ButtonModule, DialogModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [visible]="open()"
      (visibleChange)="onVisibleChange($event)"
      [modal]="true"
      [closable]="true"
      [draggable]="false"
      [resizable]="false"
      [dismissableMask]="true"
      appendTo="body"
      [header]="texts.header"
      styleClass="crash-report__dialog"
      [attr.aria-label]="texts.ariaLabel"
      data-testid="crash-report-dialog"
    >
      <p class="crash__body" data-testid="crash-report-body">{{ texts.body }}</p>

      @if (preview() !== '') {
        <div class="crash__preview" data-testid="crash-report-preview">
          <span class="crash__preview-label">{{ texts.previewLabel }}</span>
          <code class="crash__preview-text">{{ preview() }}</code>
        </div>
      }

      <div class="crash__actions">
        <p-button
          [label]="texts.dismiss"
          severity="secondary"
          [text]="true"
          (onClick)="decline()"
          data-testid="crash-report-dismiss"
        />
        <p-button
          [label]="texts.send"
          severity="primary"
          (onClick)="accept()"
          data-testid="crash-report-send"
        />
      </div>
    </p-dialog>
  `,
  styles: [`
    /* PrimeNG injects [styleClass] on the portal-rendered dialog root
       (outside view encapsulation, hence the deep reach). Same sizing
       pattern as the sidecar-consent dialog. */
    :host ::ng-deep .crash-report__dialog { width: 34rem; max-width: 92vw; }
    .crash__body { margin: 0 0 1rem; line-height: 1.5;
      color: var(--p-text-color); }
    .crash__preview { display: flex; flex-direction: column; gap: 0.35rem;
      margin-bottom: 1.25rem; }
    .crash__preview-label { font-weight: 600; font-size: var(--sm-fs-md);
      color: var(--p-text-muted-color); }
    .crash__preview-text { font-size: var(--sm-fs-md); line-height: 1.4;
      color: var(--p-text-color); background: var(--p-content-hover-background);
      border-radius: 6px; padding: 0.5rem 0.65rem; overflow-wrap: anywhere; }
    .crash__actions { display: flex; justify-content: flex-end;
      gap: 0.5rem; }
  `],
})
export class CrashReportDialog {
  protected readonly texts = CRASH_REPORT_DIALOG_TEXTS;

  private readonly announcer = inject(A11yAnnouncerService);

  /** Drives the dialog visibility. Flipped by the consent service. */
  readonly open = input<boolean>(false);

  /** Scrubbed one-line summary of the error, shown in the preview block. */
  readonly preview = input<string>('');

  /** `true` = send this one report, `false` = drop it. */
  readonly decision = output<boolean>();

  // Assertive announcement when the dialog opens: the error itself was
  // silent for a screen-reader user (it only hit the console).
  private readonly announceOnOpen = effect(() => {
    if (this.open()) this.announcer.announce(this.texts.announce, 'assertive');
  });

  protected accept(): void {
    this.decision.emit(true);
  }

  protected decline(): void {
    this.decision.emit(false);
  }

  /**
   * Closing via the X / mask / escape resolves as a decline. PrimeNG
   * fires `visibleChange(false)` for those paths; we only act on the
   * close (true is the open we already drove via the `open` input).
   */
  protected onVisibleChange(visible: boolean): void {
    if (!visible) this.decline();
  }
}
