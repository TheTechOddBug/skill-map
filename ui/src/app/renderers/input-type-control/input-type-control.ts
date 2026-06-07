/**
 * `<sm-input-type-control>`, a reusable form control that renders the
 * PrimeNG widget matching an input-type descriptor and reports the
 * collected value back through a two-way `value` model.
 *
 * It is the transversal piece behind the parametrized-action prompt
 * flow (Pasos 2-3): a `prompt` payload on an `inspector.action.button`
 * contribution names an `inputType` + `paramKey`; the action button's
 * dialog hosts this control to gather the value before dispatching.
 *
 * Catalog coverage (closed catalog in `spec/input-types.md`): this
 * control implements the THREE types the action prompts need today; the
 * other seven are out of scope until a prompt references them.
 *
 *   - `single-string`  -> `<input pInputText>`           value: string
 *   - `enum-pick`      -> `<p-select>` over `options`     value: string
 *   - `string-list`    -> `<p-autocomplete multiple>`     value: string[]
 *
 * On the `string-list` widget: `spec/input-types.md` names `<p-chips>` as
 * the canonical tag input, but PrimeNG 21 (the pinned 21.1.6) retired
 * the standalone Chips component and folded tag-input into AutoComplete
 * via `[multiple]="true" [typeahead]="false"`. That is the official
 * PrimeNG 21 replacement (Enter adds the trimmed input as a tag, with
 * built-in dedup) and the `[(ngModel)]` value is a `string[]`, exactly
 * the contract the spec promises. Wiring the actually-installed
 * component (not a removed one) is the no-hack path.
 *
 * LINT (renderer attr-sanitization, see context/ui.md / view-slots.md):
 * no `[innerHTML]` / `[style]` / `[src]` / `[href]` is bound from
 * descriptor data. The label is interpolated, option labels are
 * interpolated by `<p-select>`, the value rides `[(ngModel)]`.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';

import { INPUT_TYPE_CONTROL_TEXTS } from './input-type-control.texts';

/** A single choice for the `enum-pick` widget. */
export interface IInputTypeOption {
  value: string;
  label: string;
}

/**
 * The subset of `_ActionPrompt` (`view-slots.schema.json`) this control
 * needs: the input-type id, the field label, and (for `enum-pick`) the
 * option list. `paramKey` is the caller's concern, not the control's.
 *
 * `defaultValue` is the optional pre-filled value the prompt dialog
 * seeds the control with when it opens (e.g. a node's current stability
 * for an `enum-pick`, or its current tags for a `string-list`). The
 * control itself never reads it, the dialog seeds the two-way `value`
 * before the control mounts, so the field arrives pre-populated.
 */
export interface IInputTypeDescriptor {
  inputType: string;
  label: string;
  options?: IInputTypeOption[];
  defaultValue?: TInputTypeValue;
}

/** Value shapes the control can hold. `string-list` is `string[]`. */
export type TInputTypeValue = string | string[];

@Component({
  selector: 'sm-input-type-control',
  imports: [FormsModule, InputTextModule, SelectModule, AutoCompleteModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="itc" [attr.data-testid]="'input-type-control-' + inputType()">
      <label class="itc__label" [attr.for]="fieldId()">{{ label() }}</label>

      @switch (inputType()) {
        @case ('single-string') {
          <input
            type="text"
            pInputText
            class="itc__string"
            [id]="fieldId()"
            [ngModel]="stringValue()"
            (ngModelChange)="onStringChange($event)"
            [placeholder]="texts.stringPlaceholder"
            [attr.aria-label]="label()"
            data-testid="input-type-control-string-input"
          />
        }
        @case ('enum-pick') {
          <p-select
            class="itc__select"
            [inputId]="fieldId()"
            [options]="options()"
            optionLabel="label"
            optionValue="value"
            [ngModel]="stringValue()"
            (ngModelChange)="onStringChange($event)"
            [placeholder]="texts.selectPlaceholder"
            appendTo="body"
            [attr.aria-label]="label()"
            data-testid="input-type-control-select"
          />
        }
        @case ('string-list') {
          <p-autocomplete
            class="itc__list"
            [inputId]="fieldId()"
            [multiple]="true"
            [typeahead]="false"
            [addOnBlur]="true"
            [unique]="true"
            [ngModel]="listValue()"
            (ngModelChange)="onListChange($event)"
            [placeholder]="texts.listPlaceholder"
            [attr.aria-label]="label()"
            data-testid="input-type-control-list"
          />
        }
        @default {
          <span class="itc__unsupported" role="note" data-testid="input-type-control-unsupported">
            {{ texts.unsupportedPrefix }} {{ inputType() }}
          </span>
        }
      }
    </div>
  `,
  styles: [`
    .itc { display: flex; flex-direction: column; gap: 0.4rem; }
    .itc__label { font-weight: 600; font-size: 0.9rem;
      color: var(--p-text-color); }
    .itc__string, .itc__select, .itc__list { width: 100%; }
    .itc__unsupported { font-size: 0.85rem;
      color: var(--p-text-muted-color); }
  `],
})
export class InputTypeControl {
  protected readonly texts = INPUT_TYPE_CONTROL_TEXTS;

  /** The input-type + label (+ options) to render. */
  readonly descriptor = input.required<IInputTypeDescriptor>();

  /**
   * Two-way bound collected value. Callers read it via `[(value)]` or
   * the `valueChange` output. `string-list` carries a `string[]`; the
   * scalar types carry a `string`.
   */
  readonly value = model<TInputTypeValue>('');

  protected readonly inputType = computed(() => this.descriptor().inputType);
  protected readonly label = computed(() => this.descriptor().label);
  protected readonly options = computed<IInputTypeOption[]>(
    () => this.descriptor().options ?? [],
  );

  /** Stable id linking the `<label>` to the rendered widget. */
  protected readonly fieldId = computed(
    () => `itc-${this.inputType()}-${this.label().replace(/\s+/g, '-').toLowerCase()}`,
  );

  /** Scalar projection of the value for the string / select widgets. */
  protected readonly stringValue = computed<string>(() => {
    const v = this.value();
    return typeof v === 'string' ? v : '';
  });

  /** Array projection of the value for the tag-input widget. */
  protected readonly listValue = computed<string[]>(() => {
    const v = this.value();
    return Array.isArray(v) ? v : [];
  });

  protected onStringChange(next: string): void {
    this.value.set(next ?? '');
  }

  protected onListChange(next: string[]): void {
    this.value.set(Array.isArray(next) ? next : []);
  }
}
