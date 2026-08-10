/**
 * `<sm-map-view-confirm-dialog>`, the dirty-switch gate of the map-view
 * switcher: asks Save / Discard / Cancel before leaving a view with
 * unsaved changes, with a don't-ask-again checkbox that persists
 * `ui.confirmViewSwitch: false` project-locally.
 *
 * Presentational, the structural mirror of
 * `<sm-ignore-confirm-dialog>`: driven by the `open` / `viewName`
 * inputs (derived from `MapViewsService.pendingSwitch`), reports
 * through the `decision` output as `{ action, always }`. Closing (X /
 * escape / mask) reports a cancel; the service dedupes the double-fire
 * structurally on the consumed intent. The service applies the
 * persistence and the switch; this component never touches the data
 * source.
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

import { MAP_VIEWS_TEXTS } from '../../../../i18n/map-views.texts';
import type { IMapViewSwitchDecision } from '../../../../services/map-views';

@Component({
  selector: 'sm-map-view-confirm-dialog',
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
      appendTo="body"
      [header]="texts.confirm.header"
      styleClass="sm-confirm-dialog"
      [attr.aria-label]="texts.confirm.ariaLabel"
      data-testid="map-view-confirm-dialog"
    >
      <p class="mv-confirm__body" data-testid="map-view-confirm-body">{{ bodyText() }}</p>

      <label class="mv-confirm__always" data-testid="map-view-confirm-always-row">
        <p-checkbox
          [(ngModel)]="always"
          [binary]="true"
          inputId="map-view-confirm-always"
          data-testid="map-view-confirm-always"
        />
        <span class="mv-confirm__always-text">
          <span class="mv-confirm__always-label">{{ texts.confirm.alwaysLabel }}</span>
          <span class="mv-confirm__always-hint">{{ texts.confirm.alwaysHint }}</span>
        </span>
      </label>

      <div class="mv-confirm__actions">
        <p-button
          [label]="texts.confirm.cancelButton"
          severity="secondary"
          [text]="true"
          (onClick)="cancel()"
          data-testid="map-view-confirm-cancel"
        />
        <p-button
          [label]="texts.confirm.discardButton"
          severity="secondary"
          [outlined]="true"
          (onClick)="discard()"
          data-testid="map-view-confirm-discard"
        />
        <p-button
          [label]="texts.confirm.saveButton"
          severity="primary"
          (onClick)="save()"
          data-testid="map-view-confirm-save"
        />
      </div>
    </p-dialog>
  `,
  styles: [
    `
      /* Dialog sizing rides the global .sm-confirm-dialog band in
         styles.css: appendTo="body" re-parents the dialog root outside
         this host's subtree, where :host ::ng-deep can never reach. */
      .mv-confirm__body { margin: 0 0 1rem; line-height: 1.5;
        color: var(--p-text-color); }
      .mv-confirm__always { display: flex; align-items: flex-start;
        gap: 0.6rem; cursor: pointer; margin-bottom: 1.25rem; }
      .mv-confirm__always-text { display: flex; flex-direction: column;
        gap: 0.2rem; }
      .mv-confirm__always-label { font-weight: 600;
        color: var(--p-text-color); }
      .mv-confirm__always-hint { font-size: var(--sm-fs-md);
        color: var(--p-text-muted-color); line-height: 1.4; }
      .mv-confirm__actions { display: flex; justify-content: flex-end;
        gap: 0.5rem; }
    `,
  ],
})
export class MapViewConfirmDialog {
  protected readonly texts = MAP_VIEWS_TEXTS;

  /** Drives the dialog visibility. Derived from `pendingSwitch`. */
  readonly open = input<boolean>(false);
  /** Display name of the dirty view the dialog is about. */
  readonly viewName = input<string | null>(null);

  /** Fired once per user choice (cancel may double-fire on close). */
  readonly decision = output<IMapViewSwitchDecision>();

  /** Two-way bound to the don't-ask-again checkbox. */
  protected readonly always = signal<boolean>(false);

  protected readonly bodyText = computed(() =>
    this.texts.confirm.body(this.viewName() ?? ''),
  );

  // Reset the checkbox every time the dialog (re)opens so a prior tick
  // does not leak into the next, unrelated, confirmation.
  private readonly resetOnOpen = effect(() => {
    if (this.open()) this.always.set(false);
  });

  protected save(): void {
    this.decision.emit({ action: 'save', always: this.always() });
  }

  protected discard(): void {
    this.decision.emit({ action: 'discard', always: this.always() });
  }

  protected cancel(): void {
    this.decision.emit({ action: 'cancel', always: false });
  }

  /**
   * Closing via the X / mask / escape resolves as a cancel. PrimeNG
   * fires `visibleChange(false)` for those paths; we only act on the
   * close (true is the open we already drove via the `open` input).
   */
  protected onVisibleChange(visible: boolean): void {
    if (!visible) this.cancel();
  }
}
