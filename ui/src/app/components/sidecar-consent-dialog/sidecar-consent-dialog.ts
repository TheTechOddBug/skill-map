/**
 * `<sm-sidecar-consent-dialog>`, the `.sm` write consent gate.
 *
 * A dedicated PrimeNG `<p-dialog>` that asks the user whether skill-map
 * may write companion `*.sm` files in this project. It carries an
 * "always allow" checkbox: unticked, the grant is one-shot (the caller
 * re-dispatches with `{ confirm: true }`); ticked, the project-wide
 * `allowEditSmFiles` flag is persisted (`{ confirm: true, always: true }`).
 *
 * The component is presentational: it owns no dispatch logic. It is
 * driven by the `open` input (a boolean signal flipped by the
 * `ActionDispatchService`) and reports the user's choice through the
 * `decision` output as `{ accepted, always }`. Closing the dialog
 * (X / escape / mask) reports `{ accepted: false, always: false }` so
 * the caller treats it as a decline (silent abandon).
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';

import { SIDECAR_CONSENT_DIALOG_TEXTS } from './sidecar-consent-dialog.texts';

/** The user's answer to the consent prompt. */
export interface ISidecarConsentDecision {
  /** True when the user chose to allow the write. */
  accepted: boolean;
  /**
   * True when the user ticked "always allow" before accepting. Only
   * meaningful when `accepted` is true; a decline always reports
   * `always: false`.
   */
  always: boolean;
}

@Component({
  selector: 'sm-sidecar-consent-dialog',
  imports: [FormsModule, ButtonModule, CheckboxModule, DialogModule],
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
      [header]="texts.header"
      [style]="{ width: '32rem' }"
      [attr.aria-label]="texts.ariaLabel"
      data-testid="sidecar-consent-dialog"
    >
      <p class="consent__body" data-testid="sidecar-consent-body">{{ texts.body }}</p>

      <label class="consent__always" data-testid="sidecar-consent-always-row">
        <p-checkbox
          [(ngModel)]="always"
          [binary]="true"
          inputId="sidecar-consent-always"
          data-testid="sidecar-consent-always"
        />
        <span class="consent__always-text">
          <span class="consent__always-label">{{ texts.alwaysLabel }}</span>
          <span class="consent__always-hint">{{ texts.alwaysHint }}</span>
        </span>
      </label>

      <div class="consent__actions">
        <p-button
          [label]="texts.reject"
          severity="secondary"
          [text]="true"
          (onClick)="decline()"
          data-testid="sidecar-consent-reject"
        />
        <p-button
          [label]="texts.accept"
          severity="primary"
          (onClick)="accept()"
          data-testid="sidecar-consent-accept"
        />
      </div>
    </p-dialog>
  `,
  styles: [`
    .consent__body { margin: 0 0 1rem; line-height: 1.5;
      color: var(--p-text-color); }
    .consent__always { display: flex; align-items: flex-start; gap: 0.6rem;
      cursor: pointer; margin-bottom: 1.25rem; }
    .consent__always-text { display: flex; flex-direction: column; gap: 0.2rem; }
    .consent__always-label { font-weight: 600; color: var(--p-text-color); }
    .consent__always-hint { font-size: 0.85rem;
      color: var(--p-text-muted-color); line-height: 1.4; }
    .consent__actions { display: flex; justify-content: flex-end;
      gap: 0.5rem; }
  `],
})
export class SidecarConsentDialog {
  protected readonly texts = SIDECAR_CONSENT_DIALOG_TEXTS;

  /** Drives the dialog visibility. Flipped by the dispatch service. */
  readonly open = input<boolean>(false);

  /** Fired once per resolution with the user's choice. */
  readonly decision = output<ISidecarConsentDecision>();

  /** Two-way bound to the "always allow" checkbox. */
  protected readonly always = signal<boolean>(false);

  /** Convenience for tests / template. */
  protected readonly alwaysChecked = computed(() => this.always());

  // Reset the checkbox every time the dialog (re)opens so a prior tick
  // does not leak into the next, unrelated, consent prompt.
  private readonly resetOnOpen = effect(() => {
    if (this.open()) this.always.set(false);
  });

  protected accept(): void {
    this.decision.emit({ accepted: true, always: this.always() });
  }

  protected decline(): void {
    this.decision.emit({ accepted: false, always: false });
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
