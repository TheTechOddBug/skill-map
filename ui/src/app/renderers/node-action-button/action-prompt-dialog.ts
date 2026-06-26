/**
 * `<sm-action-prompt-dialog>`, the parametrized-action input prompt.
 *
 * A dedicated standalone component that owns the heavy PrimeNG widgets
 * for the prompt flow, `<p-dialog>` plus the `<sm-input-type-control>`
 * (which itself pulls Select / AutoComplete). NodeActionButton mounts it
 * behind a `@defer` so those modules are code-split into a lazy chunk:
 * direct-dispatch buttons (the common case, e.g. bump) never pay for
 * them, matching how `settings-modal` keeps Dialog out of the initial
 * bundle.
 *
 * Presentational: it owns no dispatch logic. The host drives `open` and
 * passes the prompt `descriptor`; the component reports the user's
 * choice through `confirmed` (carrying the collected value) or `closed`
 * (cancel / X / mask). The host folds the value into the dispatch body.
 *
 * LINT (renderer attr-sanitization): no `[innerHTML]` / `[style]` from
 * data. `[style]` on `<p-dialog>` is a static literal (dialog width),
 * not bound from payload.
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
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';

import {
  InputTypeControl,
  type IInputTypeDescriptor,
  type TInputTypeValue,
} from '../input-type-control/input-type-control';
import { ACTION_PROMPT_DIALOG_TEXTS } from '../../../i18n/action-prompt-dialog.texts';

@Component({
  selector: 'sm-action-prompt-dialog',
  imports: [ButtonModule, DialogModule, InputTypeControl],
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
      [header]="header()"
      [style]="{ width: '28rem' }"
      [attr.aria-label]="texts.ariaLabel"
      data-testid="action-prompt-dialog"
    >
      <sm-input-type-control
        [descriptor]="descriptor()"
        [(value)]="collected"
        data-testid="action-prompt-control"
      />

      <div class="apd__actions">
        <p-button
          [label]="texts.cancel"
          severity="secondary"
          [text]="true"
          (onClick)="cancel()"
          data-testid="action-prompt-cancel"
        />
        <p-button
          [label]="texts.confirm"
          severity="primary"
          [disabled]="busy()"
          (onClick)="confirm()"
          data-testid="action-prompt-confirm"
        />
      </div>
    </p-dialog>
  `,
  styles: [`
    .apd__actions { display: flex; justify-content: flex-end;
      gap: 0.5rem; margin-top: 1.25rem; }
  `],
})
export class ActionPromptDialog {
  protected readonly texts = ACTION_PROMPT_DIALOG_TEXTS;

  /** Drives the dialog visibility. Flipped by the host on click. */
  readonly open = input<boolean>(false);
  /** The input-type descriptor handed to the inner control. */
  readonly descriptor = input.required<IInputTypeDescriptor>();
  /** Optional header; falls back to a generic prompt title. */
  readonly headerText = input<string | undefined>(undefined);
  /** Disables Confirm while the host has a dispatch in flight. */
  readonly busy = input<boolean>(false);

  /** Fired on Confirm with the value the control collected. */
  readonly confirmed = output<TInputTypeValue>();
  /** Fired on Cancel / X / mask close (no dispatch). */
  readonly closed = output<void>();

  /** Value gathered by the input-type control while open. */
  protected readonly collected = signal<TInputTypeValue>('');

  protected readonly header = computed<string>(
    () => this.headerText() ?? this.texts.fallbackHeader,
  );

  // Seed the collected value every time the dialog (re)opens so a prior
  // entry does not leak into the next prompt. When the descriptor carries
  // a `defaultValue` (e.g. the node's current stability / tags), the
  // control opens pre-filled with it; otherwise it falls back to the
  // empty seed (`string-list` an empty array, scalar types an empty
  // string). The seed is always normalised to the input-type shape so a
  // scalar default never lands on a list control and vice-versa.
  private readonly seedOnOpen = effect(() => {
    if (this.open()) {
      this.collected.set(this.seedValue());
    }
  });

  /** The value the control is seeded with when the dialog opens. */
  protected seedValue(): TInputTypeValue {
    const d = this.descriptor();
    const isList = d.inputType === 'string-list';
    const dv = d.defaultValue;
    if (isList) {
      // List control: accept an array default, ignore a stray scalar.
      return Array.isArray(dv) ? dv.slice() : [];
    }
    // Scalar control: accept a string default, ignore a stray array.
    return typeof dv === 'string' ? dv : '';
  }

  protected confirm(): void {
    this.confirmed.emit(this.collected());
  }

  protected cancel(): void {
    this.closed.emit();
  }

  /**
   * PrimeNG fires `visibleChange(false)` on X / mask / escape; treat
   * those like Cancel. The `true` transition is the open the host
   * already drove via the `open` input, so it needs no handling.
   */
  protected onVisibleChange(visible: boolean): void {
    if (!visible) this.closed.emit();
  }
}
