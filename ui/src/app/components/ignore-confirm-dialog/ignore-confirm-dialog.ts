/**
 * `<sm-ignore-confirm-dialog>`, the confirmation gate of the Ignore
 * buttons (files rail rows, inspector header): asks before a pattern
 * is appended to the project-root `.skillmapignore`, with a
 * don't-ask-again checkbox that persists `ui.confirmIgnore: false`
 * project-locally.
 *
 * Presentational, the structural mirror of
 * `<sm-sidecar-consent-dialog>`: driven by the `open` / `target`
 * inputs (signals owned by `ProjectIgnoreService`, mounted once in the
 * app shell like the crash-report dialog), reports through the
 * `decision` output as `{ accepted, always }`. Closing (X / escape /
 * mask) reports a decline. The service applies the persistence and the
 * write; this component never touches the data source.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';

import { IGNORE_CONFIRM_DIALOG_TEXTS } from '../../../i18n/ignore-confirm-dialog.texts';
import type {
  IIgnoreConfirmDecision,
  IIgnoreTarget,
} from '../../../services/project-ignore';
import { UsageTrackerService } from '../../services/usage-tracker';

@Component({
  selector: 'sm-ignore-confirm-dialog',
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
      [header]="headerText()"
      styleClass="sm-confirm-dialog"
      [attr.aria-label]="texts.ariaLabel"
      data-testid="ignore-confirm-dialog"
    >
      <p class="ignore-confirm__body" data-testid="ignore-confirm-body">{{ bodyText() }}</p>
      <p class="ignore-confirm__pattern-line">
        <code class="ignore-confirm__pattern" data-testid="ignore-confirm-pattern">{{
          target()?.pattern
        }}</code>
      </p>
      <p class="ignore-confirm__hint">{{ texts.reAddHint }}</p>

      <label class="ignore-confirm__always" data-testid="ignore-confirm-always-row">
        <p-checkbox
          [(ngModel)]="always"
          [binary]="true"
          inputId="ignore-confirm-always"
          data-testid="ignore-confirm-always"
        />
        <span class="ignore-confirm__always-text">
          <span class="ignore-confirm__always-label">{{ texts.alwaysLabel }}</span>
          <span class="ignore-confirm__always-hint">{{ texts.alwaysHint }}</span>
        </span>
      </label>

      <div class="ignore-confirm__actions">
        <p-button
          [label]="texts.cancel"
          severity="secondary"
          [text]="true"
          (onClick)="decline()"
          data-testid="ignore-confirm-cancel"
        />
        <p-button
          [label]="texts.confirm"
          severity="primary"
          (onClick)="accept()"
          data-testid="ignore-confirm-accept"
        />
      </div>
    </p-dialog>
  `,
  styles: [
    `
      /* Dialog sizing rides the global .sm-confirm-dialog band in
         styles.css: appendTo="body" re-parents the dialog root outside
         this host's subtree, where :host ::ng-deep can never reach. */
      .ignore-confirm__body { margin: 0 0 0.75rem; line-height: 1.5;
        color: var(--p-text-color); }
      .ignore-confirm__pattern-line { margin: 0 0 0.75rem; }
      .ignore-confirm__pattern { font-family: var(--sm-font-mono);
        font-size: var(--sm-fs-sm); background: var(--sm-bg-hover);
        border-radius: var(--sm-radius-sm); padding: 0.15rem 0.4rem; }
      .ignore-confirm__hint { margin: 0 0 1rem; font-size: var(--sm-fs-md);
        color: var(--p-text-muted-color); line-height: 1.4; }
      .ignore-confirm__always { display: flex; align-items: flex-start;
        gap: 0.6rem; cursor: pointer; margin-bottom: 1.25rem; }
      .ignore-confirm__always-text { display: flex; flex-direction: column;
        gap: 0.2rem; }
      .ignore-confirm__always-label { font-weight: 600;
        color: var(--p-text-color); }
      .ignore-confirm__always-hint { font-size: var(--sm-fs-md);
        color: var(--p-text-muted-color); line-height: 1.4; }
      .ignore-confirm__actions { display: flex; justify-content: flex-end;
        gap: 0.5rem; }
    `,
  ],
})
export class IgnoreConfirmDialog {
  private readonly usageTracker = inject(UsageTrackerService);
  protected readonly texts = IGNORE_CONFIRM_DIALOG_TEXTS;

  /** Drives the dialog visibility. Flipped by `ProjectIgnoreService`. */
  readonly open = input<boolean>(false);
  /** What the showing is about: path, kind, source, appended pattern. */
  readonly target = input<IIgnoreTarget | null>(null);

  /** Fired once per resolution with the user's choice. */
  readonly decision = output<IIgnoreConfirmDecision>();

  /** Two-way bound to the don't-ask-again checkbox. */
  protected readonly always = signal<boolean>(false);

  protected readonly headerText = computed(() =>
    this.target()?.kind === 'folder' ? this.texts.headerFolder : this.texts.headerFile,
  );

  protected readonly bodyText = computed(() =>
    this.target()?.kind === 'folder' ? this.texts.bodyFolder : this.texts.bodyFile,
  );

  /**
   * Usage-telemetry guard: one `ignore-path` event per dialog showing.
   * The decline path can fire twice (explicit button, then the
   * close-driven `visibleChange(false)`), and the `decision` output must
   * keep that behaviour for its consumer (the service dedupes
   * structurally); only the telemetry dedupes here.
   */
  private decided = false;

  // Reset the checkbox every time the dialog (re)opens so a prior tick
  // does not leak into the next, unrelated, confirmation.
  private readonly resetOnOpen = effect(() => {
    if (this.open()) {
      this.always.set(false);
      this.decided = false;
    }
  });

  protected accept(): void {
    this.trackDecision(this.always() ? 'always' : 'once');
    this.decision.emit({ accepted: true, always: this.always() });
  }

  protected decline(): void {
    this.trackDecision('declined');
    this.decision.emit({ accepted: false, always: false });
  }

  /** One `ui.feature.ignore-path` per showing, source-stamped. */
  private trackDecision(value: 'always' | 'once' | 'declined'): void {
    if (this.decided) return;
    this.decided = true;
    this.usageTracker.trackFeature('ignore-path', value, this.target()?.source);
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
