import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import type { IRendererInputs } from '../../slots/slot-renderer-map';
import { ActionDispatchService } from '../../../services/action-dispatch';
import { ActionPromptDialog } from './action-prompt-dialog';
import type { IInputTypeDescriptor } from '../input-type-control/input-type-control';
import type { TInputTypeValue } from '../input-type-control/input-type-control';
import { NODE_ACTION_BUTTON_TEXTS } from './node-action-button.texts';

/**
 * Renderer for the `inspector.action.button` slot. Draws a `<p-button>`
 * from the contribution payload and, on click, dispatches the named
 * kernel Action against the node via `ActionDispatchService`.
 *
 * Payload shape (`view-slots.schema.json#/$defs/payloads.inspector.action.button`):
 *   `{ actionId, label, icon?, severity?, enabled, disabledReason?,
 *      input?, prompt? }`
 *
 * Two click flows:
 *
 *   - NO `prompt`: direct dispatch. The click calls the action with the
 *     static `payload.input` (if any), the Phase 1 behaviour, unchanged.
 *   - WITH `prompt`: parametrized dispatch. The click opens the
 *     `<sm-action-prompt-dialog>` (hosting `<sm-input-type-control>`
 *     for the declared `inputType`). On Confirm, the collected value is
 *     folded into the dispatch body under `{ [prompt.paramKey]: value }`,
 *     merged over any static `input`. On Cancel the dialog closes
 *     without dispatching.
 *
 * The prompt dialog is mounted behind a `@defer` (matching the
 * settings-modal pattern) so its heavy PrimeNG widgets (Dialog + Select
 * + AutoComplete, pulled in by the prompt dialog component) are
 * code-split into a lazy chunk. Direct-dispatch buttons never pay for
 * them: this renderer lives in the eager `SLOT_RENDERERS` map, so any
 * non-deferred import here would land in the initial bundle.
 *
 * The button is ALWAYS emitted; its `enabled` flag carries the dynamic
 * condition (e.g. `isStale` for the bump button) so the contribution
 * does not have to be deleted when the condition lapses. When disabled,
 * `disabledReason` is surfaced as the tooltip.
 *
 * LINT (renderer attr-sanitization, see context/ui.md): no
 * `[innerHTML]` / `[style]` / `[src]` / `[href]`. The label is
 * interpolated, the tooltip is `[pTooltip]` (auto-sanitized), and the
 * icon string goes to `<p-button [icon]>` which only sets a class.
 *
 * The dispatch service owns the `.sm` write-consent handshake; this
 * renderer keeps a LOCAL `inFlight` / `error` so each button reflects
 * its own click independently of any sibling action button.
 */
interface IActionPrompt {
  inputType: string;
  paramKey: string;
  label: string;
  options?: { value: string; label: string }[];
  /**
   * Optional pre-filled value the dialog seeds the control with on open
   * (e.g. the node's current stability for an `enum-pick`, current tags
   * for a `string-list`). String for scalar input-types, string array
   * for list input-types. Threaded into the descriptor below.
   */
  defaultValue?: string | string[];
}

interface INodeActionButtonPayload {
  actionId: string;
  label?: string;
  icon?: string;
  severity?: 'info' | 'warn' | 'success' | 'danger';
  enabled?: boolean;
  disabledReason?: string;
  input?: Record<string, unknown>;
  prompt?: IActionPrompt;
}

/** Map the contribution severity vocabulary onto p-button severities. */
type TButtonSeverity = 'secondary' | 'info' | 'warn' | 'success' | 'danger';

@Component({
  selector: 'sm-node-action-button',
  imports: [ButtonModule, TooltipModule, ActionPromptDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="vc-action" data-testid="renderer-node-action-button">
      <p-button
        [label]="label()"
        [icon]="icon() ?? ''"
        [severity]="severity()"
        size="small"
        [disabled]="!enabled() || inFlight()"
        [loading]="inFlight()"
        [pTooltip]="tooltip()"
        (onClick)="run()"
        [attr.data-testid]="'action-' + actionId()"
      />
      @if (error(); as err) {
        <span class="vc-action__error" role="alert" data-testid="renderer-node-action-button-error">
          <span class="vc-action__error-text">{{ err }}</span>
          <button
            type="button"
            class="vc-action__error-dismiss"
            [attr.aria-label]="texts.dismissErrorAriaLabel"
            (click)="dismissError()"
            data-testid="renderer-node-action-button-error-dismiss"
          >
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        </span>
      }
    </span>

    @defer (when promptOpened(); prefetch on idle) {
      @if (prompt(); as p) {
        <sm-action-prompt-dialog
          [open]="promptOpen()"
          [descriptor]="promptDescriptor()"
          [headerText]="dialogHeader()"
          [busy]="inFlight()"
          (confirmed)="onPromptConfirmed($event)"
          (closed)="cancelPrompt()"
        />
      }
    }
  `,
  styles: [`
    .vc-action { display: inline-flex; align-items: center; gap: 0.4rem;
      flex-wrap: wrap; }
    .vc-action__error { display: inline-flex; align-items: center;
      gap: 0.3rem; font-size: 0.8rem; color: var(--sm-severity-error);
      background: var(--sm-severity-error-bg);
      padding: 0.1rem 0.4rem; border-radius: var(--sm-radius-sm); }
    .vc-action__error-dismiss { background: none; border: none;
      cursor: pointer; padding: 0; line-height: 1;
      color: var(--sm-severity-error); display: inline-flex; }
    .vc-action__error-dismiss .pi { font-size: 0.7rem; }
  `],
})
export class NodeActionButton {
  readonly inputs = input.required<IRendererInputs>();
  protected readonly texts = NODE_ACTION_BUTTON_TEXTS;

  private readonly dispatcher = inject(ActionDispatchService);

  private readonly inFlightSig = signal<boolean>(false);
  private readonly errorSig = signal<string | null>(null);
  private readonly promptOpenSig = signal<boolean>(false);
  private readonly promptOpenedSig = signal<boolean>(false);
  protected readonly inFlight = this.inFlightSig.asReadonly();
  protected readonly error = this.errorSig.asReadonly();
  protected readonly promptOpen = this.promptOpenSig.asReadonly();
  /**
   * Sticky latch driving the `@defer (when ...)` trigger. Flips true the
   * first time the prompt opens and never resets, so the deferred dialog
   * chunk loads once and the dialog can re-open without re-fetching.
   * `promptOpen()` (the live one) still drives the dialog's visibility.
   */
  protected readonly promptOpened = this.promptOpenedSig.asReadonly();

  protected readonly typed = computed<INodeActionButtonPayload>(() => {
    const p = this.inputs().payload;
    if (typeof p !== 'object' || p === null) return { actionId: '' };
    return p as INodeActionButtonPayload;
  });

  protected readonly actionId = computed<string>(() => this.typed().actionId || '');

  protected readonly label = computed<string>(
    () => this.typed().label ?? this.inputs().label ?? this.texts.fallbackLabel,
  );

  /** Icon prefers the payload, then the manifest-declared icon. */
  protected readonly icon = computed<string | undefined>(
    () => this.typed().icon ?? this.inputs().icon,
  );

  /** Enabled unless the payload explicitly opts out. */
  protected readonly enabled = computed<boolean>(() => this.typed().enabled !== false);

  protected readonly severity = computed<TButtonSeverity>(() => {
    switch (this.typed().severity) {
      case 'info':
        return 'info';
      case 'warn':
        return 'warn';
      case 'success':
        return 'success';
      case 'danger':
        return 'danger';
      default:
        return 'secondary';
    }
  });

  /** Disabled buttons surface `disabledReason`; enabled ones the manifest tooltip. */
  protected readonly tooltip = computed<string>(() => {
    if (!this.enabled()) return this.typed().disabledReason ?? '';
    return this.inputs().tooltip ?? '';
  });

  /**
   * The parametrized-prompt descriptor, or null for a direct-dispatch
   * button. A prompt needs at least an `inputType` and a `paramKey`.
   */
  protected readonly prompt = computed<IActionPrompt | null>(() => {
    const p = this.typed().prompt;
    if (!p || typeof p !== 'object') return null;
    if (!p.inputType || !p.paramKey) return null;
    return p;
  });

  /** Descriptor handed to `<sm-action-prompt-dialog>`. */
  protected readonly promptDescriptor = computed<IInputTypeDescriptor>(() => {
    const p = this.prompt();
    return {
      inputType: p?.inputType ?? '',
      label: p?.label ?? '',
      options: p?.options,
      // Seed the dialog with the node's current value when the prompt
      // carries one, so "Set stability" pre-selects the current
      // stability and "Edit tags" pre-loads the current tags.
      defaultValue: p?.defaultValue,
    };
  });

  protected readonly dialogHeader = computed<string>(
    () => this.typed().label ?? this.texts.promptDialogHeader,
  );

  /** Entry point for the button click: open the prompt, or dispatch now. */
  protected run(): void {
    if (!this.enabled() || this.inFlightSig()) return;
    if (this.prompt()) {
      this.openPrompt();
      return;
    }
    void this.dispatch(this.typed().input);
  }

  /** Arm the deferred dialog and reveal it. */
  private openPrompt(): void {
    this.errorSig.set(null);
    this.promptOpenedSig.set(true); // arm the @defer trigger (sticky)
    this.promptOpenSig.set(true);
  }

  /** Confirm: fold the collected value into the dispatch input, then send. */
  protected onPromptConfirmed(value: TInputTypeValue): void {
    const p = this.prompt();
    if (!p) return;
    this.promptOpenSig.set(false);
    const input: Record<string, unknown> = {
      ...(this.typed().input ?? {}),
      [p.paramKey]: value,
    };
    void this.dispatch(input);
  }

  /** Cancel: close the dialog, do not dispatch. */
  protected cancelPrompt(): void {
    this.promptOpenSig.set(false);
  }

  /** Shared dispatch path used by both the direct and prompt flows. */
  private async dispatch(input: unknown): Promise<void> {
    const actionId = this.actionId();
    const nodePath = this.inputs().nodePath;
    if (!actionId || !nodePath) return;
    this.errorSig.set(null);
    this.inFlightSig.set(true);
    try {
      await this.dispatcher.dispatch(actionId, nodePath, input);
      // The dispatch service captures dispatch failures (and the consent
      // gate) in its own state; mirror any error it surfaced so the
      // banner sits next to the button that triggered it.
      const err = this.dispatcher.error();
      if (err) this.errorSig.set(err);
    } finally {
      this.inFlightSig.set(false);
    }
  }

  protected dismissError(): void {
    this.errorSig.set(null);
    this.dispatcher.dismissError();
  }
}
